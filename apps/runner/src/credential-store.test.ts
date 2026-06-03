import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CONTRACT_VERSION, type LinkRunnerResponse } from "@control-plane/shared";
import { describe, expect, test } from "vitest";

import { loadRunnerCredential, storeRunnerCredential } from "./credential-store.js";
import { isRunnerError, toRunnerErrorSummary } from "./errors.js";

const pairingCode = "PAIRING-CODE-MUST-NOT-BE-STORED";
const runnerCredential = "runner-credential-must-stay-local";

describe("runner credential store", () => {
  test("writes the linked runner credential record to a created parent directory", async () => {
    const root = await createTempRoot();
    const credentialPath = join(root, "nested", ".runner-state", "credentials.json");

    const summary = await storeRunnerCredential({
      credential: linkResponse(),
      credentialPath,
      now: () => new Date("2026-05-22T14:30:00.000Z"),
    });

    const stored = JSON.parse(await readFile(credentialPath, "utf8")) as Record<string, unknown>;

    expect(stored).toEqual({
      contractVersion: CONTRACT_VERSION,
      linkedAt: "2026-05-22T14:00:00.000Z",
      pollIntervalSeconds: 15,
      pollingBaseUrl: "http://localhost:3000/api",
      runnerCredential,
      runnerId: "runner_1",
      storedAt: "2026-05-22T14:30:00.000Z",
      workspaceId: "workspace_1",
    });
    expect(JSON.stringify(stored)).not.toContain(pairingCode);
    expect(summary).toEqual({
      contractVersion: CONTRACT_VERSION,
      credentialStored: true,
      linkedAt: "2026-05-22T14:00:00.000Z",
      pollIntervalSeconds: 15,
      pollingBaseUrl: "http://localhost:3000/api",
      runnerId: "runner_1",
      storedAt: "2026-05-22T14:30:00.000Z",
      workspaceId: "workspace_1",
    });
    expect(JSON.stringify(summary)).not.toContain(runnerCredential);
    expect(JSON.stringify(summary)).not.toContain(pairingCode);
  });

  test("does not persist extra runtime credential fields such as pairing codes", async () => {
    const root = await createTempRoot();
    const credentialPath = join(root, ".runner-state", "credentials.json");
    const credentialWithRuntimeFields = {
      ...linkResponse(),
      extraSecret: runnerCredential,
      pairingCode,
    };

    await storeRunnerCredential({
      credential: credentialWithRuntimeFields,
      credentialPath,
      now: () => new Date("2026-05-22T14:30:00.000Z"),
    });

    const stored = JSON.parse(await readFile(credentialPath, "utf8")) as Record<string, unknown>;

    expect(stored).toEqual({
      contractVersion: CONTRACT_VERSION,
      linkedAt: "2026-05-22T14:00:00.000Z",
      pollIntervalSeconds: 15,
      pollingBaseUrl: "http://localhost:3000/api",
      runnerCredential,
      runnerId: "runner_1",
      storedAt: "2026-05-22T14:30:00.000Z",
      workspaceId: "workspace_1",
    });
    expect(stored).not.toHaveProperty("pairingCode");
    expect(stored).not.toHaveProperty("extraSecret");
    expect(JSON.stringify(stored)).not.toContain(pairingCode);
  });

  test("uses restrictive directory and credential file permissions where supported", async () => {
    const root = await createTempRoot();
    const credentialPath = join(root, ".runner-state", "credentials.json");

    await storeRunnerCredential({
      credential: linkResponse(),
      credentialPath,
      now: () => new Date("2026-05-22T14:30:00.000Z"),
    });

    if (process.platform === "win32") {
      return;
    }

    const directoryMode = (await stat(join(root, ".runner-state"))).mode & 0o777;
    const fileMode = (await stat(credentialPath)).mode & 0o777;

    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  test("wraps invalid credential payloads in safe errors", async () => {
    const root = await createTempRoot();
    const credentialPath = join(root, ".runner-state", "credentials.json");

    await storeRunnerCredential({
      credential: {
        ...linkResponse(),
        runnerCredential: "",
      },
      credentialPath,
      now: () => new Date("2026-05-22T14:30:00.000Z"),
    }).catch((error: unknown) => {
      expect(error).toMatchObject({
        category: "command_execution",
        message: "Runner credential payload could not be validated.",
      });

      const serialized = JSON.stringify(error);

      expect(serialized).not.toContain(pairingCode);
      expect(serialized).not.toContain(runnerCredential);
    });
  });

  test("wraps filesystem write failures in safe errors without leaking credentials", async () => {
    const root = await createTempRoot();
    const credentialPath = join(root, "not-a-directory", "credentials.json");
    await writeFile(join(root, "not-a-directory"), "blocks directory creation", "utf8");

    await storeRunnerCredential({
      credential: linkResponse(),
      credentialPath,
      now: () => new Date("2026-05-22T14:30:00.000Z"),
    }).catch((error: unknown) => {
      expect(error).toMatchObject({
        category: "command_execution",
        message: "Runner credential could not be stored.",
      });

      const serialized = JSON.stringify(error);

      expect(serialized).not.toContain(pairingCode);
      expect(serialized).not.toContain(runnerCredential);
    });
  });

  test("loads a strict stored runner credential record for local runner use", async () => {
    const root = await createTempRoot();
    const credentialPath = join(root, ".runner-state", "credentials.json");

    await storeRunnerCredential({
      credential: linkResponse(),
      credentialPath,
      now: () => new Date("2026-05-22T14:30:00.000Z"),
    });

    await expect(loadRunnerCredential({ credentialPath })).resolves.toEqual({
      contractVersion: CONTRACT_VERSION,
      linkedAt: "2026-05-22T14:00:00.000Z",
      pollIntervalSeconds: 15,
      pollingBaseUrl: "http://localhost:3000/api",
      runnerCredential,
      runnerId: "runner_1",
      storedAt: "2026-05-22T14:30:00.000Z",
      workspaceId: "workspace_1",
    });
  });

  test("rejects missing, malformed, invalid, and extra-field credential files with safe errors", async () => {
    const root = await createTempRoot();
    const cases = [
      {
        path: join(root, "missing", "credentials.json"),
      },
      {
        contents: "{",
        path: join(root, "malformed", "credentials.json"),
      },
      {
        contents: JSON.stringify({
          ...linkResponse(),
          runnerCredential: "",
          storedAt: "2026-05-22T14:30:00.000Z",
        }),
        path: join(root, "invalid", "credentials.json"),
      },
      {
        contents: JSON.stringify({
          ...linkResponse(),
          authorization: `Bearer ${runnerCredential}`,
          storedAt: "2026-05-22T14:30:00.000Z",
        }),
        path: join(root, "extra", "credentials.json"),
      },
    ];

    for (const testCase of cases) {
      if (testCase.contents !== undefined) {
        await mkdir(join(testCase.path, ".."), { recursive: true });
        await writeFile(testCase.path, testCase.contents, "utf8");
      }

      let caughtError: unknown;

      try {
        await loadRunnerCredential({ credentialPath: testCase.path });
      } catch (error) {
        caughtError = error;
      }

      expect(isRunnerError(caughtError)).toBe(true);
      expect(caughtError).toMatchObject({
        category: "command_execution",
        message: "Runner credential could not be loaded.",
      });

      const serialized = JSON.stringify(caughtError);
      const summary = JSON.stringify(toRunnerErrorSummary(caughtError));

      expect(serialized).not.toContain(runnerCredential);
      expect(serialized).not.toMatch(/bearer/i);
      expect(serialized).not.toContain(root);
      expect(summary).not.toContain(runnerCredential);
      expect(summary).not.toMatch(/bearer/i);
      expect(summary).not.toContain(root);
    }
  });
});

const createTempRoot = async () => {
  const root = join(tmpdir(), `control-plane-runner-credential-store-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
};

const linkResponse = (): LinkRunnerResponse => ({
  contractVersion: CONTRACT_VERSION,
  linkedAt: "2026-05-22T14:00:00.000Z",
  pollIntervalSeconds: 15,
  pollingBaseUrl: "http://localhost:3000/api",
  runnerCredential,
  runnerId: "runner_1",
  workspaceId: "workspace_1",
});
