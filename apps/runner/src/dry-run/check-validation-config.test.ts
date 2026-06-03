import {
  CONTRACT_VERSION,
  DryRunCheckResultSchema,
  RiskFindingSchema,
  type RepoPolicy,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import {
  checkValidationConfig,
  type CheckValidationConfigResult,
} from "./check-validation-config.js";
import {
  checkValidationConfig as checkValidationConfigFromEntrypoint,
  type CheckValidationConfigOptions as CheckValidationConfigOptionsFromEntrypoint,
  type CheckValidationConfigResult as CheckValidationConfigResultFromEntrypoint,
} from "../index.js";

const UNSAFE_COMMAND_TEXT = [
  "pnpm test -- --reporter=verbose",
  "npm run lint",
  "SECRET_TOKEN=do-not-print",
  "GITHUB_TOKEN=ghp_validationsecret1234567890",
  "diff --git a/file.ts b/file.ts",
  "patch contains private code",
  "function leakedSource() { return token; }",
] as const;

describe("validation config dry-run check", () => {
  it("passes when at least one required non-empty validation command is configured", () => {
    const result = checkValidationConfig(validPolicy());

    expect(result).toEqual({
      check: {
        id: "validation_commands_configured",
        label: "Validation commands configured",
        status: "passed",
        message: "Required validation commands are configured.",
        metadata: {
          validationCommandCount: 2,
          requiredValidationCommandCount: 1,
          emptyCommandCount: 0,
        },
      },
      blockers: [],
      warnings: [],
    });
    expect(DryRunCheckResultSchema.safeParse(result.check).success).toBe(true);
    expectSafeSerializedResult(result);
  });

  it("blocks when validation commands are missing", () => {
    const result = checkValidationConfig(validPolicy({ validationCommands: [] }));

    expect(result.check).toEqual({
      id: "validation_commands_configured",
      label: "Validation commands configured",
      status: "failed",
      message: "No required validation commands are configured.",
      metadata: {
        validationCommandCount: 0,
        requiredValidationCommandCount: 0,
        emptyCommandCount: 0,
      },
    });
    expect(result.blockers).toEqual([missingValidationBlocker()]);
    expect(RiskFindingSchema.safeParse(result.blockers[0]).success).toBe(true);
  });

  it("blocks when the validation commands field is absent", () => {
    const policy = validPolicy() as Partial<RepoPolicy>;
    delete policy.validationCommands;

    const result = checkValidationConfig(policy as RepoPolicy);

    expect(result.check).toEqual({
      id: "validation_commands_configured",
      label: "Validation commands configured",
      status: "failed",
      message: "No required validation commands are configured.",
      metadata: {
        validationCommandCount: 0,
        requiredValidationCommandCount: 0,
        emptyCommandCount: 0,
      },
    });
    expect(result.blockers).toEqual([missingValidationBlocker()]);
  });

  it("blocks when validation commands are optional only", () => {
    const result = checkValidationConfig(
      validPolicy({
        validationCommands: [
          {
            id: "lint",
            label: "Lint",
            command: "npm run lint",
            timeoutSeconds: 60,
            required: false,
          },
        ],
      }),
    );

    expect(result.check).toEqual({
      id: "validation_commands_configured",
      label: "Validation commands configured",
      status: "failed",
      message: "No required validation commands are configured.",
      metadata: {
        validationCommandCount: 1,
        requiredValidationCommandCount: 0,
        emptyCommandCount: 0,
      },
    });
    expect(result.blockers).toEqual([missingValidationBlocker()]);
  });

  it.each(["", "   "])("blocks when any validation command string is blank: %j", (blankCommand) => {
    const result = checkValidationConfig(
      validPolicy({
        validationCommands: [
          {
            id: "test",
            label: "Tests",
            command: "pnpm test -- --reporter=verbose",
            timeoutSeconds: 60,
            required: true,
          },
          {
            id: "lint",
            label: "Lint",
            command: blankCommand,
            timeoutSeconds: 60,
            required: true,
          },
        ],
      }),
    );

    expect(result.check).toEqual({
      id: "validation_commands_configured",
      label: "Validation commands configured",
      status: "failed",
      message: "Validation command configuration contains blank commands.",
      metadata: {
        validationCommandCount: 2,
        requiredValidationCommandCount: 1,
        emptyCommandCount: 1,
      },
    });
    expect(result.blockers).toEqual([
      missingValidationBlocker("Validation command configuration contains blank commands."),
    ]);
    expectSafeSerializedResult(result);
  });

  it("keeps serialized readiness metadata free of command text and raw payloads", () => {
    const result = checkValidationConfig(
      validPolicy({
        validationCommands: [
          {
            id: "test",
            label: "Tests",
            command: "pnpm test -- --reporter=verbose",
            timeoutSeconds: 60,
            required: true,
          },
          {
            id: "lint",
            label: "Lint",
            command: "npm run lint",
            timeoutSeconds: 60,
            required: false,
          },
        ],
      }),
    );

    expectSafeSerializedResult(result);
  });

  it("exports the validation config check from the runner entrypoint", () => {
    const options: CheckValidationConfigOptionsFromEntrypoint = {};
    const result: CheckValidationConfigResultFromEntrypoint = checkValidationConfig(validPolicy());
    const localResult: CheckValidationConfigResult = result;

    expect(options).toEqual({});
    expect(localResult.check.id).toBe("validation_commands_configured");
    expect(checkValidationConfigFromEntrypoint).toBe(checkValidationConfig);
  });
});

const missingValidationBlocker = (message = "No required validation commands are configured.") => ({
  id: "risk:missing_validation",
  severity: "blocked",
  category: "missing_validation",
  message,
  paths: [],
});

const validPolicy = (overrides: Partial<RepoPolicy> = {}): RepoPolicy => ({
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: ["src/security/**"],
  sensitivePaths: [".env", ".env.*"],
  warningPaths: {
    packageLocks: ["pnpm-lock.yaml"],
    migrations: ["migrations/**"],
    infrastructure: [".github/**"],
    auth: ["src/auth/**"],
    billing: ["src/billing/**"],
  },
  validationCommands: [
    {
      id: "test",
      label: "Tests",
      command: "pnpm test -- --reporter=verbose",
      timeoutSeconds: 60,
      required: true,
    },
    {
      id: "lint",
      label: "Lint",
      command: "npm run lint",
      timeoutSeconds: 60,
      required: false,
    },
  ],
  maxChangedFiles: 50,
  allowUntrackedFiles: false,
  dryRunChecks: ["validation_commands_configured"],
  ...overrides,
});

const expectSafeSerializedResult = (result: unknown): void => {
  const serialized = JSON.stringify(result);

  for (const unsafeText of UNSAFE_COMMAND_TEXT) {
    expect(serialized).not.toContain(unsafeText);
  }
};
