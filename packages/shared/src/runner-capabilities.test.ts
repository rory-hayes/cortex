import { describe, expect, it } from "vitest";
import type {
  RunnerCapabilities as SharedRunnerCapabilities,
  RunnerCapabilitiesOs as SharedRunnerCapabilitiesOs,
  RunnerCapabilitiesTools as SharedRunnerCapabilitiesTools,
  ToolCapability as SharedToolCapability,
} from "@control-plane/shared";

const CONTRACT_VERSION = "2026-05-10.v1";

const DOCUMENTED_TOOL_KEYS = [
  "git",
  "gh",
  "codex",
  "node",
  "npm",
  "pnpm",
  "yarn",
  "python",
] as const;

const UNSAFE_CAPABILITY_VALUES = [
  ["diff marker", "diff --git a/src/private.ts b/src/private.ts"],
  ["patch marker", "*** Begin Patch\n*** Update File: src/private.ts"],
  ["hunk marker", "@@ -1,2 +1,3 @@"],
  ["code snippet", "const leakedSource = true;"],
  ["fenced code", "```ts\nconst leakedSource = true;\n```"],
  ["raw stdout label", "raw stdout: private command output"],
  ["credential URL", "https://runner:secret@example.test/repo.git"],
  ["provider token", "ghp_capabilitysecret1234567890"],
  ["private key", "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"],
  ["env assignment", "OPENAI_API_KEY=sk-capability-secret-value"],
  ["env reference", "process.env.OPENAI_API_KEY"],
  ["control character", "runner\u0000id"],
] as const;

type ToolKey = (typeof DOCUMENTED_TOOL_KEYS)[number];

type ToolCapability = {
  available: boolean;
  version?: string;
  path?: string;
};

type RunnerCapabilitiesOs = {
  platform: string;
  release: string;
  arch: string;
};

type RunnerCapabilitiesTools = Partial<Record<ToolKey, ToolCapability>>;

type RunnerCapabilities = {
  contractVersion: typeof CONTRACT_VERSION;
  runnerId?: string;
  os: RunnerCapabilitiesOs;
  shell: string;
  tools: RunnerCapabilitiesTools;
  maxConcurrentJobs: number;
  supportsDryRun: boolean;
  supportsCancellation: boolean;
  reportedAt: string;
};

type RunnerCapabilitiesModule = {
  ToolCapabilitySchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RunnerCapabilitiesOsSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RunnerCapabilitiesToolsSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  RunnerCapabilitiesSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
};

const loadRunnerCapabilitiesModule = async () =>
  (await import("./runner-capabilities.js")) as RunnerCapabilitiesModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<RunnerCapabilitiesModule>;

const validRunnerCapabilities = (
  overrides: Partial<RunnerCapabilities> = {},
): RunnerCapabilities => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner-1",
  os: {
    platform: "darwin",
    release: "25.5.0",
    arch: "arm64",
  },
  shell: "/bin/zsh",
  tools: {
    git: {
      available: true,
      version: "2.49.0",
      path: "/usr/bin/git",
    },
    codex: {
      available: false,
    },
  },
  maxConcurrentJobs: 1,
  supportsDryRun: true,
  supportsCancellation: true,
  reportedAt: "2026-05-14T20:34:02.239Z",
  ...overrides,
});

const assertEntrypointTypeExports = (value: {
  capability: SharedRunnerCapabilities;
  os: SharedRunnerCapabilitiesOs;
  tools: SharedRunnerCapabilitiesTools;
  tool: SharedToolCapability;
}) => value;

