import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import { withMockGhOnPath } from "./gh.js";

describe("mock gh PATH harness", () => {
  it("creates an executable gh shim and scopes PATH changes to the callback", async () => {
    const originalPath = process.env.PATH;
    let harnessRoot = "";
    let harnessBin = "";

    await withMockGhOnPath(
      {
        owner: "acme",
        repo: "control-plane",
        prNumber: 92,
      },
      async (harness) => {
        harnessRoot = harness.rootPath;
        harnessBin = harness.binDir;

        await expect(stat(join(harness.binDir, "gh"))).resolves.toMatchObject({
          mode: expect.any(Number),
        });
        expect(process.env.PATH?.split(delimiter)[0]).toBe(harness.binDir);
        expect(process.env.PATH).not.toBe(originalPath);
        await expect(harness.readInvocations()).resolves.toEqual([]);

        const result = await runGh(["pr", "create", "--draft", "--body-file", "-"], "safe body");

        expect(result).toEqual({
          exitCode: 0,
          stdout: "https://github.example.test/acme/control-plane/pull/92\n",
          stderr: "",
        });
        await expect(harness.readInvocations()).resolves.toEqual([
          {
            command: "gh",
            args: ["pr", "create", "--draft", "--body-file", "-"],
            stdinLength: 9,
            stdinSha256: sha256("safe body"),
          },
        ]);
      },
    );

    expect(process.env.PATH).toBe(originalPath);
    await expect(stat(harnessBin)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(harnessRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records only stdin metadata and returns a safe generic error for unsupported commands", async () => {
    const rawBody = "body text that must never be written to mock invocation records";

    await withMockGhOnPath(
      {
        owner: "acme",
        repo: "control-plane",
        prNumber: 92,
      },
      async (harness) => {
        const result = await runGh(["repo", "view", "acme/control-plane"], rawBody);

        expect(result).toEqual({
          exitCode: 2,
          stdout: "",
          stderr: "mock gh: unsupported command\n",
        });

        const invocations = await harness.readInvocations();
        expect(invocations).toEqual([
          {
            command: "gh",
            args: ["repo", "view", "acme/control-plane"],
            stdinLength: rawBody.length,
            stdinSha256: sha256(rawBody),
          },
        ]);
        expect(JSON.stringify(invocations)).not.toContain(rawBody);
        expect(result.stderr).not.toContain(rawBody);
        expect(result.stderr).not.toContain("repo view");
      },
    );
  });

  it("supports gh --version for dry-run capability checks", async () => {
    await withMockGhOnPath(
      {
        owner: "acme",
        repo: "control-plane",
        prNumber: 92,
      },
      async (harness) => {
        const result = await runGh(["--version"], "");

        expect(result).toEqual({
          exitCode: 0,
          stdout: "gh version 2.0.0 (mock)\n",
          stderr: "",
        });
        await expect(harness.readInvocations()).resolves.toEqual([
          {
            command: "gh",
            args: ["--version"],
            stdinLength: 0,
            stdinSha256: sha256(""),
          },
        ]);
      },
    );
  });
});

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const runGh = (
  args: string[],
  stdin: string,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> =>
  new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });

    child.stdin.end(stdin);
  });
