export type DatabaseEnv = {
  databaseUrl: string;
};

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export type DatabaseEnvInput = Readonly<
  {
    DATABASE_URL?: string | undefined;
  } & Record<string, string | undefined>
>;

const postgresProtocols = new Set(["postgres:", "postgresql:"]);

export const parseDatabaseEnv = (env: DatabaseEnvInput): DatabaseEnv => {
  const databaseUrl = env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new DatabaseConfigurationError("DATABASE_URL is required for database runtime access.");
  }

  try {
    const parsed = new URL(databaseUrl);

    if (!postgresProtocols.has(parsed.protocol)) {
      throw new DatabaseConfigurationError(
        "DATABASE_URL must be a valid postgres:// or postgresql:// URL.",
      );
    }
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      throw error;
    }

    throw new DatabaseConfigurationError(
      "DATABASE_URL must be a valid postgres:// or postgresql:// URL.",
    );
  }

  return { databaseUrl };
};
