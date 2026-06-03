import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_RUNNER_CONFIG, loadRunnerConfig, RunnerConfigLoaderError } from "./config.js";

const SECRET_LIKE_VALUES = [
  "ghp_runner_secret_1234567890",
  "pairing-code-please-do-not-leak",
  "sk-control-plane-secret-value",
  "-----BEGIN PRIVATE KEY-----",
];

const SECRET_LIKE_KEYS = [
  "ghp_key_name_must_not_leak_1234567890",
  "sk-key-name-must-not-leak",
  "privateKeyMaterial",
] as const;

const RAW_JSON_SNIPPETS = [
  '{"runnerToken":"',
  '"githubToken":"ghp_',
  '"password":"',
  '"privateKey":"',
  '"mockModes":{"codex":"sk-',
];

describe("runner config loader", () => {
  it("returns stable defaults without reading or creating files", async () => {
    const cwd = process.cwd();
    const directory = await mkdtemp(join(tmpdir(), "runner-config-defaults-"));

    process.chdir(directory);

    try {
      const config = await loadRunnerConfig();

      expect(config).toEqual(DEFAULT_RUNNER_CONFIG);
      expect(config).toEqual({
        worktreeRoot: ".codex-runner-worktrees",
        mockModes: {
          codex: false,
          gh: false,
        },
      });
      await expect(access(join(directory, ".codex-runner-worktrees"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      process.chdir(cwd);
    }
  });

  it("loads a full config from a supplied path", async () => {
    const configPath = await writeConfigFile("runner-config-full-", {
      worktreeRoot: ".local-worktrees",
      eventsOut: "runs/events.ndjson",
      mockModes: {
        codex: true,
        gh: true,
      },
    });

    await expect(loadRunnerConfig({ configPath })).resolves.toEqual({
      worktreeRoot: ".local-worktrees",
      eventsOut: "runs/events.ndjson",
      mockModes: {
        codex: true,
        gh: true,
      },
    });
  });

  it("merges a partial config with stable defaults", async () => {
    const configPath = await writeConfigFile("runner-config-partial-", {
      mockModes: {
        codex: true,
      },
    });

    await expect(loadRunnerConfig({ configPath })).resolves.toEqual({
      worktreeRoot: ".codex-runner-worktrees",
      mockModes: {
        codex: true,
        gh: false,
      },
    });
  });

  it("rejects a missing config file with a safe read error", async () => {
    const configPath = join(tmpdir(), "control-plane-missing-runner-config.json");

    const error = await expectRunnerConfigLoaderError(loadRunnerConfig({ configPath }));

    expect(error.code).toBe("read_failed");
    expect(error.configPath).toBe(configPath);
    expect(error.issues).toEqual([]);
    expect(error.message).toContain(configPath);
    expect(error.message).toContain("read_failed");
    expectSafeConfigErrorText(error);
  });

  it("rejects invalid JSON without echoing file contents", async () => {
    const configPath = await writeRawConfigFile(
      "runner-config-invalid-json-",
      '{"githubToken":"ghp_runner_secret_1234567890","mockModes":{"codex":true}',
    );

    const error = await expectRunnerConfigLoaderError(loadRunnerConfig({ configPath }));

    expect(error.code).toBe("invalid_json");
    expect(error.configPath).toBe(configPath);
    expect(error.issues).toEqual([]);
    expect(error.message).toContain(configPath);
    expectSafeConfigErrorText(error);
  });

  it("rejects invalid shape with generic issue paths instead of values", async () => {
    const configPath = await writeConfigFile("runner-config-invalid-shape-", {
      worktreeRoot: "",
      eventsOut: 42,
      mockModes: {
        codex: "true",
        gh: null,
      },
    });

    const error = await expectRunnerConfigLoaderError(loadRunnerConfig({ configPath }));

    expect(error.code).toBe("invalid_config");
    expect(error.configPath).toBe(configPath);
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "worktreeRoot", message: expect.any(String) }),
        expect.objectContaining({ path: "eventsOut", message: expect.any(String) }),
        expect.objectContaining({ path: "mockModes.codex", message: expect.any(String) }),
        expect.objectContaining({ path: "mockModes.gh", message: expect.any(String) }),
      ]),
    );
    expect(error.message).toContain("worktreeRoot");
    expect(error.message).toContain("mockModes.codex");
    expect(error.message).not.toContain("true");
    expect(error.message).not.toContain("42");
    expectSafeConfigErrorText(error);
  });

  it("rejects credential-like config keys", async () => {
    for (const key of ["runnerToken", "pairingCode", "githubToken", "password", "privateKey"]) {
      const configPath = await writeConfigFile(`runner-config-${key}-`, {
        worktreeRoot: ".local-worktrees",
        mockModes: {
          codex: false,
          gh: false,
        },
        [key]: "ghp_runner_secret_1234567890",
      });

      const error = await expectRunnerConfigLoaderError(loadRunnerConfig({ configPath }));

      expect(error.code).toBe("invalid_config");
      expect(error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: expect.any(String) })]),
      );
      expectSafeConfigErrorText(error);
    }
  });

  it("does not leak secret-looking key names in config errors", async () => {
    const configPath = await writeConfigFile("runner-config-secret-key-regression-", {
      [SECRET_LIKE_KEYS[0]]: "top-level value",
      mockModes: {
        codex: false,
        [SECRET_LIKE_KEYS[1]]: true,
        [SECRET_LIKE_KEYS[2]]: false,
      },
    });

    const error = await expectRunnerConfigLoaderError(loadRunnerConfig({ configPath }));

    expect(error.code).toBe("invalid_config");
    expect(error.issues.length).toBeGreaterThanOrEqual(2);
    expectSafeConfigErrorText(error);
  });

  it("does not leak secret-looking values or raw JSON snippets in config errors", async () => {
    const configPath = await writeConfigFile("runner-config-secret-regression-", {
      runnerToken: SECRET_LIKE_VALUES[0],
      pairingCode: SECRET_LIKE_VALUES[1],
      githubToken: SECRET_LIKE_VALUES[2],
      password: "password=do-not-print-this",
      privateKey: SECRET_LIKE_VALUES[3],
      mockModes: {
        codex: "sk-control-plane-secret-value",
        gh: false,
      },
    });

    const error = await expectRunnerConfigLoaderError(loadRunnerConfig({ configPath }));

    expect(error.code).toBe("invalid_config");
    expect(error.issues.length).toBeGreaterThan(0);
    expectSafeConfigErrorText(error);
  });
});

const writeConfigFile = async (prefix: string, config: Record<string, unknown>): Promise<string> =>
  writeRawConfigFile(prefix, JSON.stringify(config));

const writeRawConfigFile = async (prefix: string, contents: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const configPath = join(directory, "runner-config.json");
  await writeFile(configPath, contents, "utf8");
  return configPath;
};

const expectRunnerConfigLoaderError = async (
  promise: Promise<unknown>,
): Promise<RunnerConfigLoaderError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RunnerConfigLoaderError);
    return error as RunnerConfigLoaderError;
  }

  throw new Error("Expected runner config loader to reject.");
};

const expectSafeConfigErrorText = (error: RunnerConfigLoaderError): void => {
  const safeText = `${error.message}\n${JSON.stringify({
    code: error.code,
    issues: error.issues,
  })}`;

  for (const unsafeText of [...SECRET_LIKE_VALUES, ...SECRET_LIKE_KEYS, ...RAW_JSON_SNIPPETS]) {
    expect(safeText).not.toContain(unsafeText);
  }
};
