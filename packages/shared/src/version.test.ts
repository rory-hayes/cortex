import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION as ENTRYPOINT_CONTRACT_VERSION } from "@control-plane/shared";
import { CONTRACT_VERSION } from "./version.js";

describe("CONTRACT_VERSION", () => {
  it("exports the canonical v1 contract version from the package entrypoint", () => {
    expect(CONTRACT_VERSION).toBe("2026-05-10.v1");
    expect(ENTRYPOINT_CONTRACT_VERSION).toBe(CONTRACT_VERSION);
  });
});
