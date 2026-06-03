import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const readRepoFile = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("managed execution cost boundary docs", () => {
  test("document Cortex-key AI scope, customer-owned execution defaults, and caps for managed implementation", () => {
    const mvpPlan = readRepoFile("MVP_PLAN.md");
    const productSpec = readRepoFile("PRODUCT_SPEC.md");
    const architecture = readRepoFile("ARCHITECTURE.md");
    const securityModel = readRepoFile("SECURITY_MODEL.md");
    const readme = readRepoFile("README.md");
    const combinedDocs = [mvpPlan, productSpec, architecture, securityModel, readme].join("\n");

    expect(combinedDocs).toContain(
      "Cortex-key AI usage is allowed for repo-readiness scanning, readiness report generation, task recommendation generation, and setup PR generation.",
    );
    expect(combinedDocs).toContain(
      "Source-changing implementation execution defaults to customer-owned local runner credentials and customer-owned Codex or API usage.",
    );
    expect(combinedDocs).toContain(
      "Any future Cortex-managed implementation execution path must require explicit credits or plan caps before work starts.",
    );
    expect(combinedDocs).toContain(
      "No Cortex-managed implementation execution path may run with unlimited spend or uncapped usage.",
    );
    expect(combinedDocs).not.toMatch(/unlimited\s+(?:Cortex|hosted|managed)\s+implementation/iu);
  });
});
