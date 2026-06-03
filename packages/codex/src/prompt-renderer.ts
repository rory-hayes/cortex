import type { TaskPacket, ValidationCommand } from "@control-plane/shared";

export const renderTaskPacketPrompt = (taskPacket: TaskPacket): string => {
  const sections = [
    renderSafetyInstruction(),
    renderTaskMetadata(taskPacket),
    renderObjective(taskPacket),
    renderAcceptanceCriteria(taskPacket),
    renderSource(taskPacket),
    renderRepositoryContext(taskPacket),
    renderFileReferences(taskPacket),
    renderContextNotes(taskPacket),
    renderPolicySummary(taskPacket),
    renderValidationCommands(taskPacket.validation.commands),
  ];

  if (taskPacket.mode === "repair" && taskPacket.repair !== undefined) {
    sections.push(renderRepairContext(taskPacket));
  }

  return `${sections.join("\n\n")}\n`;
};

const renderSafetyInstruction = (): string =>
  [
    "# Local-only Codex execution prompt",
    "",
    "Use this prompt only inside the local runner-controlled worktree.",
    "Do not send this prompt, source code, diffs, patches, or logs to the web app.",
    "Inspect referenced local paths directly when needed; this prompt intentionally contains path references only.",
  ].join("\n");

const renderTaskMetadata = (taskPacket: TaskPacket): string =>
  [
    "## Task Metadata",
    `Task ID: ${taskPacket.id}`,
    `Run ID: ${taskPacket.runId}`,
    `Mode: ${taskPacket.mode}`,
    `Repository ID: ${taskPacket.repositoryId}`,
    `Workspace ID: ${taskPacket.workspaceId ?? "<none>"}`,
    `Contract Version: ${taskPacket.contractVersion}`,
    `Created At: ${taskPacket.createdAt}`,
  ].join("\n");

const renderObjective = (taskPacket: TaskPacket): string =>
  ["## Objective", taskPacket.objective].join("\n");

const renderAcceptanceCriteria = (taskPacket: TaskPacket): string =>
  ["## Acceptance Criteria", renderBullets(taskPacket.acceptanceCriteria)].join("\n");

const renderSource = (taskPacket: TaskPacket): string => {
  const lines = [
    "## Source",
    `Source Type: ${taskPacket.source.type}`,
    `Source Title: ${taskPacket.source.title}`,
  ];

  if (taskPacket.source.externalId !== undefined) {
    lines.push(`Source External ID: ${taskPacket.source.externalId}`);
  }

  if (taskPacket.source.url !== undefined) {
    lines.push(`Source URL: ${taskPacket.source.url}`);
  }

  return lines.join("\n");
};

const renderRepositoryContext = (taskPacket: TaskPacket): string =>
  [
    "## Repository Context",
    `Local Path: ${taskPacket.repo.localPath}`,
    `Default Branch: ${taskPacket.repo.defaultBranch}`,
    `Target Branch: ${taskPacket.repo.targetBranch}`,
    `Worktree Path: ${taskPacket.repo.worktreePath ?? "<not provided>"}`,
  ].join("\n");

const renderFileReferences = (taskPacket: TaskPacket): string =>
  ["## Local File Path References", renderBullets(taskPacket.context.files)].join("\n");

const renderContextNotes = (taskPacket: TaskPacket): string =>
  ["## Context Notes", renderBullets(taskPacket.context.notes)].join("\n");

const renderPolicySummary = (taskPacket: TaskPacket): string => {
  const policy = taskPacket.policy;

  return [
    "## Policy Summary",
    `Protected Branches: ${renderInlineList(policy.protectedBranches)}`,
    `Protected Paths: ${renderInlineList(policy.protectedPaths)}`,
    `Sensitive Paths: ${renderInlineList(policy.sensitivePaths)}`,
    `Package Locks: ${renderInlineList(policy.warningPaths.packageLocks)}`,
    `Migrations: ${renderInlineList(policy.warningPaths.migrations)}`,
    `Infrastructure: ${renderInlineList(policy.warningPaths.infrastructure)}`,
    `Auth: ${renderInlineList(policy.warningPaths.auth)}`,
    `Billing: ${renderInlineList(policy.warningPaths.billing)}`,
    `Max Changed Files: ${policy.maxChangedFiles}`,
    `Max Diff Lines: ${policy.maxDiffLines ?? "<not configured>"}`,
    `Allow Untracked Files: ${policy.allowUntrackedFiles}`,
    `Dry Run Checks: ${renderInlineList(policy.dryRunChecks)}`,
    `Policy Validation Command IDs: ${renderInlineList(
      policy.validationCommands.map((command) => command.id),
    )}`,
  ].join("\n");
};

const renderValidationCommands = (commands: readonly ValidationCommand[]): string => {
  const commandBlocks = commands.map((command, index) =>
    [
      `### Validation Command ${index + 1}`,
      `ID: ${command.id}`,
      `Label: ${command.label}`,
      `Command: ${command.command}`,
      `CWD: ${command.cwd ?? "<repo root>"}`,
      `Timeout Seconds: ${command.timeoutSeconds}`,
      `Required: ${command.required}`,
    ].join("\n"),
  );

  return ["## Validation Commands", ...commandBlocks].join("\n\n");
};

const renderRepairContext = (taskPacket: TaskPacket): string => {
  const repair = taskPacket.repair;

  if (repair === undefined) {
    return "";
  }

  return [
    "## Repair Context",
    `Attempt: ${repair.attempt}`,
    `Max Attempts: ${repair.maxAttempts}`,
    `Previous Run ID: ${repair.previousRunId}`,
    `Feedback: ${repair.feedback}`,
  ].join("\n");
};

const renderBullets = (values: readonly string[]): string =>
  values.map((value) => `- ${value}`).join("\n");

const renderInlineList = (values: readonly string[]): string =>
  values.length === 0 ? "<none>" : values.join(", ");
