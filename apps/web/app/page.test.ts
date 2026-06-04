import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("HomePage", () => {
  test("defines the public auth entry point", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain('const dashboardAuthReturnTo = "returnTo=%2Fdashboard";');
    expect(source).toContain("const signInHref = `/auth/login?${dashboardAuthReturnTo}`;");
    expect(source).toContain(
      "const signUpHref = `/auth/login?screen_hint=signup&${dashboardAuthReturnTo}`;",
    );
    expect(source).toContain("await auth0.getSession()");
    expect(source).toContain('redirect("/dashboard")');
    expect(source).toContain("Local execution stays on the runner");
  });
});
