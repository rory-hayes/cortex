import { describe, expect, it } from "vitest";

import { CommandExecutionError, runCommand, type CommandExecutionResult } from "./index.js";

const SECRET_OUTPUT = [
  "OPENAI_API_KEY=sk-test-openai-secret",
  "GITHUB_TOKEN=ghp_testgithubsecret1234567890",
  "password=correct-horse-battery-staple",
  "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----",
  "https://user:credential@example.com/private.git",
];

describe("runner command execution", () => {
  it("runs a direct argv command and returns command metadata", async () => {
    const result = await runCommand({
      command: process.execPath,
      args: ["-e", "process.stdout.write('runner command ok')"],
      cwd: process.cwd(),
    });

    expect(result.command).toEqual({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('runner command ok')"],
    });
    expect(result.cwd).toBe(process.cwd());
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.stdoutSummary).toBe("runner command ok");
    expect(result.stderrSummary).toBe("");
    expect(result.redactionApplied).toBe(false);
    expectNoRawOutputFields(result);
  });

  it("returns nonzero exits without throwing by default", async () => {
    const result = await runCommand({
      command: process.execPath,
      args: ["-e", "process.exit(7)"],
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(7);
    expect(result.stdoutSummary).toBe("");
    expect(result.stderrSummary).toBe("");
  });

  it("throws a safe CommandExecutionError for nonzero exits when configured", async () => {
    const error = await expectCommandExecutionError(
      runCommand({
        command: process.execPath,
        args: ["-e", "process.stderr.write('GITHUB_TOKEN=ghp_throwsecret123'); process.exit(7)"],
        cwd: process.cwd(),
        throwOnNonZero: true,
      }),
    );

    expect(error).toBeInstanceOf(CommandExecutionError);
    expect(error.result.exitCode).toBe(7);
    expect(error.result.stderrSummary).toContain("[REDACTED_SECRET]");
    expect(error.message).toContain("exit code 7");
    expectSafeCommandErrorText(error);
    expectNoRawOutputFields(error.result);
  });

  it("passes shell metacharacters as literal args without interpolation", async () => {
    const literalArg = "literal; echo SHELL_INTERPOLATED && uname";

    const result = await runCommand({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv.at(-1) ?? '')", literalArg],
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdoutSummary).toBe(literalArg);
    expect(result.stdoutSummary).not.toContain("SHELL_INTERPOLATED\n");
  });

  it("redacts common secret patterns from stdout and stderr summaries", async () => {
    const result = await runCommand({
      command: process.execPath,
      args: [
        "-e",
        [
          `process.stdout.write(${JSON.stringify(SECRET_OUTPUT.join("\n"))});`,
          `process.stderr.write(${JSON.stringify(SECRET_OUTPUT.join("\n"))});`,
        ].join(""),
      ],
      cwd: process.cwd(),
    });

    expect(result.redactionApplied).toBe(true);
    expect(result.stdoutSummary).toContain("[REDACTED_SECRET]");
    expect(result.stdoutSummary).toContain("[REDACTED_PRIVATE_KEY]");
    expect(result.stdoutSummary).toContain("[REDACTED_CREDENTIAL_URL]");
    expect(result.stderrSummary).toContain("[REDACTED_SECRET]");
    expect(result.stderrSummary).toContain("[REDACTED_PRIVATE_KEY]");
    expect(result.stderrSummary).toContain("[REDACTED_CREDENTIAL_URL]");
    expectSafeCommandOutput(result);
  });

  it("truncates summaries after redaction", async () => {
    const result = await runCommand({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('prefix OPENAI_API_KEY=sk-test-openai-secret ' + 'x'.repeat(120))",
      ],
      cwd: process.cwd(),
      summaryLimit: 40,
    });

    expect(result.stdoutSummary.length).toBeLessThanOrEqual(40);
    expect(result.stdoutSummary).toContain("[REDACTED_SECRET]");
    expect(result.stdoutSummary).toContain("[truncated]");
    expect(result.stdoutSummary).not.toContain("OPENAI_API_KEY");
    expect(result.stdoutSummary).not.toContain("sk-test-openai-secret");
  });

  it("returns a safe failure result when the executable is missing", async () => {
    const result = await runCommand({
      command: "control-plane-missing-executable-for-command-wrapper",
      args: ["--token", "GITHUB_TOKEN=ghp_missingsecret123"],
      cwd: process.cwd(),
    });

    expect(result.command).toEqual({
      executable: "control-plane-missing-executable-for-command-wrapper",
      args: ["--token", "[REDACTED_SECRET]"],
    });
    expect(result.exitCode).toBe(127);
    expect(result.stdoutSummary).toBe("");
    expect(result.stderrSummary).toBe("Command failed to start: executable_not_found.");
    expect(result.redactionApplied).toBe(true);
    expectSafeCommandOutput(result);
  });
});

const expectCommandExecutionError = async (
  promise: Promise<CommandExecutionResult>,
): Promise<CommandExecutionError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandExecutionError);
    return error as CommandExecutionError;
  }

  throw new Error("Expected command execution to reject.");
};

const expectNoRawOutputFields = (result: CommandExecutionResult): void => {
  expect("stdout" in result).toBe(false);
  expect("stderr" in result).toBe(false);
};

const expectSafeCommandErrorText = (error: CommandExecutionError): void => {
  const safeText = `${error.message}\n${JSON.stringify(error.result)}`;

  for (const unsafeText of SECRET_OUTPUT) {
    expect(safeText).not.toContain(unsafeText);
  }
};

const expectSafeCommandOutput = (result: CommandExecutionResult): void => {
  const safeText = JSON.stringify(result);

  for (const unsafeText of SECRET_OUTPUT) {
    expect(safeText).not.toContain(unsafeText);
  }
};
