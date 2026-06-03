import { readFile } from "node:fs/promises";

import { TaskPacketSchema, type TaskPacket } from "@control-plane/shared";

export type TaskPacketLoaderErrorCode = "read_failed" | "invalid_json" | "invalid_task_packet";

export type TaskPacketLoaderIssue = {
  path: string;
  message: string;
};

type TaskPacketLoaderErrorOptions = {
  code: TaskPacketLoaderErrorCode;
  taskPacketPath: string;
  message: string;
  issues?: TaskPacketLoaderIssue[];
  cause?: unknown;
};

export class TaskPacketLoaderError extends Error {
  readonly code: TaskPacketLoaderErrorCode;
  readonly taskPacketPath: string;
  readonly issues: TaskPacketLoaderIssue[];

  constructor({ code, taskPacketPath, message, issues = [], cause }: TaskPacketLoaderErrorOptions) {
    super(message, { cause });
    this.name = "TaskPacketLoaderError";
    this.code = code;
    this.taskPacketPath = taskPacketPath;
    this.issues = issues;
  }
}

export const loadTaskPacket = async (taskPacketPath: string): Promise<TaskPacket> => {
  let contents: string;

  try {
    contents = await readFile(taskPacketPath, "utf8");
  } catch (error) {
    throw new TaskPacketLoaderError({
      code: "read_failed",
      taskPacketPath,
      message: `Unable to read task packet file at ${taskPacketPath}: read_failed.`,
      cause: error,
    });
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(contents);
  } catch {
    throw new TaskPacketLoaderError({
      code: "invalid_json",
      taskPacketPath,
      message: `Invalid JSON in task packet file at ${taskPacketPath}.`,
    });
  }

  const result = TaskPacketSchema.safeParse(parsedJson);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path),
      message: issue.message,
    }));

    throw new TaskPacketLoaderError({
      code: "invalid_task_packet",
      taskPacketPath,
      message: formatInvalidTaskPacketMessage(taskPacketPath, issues),
      issues,
    });
  }

  return result.data;
};

const formatInvalidTaskPacketMessage = (
  taskPacketPath: string,
  issues: TaskPacketLoaderIssue[],
): string => {
  if (issues.length === 0) {
    return `Invalid task packet file at ${taskPacketPath}: invalid_task_packet.`;
  }

  const issueSummary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");

  return `Invalid task packet file at ${taskPacketPath}: ${issueSummary}.`;
};

const formatIssuePath = (path: PropertyKey[]): string => {
  if (path.length === 0) {
    return "<root>";
  }

  return path.map((segment) => String(segment)).join(".");
};
