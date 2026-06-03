import {
  CONTRACT_VERSION,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  RUNNER_PROTOCOL_ENDPOINTS,
  type CancellationRequest,
  type CloseRunRequest,
  type HeartbeatResponse,
  type RepairRequest,
  type RunnerCapabilities,
  type RunnerHeartbeatStatus,
} from "@control-plane/shared";

import { detectRunnerCapabilities, type DetectRunnerCapabilitiesOptions } from "../capabilities.js";
import {
  loadRunnerCredential,
  type LoadRunnerCredentialOptions,
  type RunnerCredentialRecord,
} from "../credential-store.js";
import { RunnerError } from "../errors.js";
import { postRunnerProtocolRequest, type RunnerProtocolFetch } from "./client.js";

export type RunnerHeartbeatInstruction =
  | {
      type: "none";
    }
  | {
      cancellation: CancellationRequest;
      type: "cancellation";
    }
  | {
      repair: RepairRequest;
      type: "repair";
    }
  | {
      close: CloseRunRequest;
      type: "close";
    };

export type RunnerHeartbeatResult = {
  currentRunId: string | null;
  instruction: RunnerHeartbeatInstruction;
  pollIntervalSeconds: number;
  runnerId: string;
  serverTime: string;
  status: RunnerHeartbeatStatus;
};

export type SendRunnerHeartbeatOptions = {
  credentialPath?: string;
  currentRunId?: string | null;
  status?: RunnerHeartbeatStatus;
};

export type SendRunnerHeartbeatDependencies = {
  detectCapabilities?: (options?: DetectRunnerCapabilitiesOptions) => Promise<RunnerCapabilities>;
  fetch?: RunnerProtocolFetch;
  loadCredential?: (options?: LoadRunnerCredentialOptions) => Promise<RunnerCredentialRecord>;
  now?: () => Date;
};

export const sendRunnerHeartbeat = async (
  options: SendRunnerHeartbeatOptions = {},
  dependencies: SendRunnerHeartbeatDependencies = {},
): Promise<RunnerHeartbeatResult> => {
  const now = dependencies.now ?? (() => new Date());
  const loadCredential = dependencies.loadCredential ?? loadRunnerCredential;
  const credential = await loadCredential(
    options.credentialPath === undefined ? {} : { credentialPath: options.credentialPath },
  );
  const currentRunId = options.currentRunId ?? null;
  const status = options.status ?? (currentRunId === null ? "idle" : "busy");
  const detectCapabilities = dependencies.detectCapabilities ?? detectRunnerCapabilities;
  const capabilities = await detectCapabilities({
    now,
    runnerId: credential.runnerId,
  });
  const request = HeartbeatRequestSchema.safeParse({
    capabilities,
    contractVersion: CONTRACT_VERSION,
    currentRunId,
    runnerId: credential.runnerId,
    status,
    timestamp: now().toISOString(),
  });

  if (!request.success) {
    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "Runner heartbeat request could not be validated.",
    });
  }

  const response = await postRunnerProtocolRequest({
    baseUrl: credential.pollingBaseUrl,
    endpoint: RUNNER_PROTOCOL_ENDPOINTS.heartbeat,
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    request: request.data,
    responseSchema: HeartbeatResponseSchema,
    runnerCredential: credential.runnerCredential,
    runnerId: credential.runnerId,
  });

  return {
    currentRunId,
    instruction: normalizeHeartbeatInstruction(response),
    pollIntervalSeconds: response.pollIntervalSeconds,
    runnerId: credential.runnerId,
    serverTime: response.serverTime,
    status,
  };
};

const normalizeHeartbeatInstruction = (response: HeartbeatResponse): RunnerHeartbeatInstruction => {
  if (response.cancellation !== undefined) {
    return {
      cancellation: response.cancellation,
      type: "cancellation",
    };
  }

  if (response.repair !== undefined) {
    return {
      repair: response.repair,
      type: "repair",
    };
  }

  if (response.close !== undefined) {
    return {
      close: response.close,
      type: "close",
    };
  }

  return { type: "none" };
};
