import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("HomePage", () => {
  test("defines the public auth entry point", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain('href="/auth/login"');
    expect(source).toContain('href="/auth/login?screen_hint=signup"');
    expect(source).toContain("Local execution stays on the runner");
  });
});
