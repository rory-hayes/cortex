import { describe, expect, test } from "vitest";

import { parseDatabaseEnv } from "@control-plane/db";

const expectDatabaseUrlError = (value: string | undefined): void => {
  expect(() => parseDatabaseEnv({ DATABASE_URL: value })).toThrow(/DATABASE_URL/);

  try {
    parseDatabaseEnv({ DATABASE_URL: value });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    expect(message).toContain("DATABASE_URL");
    if (value !== undefined && value.trim() !== "") {
      expect(message).not.toContain(value);
    }
  }
};

describe("database environment parsing", () => {
  test("accepts non-empty Postgres database URLs", () => {
    expect(parseDatabaseEnv({ DATABASE_URL: "postgres://localhost/control_plane" })).toEqual({
      databaseUrl: "postgres://localhost/control_plane",
    });
    expect(parseDatabaseEnv({ DATABASE_URL: "postgresql://localhost/control_plane" })).toEqual({
      databaseUrl: "postgresql://localhost/control_plane",
    });
  });

  test("rejects missing or blank database URLs", () => {
    expectDatabaseUrlError(undefined);
    expectDatabaseUrlError("");
    expectDatabaseUrlError("   ");
  });

  test("rejects invalid or non-Postgres database URLs without echoing the value", () => {
    expectDatabaseUrlError("not-a-url");
    expectDatabaseUrlError("https://example.test/db");
    expectDatabaseUrlError("mysql://example.test/db");
  });
});
