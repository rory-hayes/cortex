import { createRequire } from "node:module";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { DatabaseConfigurationError, parseDatabaseEnv } from "./env.js";
import { schema } from "./schema.js";

type QueryClient = {
  end: (options?: { timeout?: number }) => Promise<void>;
};

export type Database = PostgresJsDatabase<typeof schema>;

export type DatabaseClient = {
  db: Database;
  queryClient: QueryClient;
  close: () => Promise<void>;
};

export type DatabaseClientAdapters = {
  drizzle: (queryClient: QueryClient, options: { schema: typeof schema }) => Database;
  postgres: (databaseUrl: string, options: { max: number; prepare: boolean }) => QueryClient;
};

const require = createRequire(import.meta.url);

const loadDatabaseAdapters = (): DatabaseClientAdapters => {
  try {
    const postgresModule = require("postgres") as { default?: DatabaseClientAdapters["postgres"] };
    const drizzleModule = require("drizzle-orm/postgres-js") as {
      drizzle?: DatabaseClientAdapters["drizzle"];
    };
    const postgres =
      postgresModule.default ?? (postgresModule as DatabaseClientAdapters["postgres"]);
    const drizzle = drizzleModule.drizzle;

    if (typeof postgres !== "function" || typeof drizzle !== "function") {
      throw new Error("Invalid database adapter shape.");
    }

    return { drizzle, postgres };
  } catch {
    throw new DatabaseConfigurationError(
      "Database runtime dependencies are unavailable for DATABASE_URL access.",
    );
  }
};

let cachedDatabaseClient: DatabaseClient | undefined;

export const createDatabaseClient = (
  databaseUrl: string,
  adapters?: DatabaseClientAdapters,
): DatabaseClient => {
  const env = parseDatabaseEnv({ DATABASE_URL: databaseUrl });
  const databaseAdapters = adapters ?? loadDatabaseAdapters();
  const queryClient = databaseAdapters.postgres(env.databaseUrl, {
    max: 1,
    prepare: false,
  });
  const db = databaseAdapters.drizzle(queryClient, { schema });

  return {
    close: () => queryClient.end({ timeout: 5 }),
    db,
    queryClient,
  };
};

export const getDatabase = (): DatabaseClient => {
  cachedDatabaseClient ??= createDatabaseClient(parseDatabaseEnv(process.env).databaseUrl);

  return cachedDatabaseClient;
};
