import type { BacklogTask, ParsedBacklog, TaskStatus } from "./types.js";

const taskHeadingPattern = /^### ((?:TASK|RFB)-\d+) — (.+)$/gm;

export function parseBacklog(markdown: string): ParsedBacklog {
  const headings = [...markdown.matchAll(taskHeadingPattern)];
  const tasks: BacklogTask[] = headings.map((match, order) => {
    const id = mustGet(match, 1);
    const title = mustGet(match, 2).trim();
    const start = match.index ?? 0;
    const end = headings[order + 1]?.index ?? markdown.length;
    const raw = markdown.slice(start, end);
    const acceptanceCriteria = optionalField(raw, "Acceptance Criteria");
    const goal = optionalField(raw, "Goal");

    return {
      id,
      title,
      raw,
      status: readField(raw, "Status") as TaskStatus,
      priority: readField(raw, "Priority") || "P999",
      dependsOn: parseDependsOn(readField(raw, "Depends on")),
      validation: readField(raw, "Validation"),
      filesLikelyTouched: parseCommaSeparated(readField(raw, "Files Likely Touched")),
      ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
      ...(goal ? { goal } : {}),
      order,
      start,
      end,
    };
  });

  return { markdown, tasks };
}

export function selectReadyTasks(
  parsed: ParsedBacklog,
  options: { limit?: number } = {},
): BacklogTask[] {
  const completed = new Set(
    parsed.tasks.filter((task) => task.status === "[x]").map((task) => task.id),
  );
  const limit = options.limit ?? Number.POSITIVE_INFINITY;

  return parsed.tasks
    .filter((task) => task.status === "[ ]")
    .filter((task) => task.dependsOn.every((id) => completed.has(id)))
    .sort((left, right) => {
      const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
      return priorityDelta === 0 ? left.order - right.order : priorityDelta;
    })
    .slice(0, limit);
}

export function updateTaskStatus(
  markdown: string,
  taskId: string,
  update: {
    status: TaskStatus;
    completionNotes: string;
    validationResult: string;
    nextRecommendedTask: string;
  },
): string {
  const parsed = parseBacklog(markdown);
  const task = parsed.tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    throw new Error(`Cannot update unknown backlog task ${taskId}.`);
  }

  let section = task.raw;
  section = replaceRequiredField(section, "Status", update.status);
  section = upsertField(section, "Completion Notes", update.completionNotes);
  section = upsertField(section, "Validation Result", update.validationResult);
  section = upsertField(section, "Next Recommended Task", update.nextRecommendedTask);

  return `${markdown.slice(0, task.start)}${section}${markdown.slice(task.end)}`;
}

export function findNextReadyTaskId(markdown: string): string {
  const [next] = selectReadyTasks(parseBacklog(markdown), { limit: 1 });
  return next?.id ?? "None";
}

function readField(section: string, label: string): string {
  return optionalField(section, label) ?? "";
}

function optionalField(section: string, label: string): string | undefined {
  const escaped = escapeRegExp(label);
  const match = section.match(new RegExp(`^${escaped}:\\s*(.*)$`, "m"));
  return match?.[1]?.trim();
}

function replaceRequiredField(section: string, label: string, value: string): string {
  const escaped = escapeRegExp(label);
  const pattern = new RegExp(`^${escaped}:.*$`, "m");

  if (!pattern.test(section)) {
    throw new Error(`Task section is missing required field ${label}.`);
  }

  return section.replace(pattern, `${label}: ${value}`);
}

function upsertField(section: string, label: string, value: string): string {
  const escaped = escapeRegExp(label);
  const pattern = new RegExp(`^${escaped}:.*$`, "m");
  const line = `${label}: ${value}`;

  if (pattern.test(section)) {
    return section.replace(pattern, line);
  }

  const completionPattern = /^Completion Notes:.*$/m;
  if (label !== "Completion Notes" && completionPattern.test(section)) {
    return section.replace(completionPattern, (match) => `${match}\n${line}`);
  }

  return section.endsWith("\n") ? `${section}${line}\n` : `${section}\n${line}`;
}

function parseDependsOn(value: string): string[] {
  if (!value || value.toLowerCase() === "none") {
    return [];
  }

  return parseCommaSeparated(value);
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((dependency) => dependency.trim())
    .filter(Boolean);
}

function priorityRank(priority: string): number {
  const match = priority.match(/^P(\d+)$/i);
  return match?.[1] ? Number.parseInt(match[1], 10) : 999;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mustGet(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (!value) {
    throw new Error("Invalid backlog task heading.");
  }

  return value;
}
