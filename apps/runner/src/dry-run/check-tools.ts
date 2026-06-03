import {
  DryRunCheckResultSchema,
  RiskFindingSchema,
  type DryRunCheckResult,
  type RiskFinding,
  type RunnerCapabilities,
  type TaskPacket,
} from "@control-plane/shared";

const TOOL_ORDER = ["git", "codex", "gh", "node", "npm", "pnpm", "yarn"] as const;
const VALIDATION_TOOL_NAMES = ["node", "npm", "pnpm", "yarn"] as const;

type ToolName = (typeof TOOL_ORDER)[number];
type ValidationToolName = (typeof VALIDATION_TOOL_NAMES)[number];

type RequiredToolsMetadata = {
  requiredTools: ToolName[];
  missingRequiredTools: ToolName[];
  optionalTools: ToolName[];
  unavailableOptionalTools: ToolName[];
  requiredToolCount: number;
  missingRequiredToolCount: number;
  optionalToolCount: number;
  unavailableOptionalToolCount: number;
};

type ToolRequirementSets = {
  requiredTools: Set<ToolName>;
  optionalTools: Set<ToolName>;
};

export type CheckRequiredToolsTaskInput = Pick<TaskPacket, "mode" | "validation">;

export type CheckRequiredToolsResult = {
  check: DryRunCheckResult;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
};

export const checkRequiredTools = (
  capabilities: RunnerCapabilities,
  task: CheckRequiredToolsTaskInput,
): CheckRequiredToolsResult => {
  const requirements = buildToolRequirements(task);
  const metadata = buildMetadata(capabilities, requirements);
  const blockers =
    metadata.missingRequiredTools.length === 0
      ? []
      : [
          buildMissingCapabilityFinding({
            severity: "blocked",
            message: `Missing required runner tools: ${metadata.missingRequiredTools.join(", ")}.`,
          }),
        ];
  const warnings =
    metadata.unavailableOptionalTools.length === 0
      ? []
      : [
          buildMissingCapabilityFinding({
            severity: "warning",
            message: `Optional runner tools are unavailable: ${metadata.unavailableOptionalTools.join(", ")}.`,
          }),
        ];

  if (blockers.length > 0) {
    return {
      check: buildCheck({
        status: "failed",
        message: "Required runner tools are unavailable.",
        metadata,
      }),
      blockers,
      warnings,
    };
  }

  if (warnings.length > 0) {
    return {
      check: buildCheck({
        status: "warning",
        message: "Optional runner tools are unavailable.",
        metadata,
      }),
      blockers,
      warnings,
    };
  }

  return {
    check: buildCheck({
      status: "passed",
      message: "Required runner tools are available.",
      metadata,
    }),
    blockers,
    warnings,
  };
};

const buildToolRequirements = (task: CheckRequiredToolsTaskInput): ToolRequirementSets => {
  const requiredTools = new Set<ToolName>(["git"]);
  const optionalTools = new Set<ToolName>();

  if (task.mode === "execute" || task.mode === "repair") {
    requiredTools.add("codex");
    requiredTools.add("gh");
  } else {
    optionalTools.add("codex");
  }

  for (const command of task.validation.commands) {
    const validationTool = inferValidationTool(command.command);

    if (validationTool === undefined) {
      continue;
    }

    if (command.required) {
      requiredTools.add(validationTool);
    } else {
      optionalTools.add(validationTool);
    }
  }

  for (const tool of requiredTools) {
    optionalTools.delete(tool);
  }

  return {
    requiredTools,
    optionalTools,
  };
};

const buildMetadata = (
  capabilities: RunnerCapabilities,
  requirements: ToolRequirementSets,
): RequiredToolsMetadata => {
  const requiredTools = sortTools(requirements.requiredTools);
  const optionalTools = sortTools(requirements.optionalTools);
  const missingRequiredTools = requiredTools.filter((tool) => !isToolAvailable(capabilities, tool));
  const unavailableOptionalTools = optionalTools.filter(
    (tool) => !isToolAvailable(capabilities, tool),
  );

  return {
    requiredTools,
    missingRequiredTools,
    optionalTools,
    unavailableOptionalTools,
    requiredToolCount: requiredTools.length,
    missingRequiredToolCount: missingRequiredTools.length,
    optionalToolCount: optionalTools.length,
    unavailableOptionalToolCount: unavailableOptionalTools.length,
  };
};

const isToolAvailable = (capabilities: RunnerCapabilities, tool: ToolName): boolean =>
  capabilities.tools[tool]?.available === true;

const sortTools = (tools: ReadonlySet<ToolName>): ToolName[] =>
  TOOL_ORDER.filter((tool) => tools.has(tool));

const inferValidationTool = (command: string): ValidationToolName | undefined => {
  const tokens = tokenizeCommand(command);
  let index = 0;

  if (normalizeExecutableToken(tokens[index]) === "env") {
    index += 1;
  }

  for (; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === undefined || isEnvironmentAssignment(token)) {
      continue;
    }

    const executable = normalizeExecutableToken(token);

    return isValidationToolName(executable) ? executable : undefined;
  }

  return undefined;
};

const tokenizeCommand = (command: string): string[] => {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  for (const character of command.trim()) {
    if (escaping) {
      token += character;
      escaping = false;
      continue;
    }

    if (character === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else {
        token += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (token.length > 0) {
        tokens.push(token);
        token = "";
      }
      continue;
    }

    token += character;
  }

  if (token.length > 0) {
    tokens.push(token);
  }

  return tokens;
};

const normalizeExecutableToken = (token: string | undefined): string | undefined => {
  if (token === undefined) {
    return undefined;
  }

  const executable = token
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(?:bat|cmd|exe)$/i, "");

  return executable?.toLowerCase();
};

const isEnvironmentAssignment = (token: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);

const isValidationToolName = (tool: string | undefined): tool is ValidationToolName =>
  tool !== undefined && VALIDATION_TOOL_NAMES.includes(tool as ValidationToolName);

const buildCheck = (input: {
  status: DryRunCheckResult["status"];
  message: string;
  metadata: RequiredToolsMetadata;
}): DryRunCheckResult =>
  DryRunCheckResultSchema.parse({
    id: "required_tools_available",
    label: "Required tools available",
    status: input.status,
    message: input.message,
    metadata: input.metadata,
  });

const buildMissingCapabilityFinding = (input: {
  severity: RiskFinding["severity"];
  message: string;
}): RiskFinding =>
  RiskFindingSchema.parse({
    id:
      input.severity === "blocked"
        ? "risk:missing_capability:required_tools"
        : "risk:missing_capability:optional_tools",
    severity: input.severity,
    category: "missing_capability",
    message: input.message,
    paths: [],
  });
