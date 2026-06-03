import {
  DryRunCheckResultSchema,
  RiskFindingSchema,
  type DryRunCheckResult,
  type RepoPolicy,
  type RiskFinding,
} from "@control-plane/shared";

type ValidationConfigMetadata = {
  validationCommandCount: number;
  requiredValidationCommandCount: number;
  emptyCommandCount: number;
};

type ValidationCommandConfig = RepoPolicy["validationCommands"][number];

export type CheckValidationConfigOptions = Record<string, never>;

export type CheckValidationConfigResult = {
  check: DryRunCheckResult;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
};

export const checkValidationConfig = (policy: RepoPolicy): CheckValidationConfigResult => {
  const metadata = buildMetadata(policy);

  if (metadata.emptyCommandCount > 0) {
    return failedValidationConfig({
      message: "Validation command configuration contains blank commands.",
      metadata,
    });
  }

  if (metadata.requiredValidationCommandCount === 0) {
    return failedValidationConfig({
      message: "No required validation commands are configured.",
      metadata,
    });
  }

  return {
    check: buildCheck({
      status: "passed",
      message: "Required validation commands are configured.",
      metadata,
    }),
    blockers: [],
    warnings: [],
  };
};

const buildMetadata = (policy: RepoPolicy): ValidationConfigMetadata => {
  const validationCommands = getValidationCommands(policy);
  let requiredValidationCommandCount = 0;
  let emptyCommandCount = 0;

  for (const validationCommand of validationCommands) {
    const commandText =
      typeof validationCommand.command === "string" ? validationCommand.command : "";
    const hasCommandText = commandText.trim().length > 0;

    if (!hasCommandText) {
      emptyCommandCount += 1;
      continue;
    }

    if (validationCommand.required) {
      requiredValidationCommandCount += 1;
    }
  }

  return {
    validationCommandCount: validationCommands.length,
    requiredValidationCommandCount,
    emptyCommandCount,
  };
};

const getValidationCommands = (policy: RepoPolicy): readonly Partial<ValidationCommandConfig>[] =>
  Array.isArray(policy.validationCommands) ? policy.validationCommands : [];

const failedValidationConfig = (input: {
  message: string;
  metadata: ValidationConfigMetadata;
}): CheckValidationConfigResult => ({
  check: buildCheck({
    status: "failed",
    message: input.message,
    metadata: input.metadata,
  }),
  blockers: [buildMissingValidationFinding(input.message)],
  warnings: [],
});

const buildCheck = (input: {
  status: DryRunCheckResult["status"];
  message: string;
  metadata: ValidationConfigMetadata;
}): DryRunCheckResult =>
  DryRunCheckResultSchema.parse({
    id: "validation_commands_configured",
    label: "Validation commands configured",
    status: input.status,
    message: input.message,
    metadata: input.metadata,
  });

const buildMissingValidationFinding = (message: string): RiskFinding =>
  RiskFindingSchema.parse({
    id: "risk:missing_validation",
    severity: "blocked",
    category: "missing_validation",
    message,
    paths: [],
  });
