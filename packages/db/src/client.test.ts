import { describe, expect, expectTypeOf, test, vi } from "vitest";

import type { Database, DatabaseClientAdapters } from "./client.js";
import type { schema } from "./schema.js";

const validPlaceholderDatabaseUrl = "postgresql://localhost/control_plane";

type ManualQueueDrizzleSurface = {
  insert: (table: typeof schema.runs) => unknown;
  query: {
    runs: {
      findMany: unknown;
    };
  };
};

describe("database client initialization", () => {
  test("exports the Drizzle database surface used by manual queue helpers", () => {
    expectTypeOf<Database>().toMatchTypeOf<ManualQueueDrizzleSurface>();
  });

  test("does not require DATABASE_URL when the package is imported", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    vi.resetModules();

    await expect(import("@control-plane/db")).resolves.toMatchObject({
      createDatabaseClient: expect.any(Function),
      dryRunResults: expect.any(Object),
      getDatabase: expect.any(Function),
      prArtifacts: expect.any(Object),
      validationResults: expect.any(Object),
    });
  });

  test("throws a safe configuration error when runtime access has no DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    vi.resetModules();

    const { getDatabase } = await import("@control-plane/db");

    expect(() => getDatabase()).toThrow(/DATABASE_URL/);
  });

  test("creates a client for a valid placeholder URL without connecting eagerly", async () => {
    const { createDatabaseClient, schema } = await import("@control-plane/db");
    const end = vi.fn(async () => undefined);
    const queryClient = { end };
    const database = { _: { schema } } as unknown as Database;
    const adapters = {
      drizzle: vi.fn(() => database),
      postgres: vi.fn(() => queryClient),
    } satisfies DatabaseClientAdapters;

    const client = createDatabaseClient(validPlaceholderDatabaseUrl, adapters);

    expect(client).toEqual({
      db: expect.any(Object),
      queryClient,
      close: expect.any(Function),
    });
    expect(adapters.postgres).toHaveBeenCalledWith(validPlaceholderDatabaseUrl, {
      max: 1,
      prepare: false,
    });
    expect(adapters.drizzle).toHaveBeenCalledWith(queryClient, {
      schema,
    });
    expect(end).not.toHaveBeenCalled();
  });
});
