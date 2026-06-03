import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("web database bridge", () => {
  test("keeps database helpers behind a server-only module boundary", async () => {
    const source = await readAppFile("../src/db.ts");

    expect(source).toContain('import "server-only";');
    expect(source).toContain('from "@control-plane/db"');
  });

  test("documents only a server-side placeholder database URL", async () => {
    const source = await readAppFile("../.env.example");

    expect(source).toContain("DATABASE_URL=<postgres-database-url-placeholder>");
    expect(source).not.toContain("NEXT_PUBLIC_DATABASE_URL");
    expect(source).not.toMatch(/postgres(?:ql)?:\/\/[^<\s]+:[^<\s]+@/);
  });
});
