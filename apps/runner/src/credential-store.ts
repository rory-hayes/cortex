import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LinkRunnerResponseSchema, type LinkRunnerResponse } from "@control-plane/shared";

import { RunnerError } from "./errors.js";

export type RunnerCredentialRecord = LinkRunnerResponse & {
  storedAt: string;
};

export type RunnerCredentialStoreSummary = Omit<RunnerCredentialRecord, "runnerCredential"> & {
  credentialStored: true;
};

export type StoreRunnerCredentialOptions = {
  credential: LinkRunnerResponse;
  credentialPath?: string;
  now?: () => Date;
};

export type LoadRunnerCredentialOptions = {
  credentialPath?: string;
};

const CREDENTIAL_DIRECTORY_MODE = 0o700;
const CREDENTIAL_FILE_MODE = 0o600;

export const DEFAULT_RUNNER_CREDENTIAL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".runner-state",
  "credentials.json",
);

export const storeRunnerCredential = async (
  options: StoreRunnerCredentialOptions,
): Promise<RunnerCredentialStoreSummary> => {
  const credentialPath = options.credentialPath ?? DEFAULT_RUNNER_CREDENTIAL_PATH;
  const credentialDirectory = dirname(credentialPath);
  const storedAt = (options.now ?? (() => new Date()))().toISOString();
  const parsedCredential = LinkRunnerResponseSchema.safeParse({
    contractVersion: options.credential.contractVersion,
    linkedAt: options.credential.linkedAt,
    pollIntervalSeconds: options.credential.pollIntervalSeconds,
    pollingBaseUrl: options.credential.pollingBaseUrl,
    runnerCredential: options.credential.runnerCredential,
    runnerId: options.credential.runnerId,
    workspaceId: options.credential.workspaceId,
  });

  if (!parsedCredential.success) {
    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner credential payload could not be validated.",
    });
  }

  const credential = parsedCredential.data;
  const record: RunnerCredentialRecord = {
    ...credential,
    storedAt,
  };

  const temporaryPath = join(
    credentialDirectory,
    `.credentials.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`,
  );

  try {
    await mkdir(credentialDirectory, {
      mode: CREDENTIAL_DIRECTORY_MODE,
      recursive: true,
    });
    await bestEffortChmod(credentialDirectory, CREDENTIAL_DIRECTORY_MODE);

    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      mode: CREDENTIAL_FILE_MODE,
    });
    await bestEffortChmod(temporaryPath, CREDENTIAL_FILE_MODE);
    await rename(temporaryPath, credentialPath);
    await bestEffortChmod(credentialPath, CREDENTIAL_FILE_MODE);
  } catch {
    await unlink(temporaryPath).catch(() => undefined);

    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner credential could not be stored.",
    });
  }

  return {
    contractVersion: record.contractVersion,
    credentialStored: true,
    linkedAt: record.linkedAt,
    pollIntervalSeconds: record.pollIntervalSeconds,
    pollingBaseUrl: record.pollingBaseUrl,
    runnerId: record.runnerId,
    storedAt: record.storedAt,
    workspaceId: record.workspaceId,
  };
};

export const loadRunnerCredential = async (
  options: LoadRunnerCredentialOptions = {},
): Promise<RunnerCredentialRecord> => {
  const credentialPath = options.credentialPath ?? DEFAULT_RUNNER_CREDENTIAL_PATH;
  let contents: string;
  let parsedJson: unknown;

  try {
    contents = await readFile(credentialPath, "utf8");
  } catch {
    throw credentialLoadError();
  }

  try {
    parsedJson = JSON.parse(contents);
  } catch {
    throw credentialLoadError();
  }

  const credential = parseStoredCredentialRecord(parsedJson);

  if (credential === undefined) {
    throw credentialLoadError();
  }

  return credential;
};

const bestEffortChmod = async (path: string, mode: number): Promise<void> => {
  if (process.platform === "win32") {
    return;
  }

  try {
    await chmod(path, mode);
  } catch {
    // Permission hardening is best-effort across filesystems.
  }
};

const credentialRecordKeys = new Set([
  "contractVersion",
  "linkedAt",
  "pollIntervalSeconds",
  "pollingBaseUrl",
  "runnerCredential",
  "runnerId",
  "storedAt",
  "workspaceId",
]);

const parseStoredCredentialRecord = (value: unknown): RunnerCredentialRecord | undefined => {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  if (Object.keys(value).some((key) => !credentialRecordKeys.has(key))) {
    return undefined;
  }

  const parsedCredential = LinkRunnerResponseSchema.safeParse({
    contractVersion: value.contractVersion,
    linkedAt: value.linkedAt,
    pollIntervalSeconds: value.pollIntervalSeconds,
    pollingBaseUrl: value.pollingBaseUrl,
    runnerCredential: value.runnerCredential,
    runnerId: value.runnerId,
    workspaceId: value.workspaceId,
  });

  if (!parsedCredential.success) {
    return undefined;
  }

  if (typeof value.storedAt !== "string" || value.storedAt.trim().length === 0) {
    return undefined;
  }

  return {
    ...parsedCredential.data,
    storedAt: value.storedAt,
  };
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

const credentialLoadError = () =>
  new RunnerError({
    category: "command_execution",
    userSafeMessage: "Runner credential could not be loaded.",
  });
