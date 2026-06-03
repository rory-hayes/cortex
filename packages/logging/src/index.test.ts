import { describe, expect, it } from "vitest";

import * as logging from "@control-plane/logging";
import type { RedactedLogText } from "@control-plane/logging";

const expectedRuntimeExportKeys = ["redactLogText"] as const;

type PublicLoggingTypeImports = readonly [RedactedLogText];

const publicLoggingTypeImports: PublicLoggingTypeImports | null = null;

describe("@control-plane/logging entrypoint", () => {
  it("exports the log redaction helper", () => {
    expect(Object.keys(logging).sort()).toEqual([...expectedRuntimeExportKeys].sort());
    expect(typeof logging.redactLogText).toBe("function");
    expect(publicLoggingTypeImports).toBeNull();
  });
});
