import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { RunEventSchema, type RunEvent } from "@control-plane/shared";

import { redactRunEvent } from "./events/redact-event.js";

export type EventWriterErrorCode = "invalid_event" | "write_failed";

export type EventWriterIssue = {
  path: string;
  message: string;
};

type EventWriterErrorOptions = {
  code: EventWriterErrorCode;
  eventsOutPath: string;
  message: string;
  issues?: EventWriterIssue[];
};

export class EventWriterError extends Error {
  readonly code: EventWriterErrorCode;
  readonly eventsOutPath: string;
  readonly issues: EventWriterIssue[];

  constructor({ code, eventsOutPath, message, issues = [] }: EventWriterErrorOptions) {
    super(message);
    this.name = "EventWriterError";
    this.code = code;
    this.eventsOutPath = eventsOutPath;
    this.issues = issues;
  }
}

export const appendRunEvent = async (eventsOutPath: string, event: unknown): Promise<RunEvent> => {
  const result = RunEventSchema.safeParse(redactRunEvent(event));

  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path),
      message: issue.message,
    }));

    throw new EventWriterError({
      code: "invalid_event",
      eventsOutPath,
      message: formatInvalidEventMessage(eventsOutPath, issues),
      issues,
    });
  }

  try {
    await mkdir(dirname(eventsOutPath), { recursive: true });
    await appendFile(eventsOutPath, `${JSON.stringify(result.data)}\n`, "utf8");
  } catch {
    throw new EventWriterError({
      code: "write_failed",
      eventsOutPath,
      message: `Unable to append run event to ${eventsOutPath}: write_failed.`,
    });
  }

  return result.data;
};

const formatInvalidEventMessage = (eventsOutPath: string, issues: EventWriterIssue[]): string => {
  if (issues.length === 0) {
    return `Invalid run event for ${eventsOutPath}: invalid_event.`;
  }

  const issueSummary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");

  return `Invalid run event for ${eventsOutPath}: ${issueSummary}.`;
};

const formatIssuePath = (path: PropertyKey[]): string => {
  if (path.length === 0) {
    return "<root>";
  }

  return path.map((segment) => String(segment)).join(".");
};
