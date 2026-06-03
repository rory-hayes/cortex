import { createMockCodexAdapter, type CodexAdapter } from "@control-plane/codex";

export const FIXTURE_CODEX_CHANGED_PATH = "src/app.txt";
export const FIXTURE_CODEX_FILE_CONTENTS =
  "fixture application\nmock codex fixture behavior applied\n";

export const createFixtureMockCodexAdapter = (): CodexAdapter =>
  createMockCodexAdapter({
    fileChanges: [
      {
        relativePath: FIXTURE_CODEX_CHANGED_PATH,
        contents: FIXTURE_CODEX_FILE_CONTENTS,
      },
    ],
  });
