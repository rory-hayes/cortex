import {
  CONTRACT_VERSION,
  DryRunCheckResultSchema,
  RiskFindingSchema,
  type RunnerCapabilities,
  type TaskPacket,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import {
  checkRequiredTools,
  type CheckRequiredToolsResult,
  type CheckRequiredToolsTaskInput,
} from "./check-tools.js";
import {
  checkRequiredTools as checkRequiredToolsFromEntrypoint,
  type CheckRequiredToolsResult as CheckRequiredToolsResultFromEntrypoint,
  type CheckRequiredToolsTaskInput as CheckRequiredToolsTaskInputFromEntrypoint,
} from "../index.js";

const UNSAFE_TEXT = [
  "pnpm test -- --reporter=verbose",
  "npm run lint",
  "SECRET_TOKEN=do-not-print",
  "GITHUB_TOKEN=ghp_toolsecret1234567890",
  "diff --git a/file.ts b/file.ts",
  "patch contains private code",
  "function leakedSource() { return token; }",
  "/private/tool-path/bin/git",
  "/private/tool-path/bin/codex",
] as const;

describe("required tools dry-run check", () => {
  it("passes when required tools are available", () => {
    const result = checkRequiredTools(
      capabilitiesWith({
        git: true,
        gh: true,
        codex: true,
        pnpm: true,
      }),
      taskInput({
        mode: "execute",
        validationCommands: [validationCommand({ command: "pnpm test", required: true })],
      }),
    );

    expect(result).toEqual({
      check: {
        id: "required_tools_available",
        label: "Required tools available",
        status: "passed",
        message: "Required runner tools are available.",
        metadata: {
          requiredTools: ["git", "codex", "gh", "pnpm"],
          missingRequiredTools: [],
          optionalTools: [],
          unavailableOptionalTools: [],
          requiredToolCount: 4,
          missingRequiredToolCount: 0,
          optionalToolCount: 0,
          unavailableOptionalToolCount: 0,
        },
      },
      blockers: [],
      warnings: [],
    });
    expect(DryRunCheckResultSchema.safeParse(result.check).success).toBe(true);
    expectSafeSerializedResult(result);
  });

  it("blocks when git is missing", () => {
    const result = checkRequiredTools(
      capabilitiesWith({ gh: true, codex: true, pnpm: true }),
      taskInput({
        mode: "execute",
        validationCommands: [validationCommand({ command: "pnpm test", required: true })],
      }),
    );

    expect(result.check).toEqual({
      id: "required_tools_available",
      label: "Required tools available",
      status: "failed",
      message: "Required runner tools are unavailable.",
      metadata: {
        requiredTools: ["git", "codex", "gh", "pnpm"],
        missingRequiredTools: ["git"],
        optionalTools: [],
        unavailableOptionalTools: [],
        requiredToolCount: 4,
        missingRequiredToolCount: 1,
        optionalToolCount: 0,
        unavailableOptionalToolCount: 0,
      },
    });
    expect(result.blockers).toEqual([
      missingCapabilityBlocker("Missing required runner tools: git."),
    ]);
    expect(result.warnings).toEqual([]);
    expect(RiskFindingSchema.safeParse(result.blockers[0]).success).toBe(true);
  });

  it.each(["execute", "repair"] satisfies TaskPacket["mode"][])(
    "blocks when codex is missing for %s packets",
    (mode) => {
      const result = checkRequiredTools(
        capabilitiesWith({ git: true, gh: true, pnpm: true }),
        taskInput({
          mode,
          validationCommands: [validationCommand({ command: "pnpm test", required: true })],
        }),
      );

      expect(result.check.status).toBe("failed");
      expect(result.check.metadata).toEqual({
        requiredTools: ["git", "codex", "gh", "pnpm"],
        missingRequiredTools: ["codex"],
        optionalTools: [],
        unavailableOptionalTools: [],
        requiredToolCount: 4,
        missingRequiredToolCount: 1,
        optionalToolCount: 0,
        unavailableOptionalToolCount: 0,
      });
      expect(result.blockers).toEqual([
        missingCapabilityBlocker("Missing required runner tools: codex."),
      ]);
      expect(result.warnings).toEqual([]);
    },
  );

  it("warns instead of blocking when codex is missing for dryRun packets", () => {
    const result = checkRequiredTools(
      capabilitiesWith({ git: true, pnpm: true }),
      taskInput({
        mode: "dryRun",
        validationCommands: [validationCommand({ command: "pnpm test", required: true })],
      }),
    );

    expect(result.check).toEqual({
      id: "required_tools_available",
      label: "Required tools available",
      status: "warning",
      message: "Optional runner tools are unavailable.",
      metadata: {
        requiredTools: ["git", "pnpm"],
        missingRequiredTools: [],
        optionalTools: ["codex"],
        unavailableOptionalTools: ["codex"],
        requiredToolCount: 2,
        missingRequiredToolCount: 0,
        optionalToolCount: 1,
        unavailableOptionalToolCount: 1,
      },
    });
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([
      missingCapabilityWarning("Optional runner tools are unavailable: codex."),
    ]);
  });

  it.each(["execute", "repair"] satisfies TaskPacket["mode"][])(
    "blocks when gh is missing for PR-capable %s runs",
    (mode) => {
      const result = checkRequiredTools(
        capabilitiesWith({ git: true, codex: true, pnpm: true }),
        taskInput({
          mode,
          validationCommands: [validationCommand({ command: "pnpm test", required: true })],
        }),
      );

      expect(result.check.status).toBe("failed");
      expect(result.check.metadata).toEqual({
        requiredTools: ["git", "codex", "gh", "pnpm"],
        missingRequiredTools: ["gh"],
        optionalTools: [],
        unavailableOptionalTools: [],
        requiredToolCount: 4,
        missingRequiredToolCount: 1,
        optionalToolCount: 0,
        unavailableOptionalToolCount: 0,
      });
      expect(result.blockers).toEqual([
        missingCapabilityBlocker("Missing required runner tools: gh."),
      ]);
    },
  );

  it("blocks when required validation commands need unavailable node, npm, pnpm, or yarn", () => {
    const result = checkRequiredTools(
      capabilitiesWith({ git: true, gh: true, codex: true }),
      taskInput({
        mode: "execute",
        validationCommands: [
          validationCommand({ command: "node ./scripts/check.mjs", required: true }),
          validationCommand({ command: "npm run lint", required: true }),
          validationCommand({ command: "pnpm test", required: true }),
          validationCommand({ command: "yarn test", required: true }),
          validationCommand({ command: "python -m pytest", required: true }),
        ],
      }),
    );

    expect(result.check.status).toBe("failed");
    expect(result.check.metadata).toEqual({
      requiredTools: ["git", "codex", "gh", "node", "npm", "pnpm", "yarn"],
      missingRequiredTools: ["node", "npm", "pnpm", "yarn"],
      optionalTools: [],
      unavailableOptionalTools: [],
      requiredToolCount: 7,
      missingRequiredToolCount: 4,
      optionalToolCount: 0,
      unavailableOptionalToolCount: 0,
    });
    expect(result.blockers).toEqual([
      missingCapabilityBlocker("Missing required runner tools: node, npm, pnpm, yarn."),
    ]);
  });

  it("warns when only optional validation-command tools are unavailable", () => {
    const result = checkRequiredTools(
      capabilitiesWith({ git: true, gh: true, codex: true, pnpm: true }),
      taskInput({
        mode: "execute",
        validationCommands: [
          validationCommand({ command: "pnpm test", required: true }),
          validationCommand({ command: "node ./scripts/optional-check.mjs", required: false }),
          validationCommand({ command: "yarn audit", required: false }),
        ],
      }),
    );

    expect(result.check).toEqual({
      id: "required_tools_available",
      label: "Required tools available",
      status: "warning",
      message: "Optional runner tools are unavailable.",
      metadata: {
        requiredTools: ["git", "codex", "gh", "pnpm"],
        missingRequiredTools: [],
        optionalTools: ["node", "yarn"],
        unavailableOptionalTools: ["node", "yarn"],
        requiredToolCount: 4,
        missingRequiredToolCount: 0,
        optionalToolCount: 2,
        unavailableOptionalToolCount: 2,
      },
    });
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([
      missingCapabilityWarning("Optional runner tools are unavailable: node, yarn."),
    ]);
    expect(RiskFindingSchema.safeParse(result.warnings[0]).success).toBe(true);
  });

  it("keeps serialized check output free of command strings, tool paths, secrets, diffs, patches, source, and snippets", () => {
    const result = checkRequiredTools(
      capabilitiesWith({
        git: { available: false, path: UNSAFE_TEXT[7] },
        gh: { available: false, path: "/private/tool-path/bin/gh" },
        codex: { available: false, path: UNSAFE_TEXT[8] },
        pnpm: { available: false, path: "/private/tool-path/bin/pnpm" },
      }),
      taskInput({
        mode: "execute",
        validationCommands: [
          validationCommand({ command: UNSAFE_TEXT[0], required: true }),
          validationCommand({ command: `${UNSAFE_TEXT[2]} npm run lint`, required: false }),
          validationCommand({ command: UNSAFE_TEXT[4], required: false }),
          validationCommand({ command: UNSAFE_TEXT[6], required: false }),
        ],
      }),
    );

    expect(result.check.metadata).toEqual({
      requiredTools: ["git", "codex", "gh", "pnpm"],
      missingRequiredTools: ["git", "codex", "gh", "pnpm"],
      optionalTools: ["npm"],
      unavailableOptionalTools: ["npm"],
      requiredToolCount: 4,
      missingRequiredToolCount: 4,
      optionalToolCount: 1,
      unavailableOptionalToolCount: 1,
    });
    expectSafeSerializedResult(result);
  });

  it("exports the required tools check from the runner entrypoint", () => {
    const task: CheckRequiredToolsTaskInputFromEntrypoint = taskInput({
      mode: "dryRun",
      validationCommands: [validationCommand({ command: "pnpm test", required: true })],
    });
    const result: CheckRequiredToolsResultFromEntrypoint = checkRequiredTools(
      capabilitiesWith({ git: true, pnpm: true, codex: true }),
      task,
    );
    const localResult: CheckRequiredToolsResult = result;
    const localTask: CheckRequiredToolsTaskInput = task;

    expect(localTask.mode).toBe("dryRun");
    expect(localResult.check.id).toBe("required_tools_available");
    expect(checkRequiredToolsFromEntrypoint).toBe(checkRequiredTools);
  });
});

const missingCapabilityBlocker = (message: string) => ({
  id: "risk:missing_capability:required_tools",
  severity: "blocked",
  category: "missing_capability",
  message,
  paths: [],
});

const missingCapabilityWarning = (message: string) => ({
  id: "risk:missing_capability:optional_tools",
  severity: "warning",
  category: "missing_capability",
  message,
  paths: [],
});

const capabilitiesWith = (
  tools: Partial<
    Record<keyof RunnerCapabilities["tools"], boolean | RunnerCapabilities["tools"]["git"]>
  >,
): RunnerCapabilities => ({
  contractVersion: CONTRACT_VERSION,
  os: {
    platform: "test-platform",
    release: "1.2.3",
    arch: "arm64",
  },
  shell: "/bin/test-shell",
  tools: {
    git: toolCapability(tools.git),
    gh: toolCapability(tools.gh),
    codex: toolCapability(tools.codex),
    node: toolCapability(tools.node),
    npm: toolCapability(tools.npm),
    pnpm: toolCapability(tools.pnpm),
    yarn: toolCapability(tools.yarn),
    python: toolCapability(tools.python),
  },
  maxConcurrentJobs: 1,
  supportsDryRun: true,
  supportsCancellation: false,
  reportedAt: "2026-05-20T09:00:00.000Z",
});

const toolCapability = (
  value: boolean | RunnerCapabilities["tools"]["git"] | undefined,
): RunnerCapabilities["tools"]["git"] => {
  if (typeof value === "boolean") {
    return { available: value };
  }

  return value ?? { available: false };
};

const taskInput = (input: {
  mode: TaskPacket["mode"];
  validationCommands: CheckRequiredToolsTaskInput["validation"]["commands"];
}): CheckRequiredToolsTaskInput => ({
  mode: input.mode,
  validation: {
    commands: input.validationCommands,
  },
});

const validationCommand = (input: {
  command: string;
  required: boolean;
}): CheckRequiredToolsTaskInput["validation"]["commands"][number] => ({
  id: input.required ? `required-${input.command.length}` : `optional-${input.command.length}`,
  label: input.required ? "Required validation" : "Optional validation",
  command: input.command,
  timeoutSeconds: 60,
  required: input.required,
});

const expectSafeSerializedResult = (result: unknown): void => {
  const serialized = JSON.stringify(result);

  for (const unsafe of UNSAFE_TEXT) {
    expect(serialized).not.toContain(unsafe);
  }
  expect(serialized).not.toContain("tool-path");
  expect(serialized).not.toContain("source");
  expect(serialized).not.toContain("snippet");
};
