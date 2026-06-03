import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadTaskPacket, TaskPacketLoaderError } from "./task-packet-loader.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const VALID_TASK_PACKET_PATH = join(
  REPO_ROOT,
  "packages/shared/fixtures/v1/valid/task-packet.json",
);
const INVALID_SOURCE_LIKE_CONTEXT_PATH = join(
  REPO_ROOT,
  "packages/shared/fixtures/v1/invalid/task-packet-embedded-source-like-context.json",
);

const UNSAFE_ERROR_TEXT = [
  "[REDACTED_SOURCE_PAYLOAD]",
  "content",
  "packages/shared/src/index.ts",
  "raw-json-secret",
  "source-body-secret",
  '"objective"',
  '"context"',
];

describe("task packet loader", () => {
  it("loads a valid task packet fixture and returns typed task fields", async () => {
    const taskPacket = await loadTaskPacket(VALID_TASK_PACKET_PATH);

    expect(taskPacket.id).toBe("task-packet-task-022");
    expect(taskPacket.runId).toBe("run-task-022");
    expect(taskPacket.mode).toBe("execute");
    expect(taskPacket.repositoryId).toBe("repo-1");
  });

  it("rejects an invalid task packet fixture with safe schema issue summaries", async () => {
    const error = await expectTaskPacketLoaderError(
      loadTaskPacket(INVALID_SOURCE_LIKE_CONTEXT_PATH),
    );

    expect(error.code).toBe("invalid_task_packet");
    expect(error.taskPacketPath).toBe(INVALID_SOURCE_LIKE_CONTEXT_PATH);
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "context.files.0",
          message: expect.any(String),
        }),
      ]),
    );
    expect(error.message).toContain(INVALID_SOURCE_LIKE_CONTEXT_PATH);
    expect(error.message).toContain("context.files.0");
    expectSafeErrorText(error);
  });

  it("rejects invalid JSON without echoing file contents", async () => {
    const invalidJsonPath = await writeTempFile(
      "task-packet-loader-invalid-json-",
      "invalid-task-packet.json",
      '{"objective":"source-body-secret","context":{"files":[{"content":"[REDACTED_SOURCE_PAYLOAD]"}]',
    );

    const error = await expectTaskPacketLoaderError(loadTaskPacket(invalidJsonPath));

    expect(error.code).toBe("invalid_json");
    expect(error.taskPacketPath).toBe(invalidJsonPath);
    expect(error.issues).toEqual([]);
    expect(error.message).toContain(invalidJsonPath);
    expect(error.cause).toBeUndefined();
    expectSafeErrorText(error);
  });

  it("rejects a missing file with the path and a safe read error", async () => {
    const missingPath = join(tmpdir(), "control-plane-missing-task-packet.json");

    const error = await expectTaskPacketLoaderError(loadTaskPacket(missingPath));

    expect(error.code).toBe("read_failed");
    expect(error.taskPacketPath).toBe(missingPath);
    expect(error.issues).toEqual([]);
    expect(error.message).toContain(missingPath);
    expect(error.message).toContain("read_failed");
    expectSafeErrorText(error);
  });
});

const expectTaskPacketLoaderError = async (
  promise: Promise<unknown>,
): Promise<TaskPacketLoaderError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TaskPacketLoaderError);
    return error as TaskPacketLoaderError;
  }

  throw new Error("Expected task packet loader to reject.");
};

const writeTempFile = async (
  prefix: string,
  fileName: string,
  contents: string,
): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(directory, fileName);
  await writeFile(filePath, contents, "utf8");
  return filePath;
};

const expectSafeErrorText = (error: TaskPacketLoaderError): void => {
  const safeText = `${error.message}\n${JSON.stringify({
    code: error.code,
    issues: error.issues,
  })}`;

  for (const unsafeText of UNSAFE_ERROR_TEXT) {
    expect(safeText).not.toContain(unsafeText);
  }
};
