import { describe, expect, test } from "vitest";

import * as runner from "./index.js";

describe("runner package entrypoint", () => {
  test("exports runner link and credential-store APIs", () => {
    expect(runner.DEFAULT_RUNNER_CREDENTIAL_PATH).toContain(".runner-state");
    expect(typeof runner.loadRunnerCredential).toBe("function");
    expect(typeof runner.runRunnerLink).toBe("function");
    expect(typeof runner.runRunnerReposAdd).toBe("function");
    expect(typeof runner.postRunnerRepoMapping).toBe("function");
    expect(typeof runner.storeRunnerCredential).toBe("function");
  });

  test("exports runner heartbeat protocol APIs", () => {
    expect(typeof runner.claimJob).toBe("function");
    expect(typeof runner.claimRunnerJob).toBe("function");
    expect(typeof runner.pollJobs).toBe("function");
    expect(typeof runner.pollRunnerJobs).toBe("function");
    expect(typeof runner.postRunnerProtocolRequest).toBe("function");
    expect(typeof runner.runRunnerPollIteration).toBe("function");
    expect(typeof runner.runRunnerPollLoop).toBe("function");
    expect(typeof runner.runRunnerPollOnce).toBe("function");
    expect(typeof runner.runRunnerPollingLoop).toBe("function");
    expect(typeof runner.runRunnerForTaskPacket).toBe("function");
    expect(typeof runner.sendRunnerHeartbeat).toBe("function");
    expect(typeof runner.submitDryRunResult).toBe("function");
    expect(typeof runner.submitPrArtifact).toBe("function");
    expect(typeof runner.submitRunEvent).toBe("function");
    expect(typeof runner.submitValidationResult).toBe("function");
  });
});