describe("RunnerCapabilities", () => {
  it("validates unavailable tools without version or path", async () => {
    const { RunnerCapabilitiesSchema } = await loadRunnerCapabilitiesModule();

    expect(
      RunnerCapabilitiesSchema.safeParse(
        validRunnerCapabilities({
          tools: {
            codex: {
              available: false,
            },
          },
        }),
      ).success,
    ).toBe(true);
  });

  it("validates each documented optional tool key", async () => {
    const { RunnerCapabilitiesToolsSchema } = await loadRunnerCapabilitiesModule();

    for (const toolKey of DOCUMENTED_TOOL_KEYS) {
      expect(
        RunnerCapabilitiesToolsSchema.safeParse({
          [toolKey]: {
            available: false,
          },
        }).success,
      ).toBe(true);
    }
  });

  it("validates available documented tools with version and path metadata", async () => {
    const { RunnerCapabilitiesSchema } = await loadRunnerCapabilitiesModule();

    expect(
      RunnerCapabilitiesSchema.safeParse(
        validRunnerCapabilities({
          tools: {
            git: {
              available: true,
              version: "2.49.0",
              path: "/usr/bin/git",
            },
            gh: {
              available: true,
              version: "2.72.0",
              path: "/opt/homebrew/bin/gh",
            },
            codex: {
              available: true,
              version: "0.11.0",
              path: "/opt/homebrew/bin/codex",
            },
            node: {
              available: true,
              version: "v24.0.0",
              path: "/opt/homebrew/bin/node",
            },
            npm: {
              available: true,
              version: "11.3.0",
              path: "/opt/homebrew/bin/npm",
            },
            pnpm: {
              available: true,
              version: "10.11.0",
              path: "/opt/homebrew/bin/pnpm",
            },
            yarn: {
              available: true,
              version: "1.22.22",
              path: "/opt/homebrew/bin/yarn",
            },
            python: {
              available: true,
              version: "3.13.3",
              path: "/opt/homebrew/bin/python",
            },
          },
        }),
      ).success,
    ).toBe(true);
  });

  it("keeps safe tool path metadata allowed by the v1 capability contract", async () => {
    const { RunnerCapabilitiesSchema, ToolCapabilitySchema } = await loadRunnerCapabilitiesModule();

    expect(
      ToolCapabilitySchema.safeParse({
        available: true,
        path: "/usr/bin/git",
        version: "2.49.0",
      }).success,
    ).toBe(true);
    expect(
      RunnerCapabilitiesSchema.safeParse(
        validRunnerCapabilities({
          tools: {
            git: {
              available: true,
              path: "/usr/bin/git",
              version: "2.49.0",
            },
          },
        }),
      ).success,
    ).toBe(true);
  });

  it.each(UNSAFE_CAPABILITY_VALUES)(
    "rejects unsafe capability string values containing %s",
    async (_label, unsafeValue) => {
      const { RunnerCapabilitiesSchema } = await loadRunnerCapabilitiesModule();
      const base = validRunnerCapabilities();
      const candidates = [
        {
          field: "runnerId",
          value: validRunnerCapabilities({ runnerId: unsafeValue }),
        },
        {
          field: "os.platform",
          value: validRunnerCapabilities({
            os: {
              ...base.os,
              platform: unsafeValue,
            },
          }),
        },
        {
          field: "os.release",
          value: validRunnerCapabilities({
            os: {
              ...base.os,
              release: unsafeValue,
            },
          }),
        },
        {
          field: "os.arch",
          value: validRunnerCapabilities({
            os: {
              ...base.os,
              arch: unsafeValue,
            },
          }),
        },
        {
          field: "shell",
          value: validRunnerCapabilities({ shell: unsafeValue }),
        },
        {
          field: "tools.git.version",
          value: validRunnerCapabilities({
            tools: {
              git: {
                available: true,
                version: unsafeValue,
              },
            },
          }),
        },
        {
          field: "tools.git.path",
          value: validRunnerCapabilities({
            tools: {
              git: {
                available: true,
                path: unsafeValue,
              },
            },
          }),
        },
        {
          field: "reportedAt",
          value: validRunnerCapabilities({ reportedAt: unsafeValue }),
        },
      ];

      for (const candidate of candidates) {
        expect(
          RunnerCapabilitiesSchema.safeParse(candidate.value).success,
          `Expected ${candidate.field} to reject unsafe value ${unsafeValue}`,
        ).toBe(false);
      }
    },
  );

  it("allows runnerId to be absent but rejects an empty runnerId", async () => {
    const { RunnerCapabilitiesSchema } = await loadRunnerCapabilitiesModule();
    const capabilityWithoutRunnerId: Record<string, unknown> = validRunnerCapabilities();
    delete capabilityWithoutRunnerId.runnerId;

    expect(RunnerCapabilitiesSchema.safeParse(capabilityWithoutRunnerId).success).toBe(true);
    expect(
      RunnerCapabilitiesSchema.safeParse(validRunnerCapabilities({ runnerId: "" })).success,
    ).toBe(false);
  });

  it("requires the documented contract version", async () => {
    const { RunnerCapabilitiesSchema } = await loadRunnerCapabilitiesModule();
    const capabilityWithoutContractVersion: Record<string, unknown> = validRunnerCapabilities();
    delete capabilityWithoutContractVersion.contractVersion;

    expect(RunnerCapabilitiesSchema.safeParse(capabilityWithoutContractVersion).success).toBe(
      false,
    );
    expect(
      RunnerCapabilitiesSchema.safeParse(
        validRunnerCapabilities({
          contractVersion: "2026-05-10.v0" as typeof CONTRACT_VERSION,
        }),
      ).success,
    ).toBe(false);
  });

  it("requires non-empty OS fields, shell, and reportedAt", async () => {
    const { RunnerCapabilitiesSchema } = await loadRunnerCapabilitiesModule();

    for (const key of ["platform", "release", "arch"] satisfies (keyof RunnerCapabilitiesOs)[]) {
      expect(
        RunnerCapabilitiesSchema.safeParse(
          validRunnerCapabilities({
            os: {
              ...validRunnerCapabilities().os,
              [key]: "",
            },
          }),
        ).success,
      ).toBe(false);
    }

    for (const key of ["shell", "reportedAt"] satisfies (keyof RunnerCapabilities)[]) {
      expect(
        RunnerCapabilitiesSchema.safeParse(validRunnerCapabilities({ [key]: "" })).success,
      ).toBe(false);
    }
  });

  it("requires maxConcurrentJobs to be a positive integer", async () => {
    const { RunnerCapabilitiesSchema } = await loadRunnerCapabilitiesModule();

    expect(
      RunnerCapabilitiesSchema.safeParse(validRunnerCapabilities({ maxConcurrentJobs: 1 })).success,
    ).toBe(true);

    for (const maxConcurrentJobs of [0, -1, 1.5]) {
      expect(
        RunnerCapabilitiesSchema.safeParse(validRunnerCapabilities({ maxConcurrentJobs })).success,
      ).toBe(false);
    }
  });

  it("requires dry-run and cancellation support flags to be booleans", async () => {
    const { RunnerCapabilitiesSchema } = await loadRunnerCapabilitiesModule();

    expect(
      RunnerCapabilitiesSchema.safeParse(
        validRunnerCapabilities({ supportsDryRun: "true" as never }),
      ).success,
    ).toBe(false);
    expect(
      RunnerCapabilitiesSchema.safeParse(
        validRunnerCapabilities({ supportsCancellation: 1 as never }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown top-level, OS, tools, and tool fields", async () => {
    const { RunnerCapabilitiesSchema } = await loadRunnerCapabilitiesModule();

    expect(
      RunnerCapabilitiesSchema.safeParse({
        ...validRunnerCapabilities(),
        metadata: {},
      }).success,
    ).toBe(false);
    expect(
      RunnerCapabilitiesSchema.safeParse(
        validRunnerCapabilities({
          os: {
            ...validRunnerCapabilities().os,
            codename: "not allowed",
          } as RunnerCapabilitiesOs,
        }),
      ).success,
    ).toBe(false);
    expect(
      RunnerCapabilitiesSchema.safeParse(
        validRunnerCapabilities({
          tools: {
            ...validRunnerCapabilities().tools,
            docker: {
              available: true,
            },
          } as RunnerCapabilitiesTools,
        }),
      ).success,
    ).toBe(false);
    expect(
      RunnerCapabilitiesSchema.safeParse(
        validRunnerCapabilities({
          tools: {
            git: {
              available: true,
              version: "2.49.0",
              metadata: {},
            } as ToolCapability,
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("exports runner capability schemas and inferred types from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();
    const capability: SharedRunnerCapabilities = validRunnerCapabilities();
    const os: SharedRunnerCapabilitiesOs = capability.os;
    const tools: SharedRunnerCapabilitiesTools = capability.tools;
    const tool: SharedToolCapability = {
      available: true,
      version: "2.49.0",
      path: "/usr/bin/git",
    };

    expect(shared.ToolCapabilitySchema?.safeParse(tool).success).toBe(true);
    expect(shared.RunnerCapabilitiesOsSchema?.safeParse(os).success).toBe(true);
    expect(shared.RunnerCapabilitiesToolsSchema?.safeParse(tools).success).toBe(true);
    expect(shared.RunnerCapabilitiesSchema?.safeParse(capability).success).toBe(true);

    assertEntrypointTypeExports({
      capability,
      os,
      tools,
      tool,
    });
  });
});
