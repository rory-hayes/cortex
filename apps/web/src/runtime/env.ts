import { parseDatabaseEnv } from "@control-plane/db";

export type RuntimeEnvGroup = "app" | "auth" | "database" | "github" | "linear";

export type RuntimeEnvRequirement = {
  readonly description: string;
  readonly group: RuntimeEnvGroup;
  readonly key: string;
  readonly required: boolean;
};

export type RuntimeEnvCheckStatus = "configured" | "invalid" | "missing" | "placeholder";

export type RuntimeEnvCheck = RuntimeEnvRequirement & {
  readonly message: string;
  readonly status: RuntimeEnvCheckStatus;
};

export type ProductionRuntimeReadiness = {
  readonly blockedKeys: string[];
  readonly checks: RuntimeEnvCheck[];
  readonly ready: boolean;
};

export type ProductionRuntimeEnvInput = Readonly<Record<string, string | undefined>>;

type RuntimeEnvValidator = (value: string) => string | undefined;

export const productionRuntimeRequirements = [
  {
    description: "Canonical hosted app URL used in links, callbacks, and task sync metadata.",
    group: "app",
    key: "WEB_BASE_URL",
    required: true,
  },
  {
    description: "Auth0 application base URL used for callback and logout redirects.",
    group: "auth",
    key: "APP_BASE_URL",
    required: true,
  },
  {
    description: "Auth0 tenant domain used by the Next.js SDK.",
    group: "auth",
    key: "AUTH0_DOMAIN",
    required: true,
  },
  {
    description: "Auth0 application client id.",
    group: "auth",
    key: "AUTH0_CLIENT_ID",
    required: true,
  },
  {
    description: "Auth0 application client secret used only on the server.",
    group: "auth",
    key: "AUTH0_CLIENT_SECRET",
    required: true,
  },
  {
    description: "Auth0 session-cookie encryption secret.",
    group: "auth",
    key: "AUTH0_SECRET",
    required: true,
  },
  {
    description: "Server-side Postgres connection string for the Supabase database.",
    group: "database",
    key: "DATABASE_URL",
    required: true,
  },
  {
    description: "GitHub App identifier used for installation API requests.",
    group: "github",
    key: "GITHUB_APP_ID",
    required: true,
  },
  {
    description: "GitHub App private key used only on the server for installation requests.",
    group: "github",
    key: "GITHUB_APP_PRIVATE_KEY",
    required: true,
  },
  {
    description: "GitHub webhook signing secret for repository events.",
    group: "github",
    key: "GITHUB_WEBHOOK_SECRET",
    required: true,
  },
  {
    description: "Optional Linear OAuth token sealing key for external task sync.",
    group: "linear",
    key: "LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY",
    required: false,
  },
  {
    description: "Optional Linear OAuth token sealing key identifier.",
    group: "linear",
    key: "LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY_ID",
    required: false,
  },
] as const satisfies readonly RuntimeEnvRequirement[];

const placeholderPattern =
  /^(?:<[^>]+>|\[[^\]]+\]|(?:todo|change[-_ ]?me|placeholder|example|dummy|sample|test)(?:[-_ ].*)?)$/iu;

const hasPlaceholderFragment = (value: string): boolean =>
  /(?:<[^>]+>|\[[^\]]+\]|placeholder|change[-_ ]?me|your[-_ ]?|dummy|example)/iu.test(value);

const normalizeValue = (value: string | undefined): string => value?.trim() ?? "";

const validateBaseUrl: RuntimeEnvValidator = (value) => {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:") {
      return "WEB_BASE_URL must be an HTTPS URL in production.";
    }

    return undefined;
  } catch {
    return "WEB_BASE_URL must be a valid HTTPS URL.";
  }
};

const validateAppBaseUrl: RuntimeEnvValidator = (value) => {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:") {
      return "APP_BASE_URL must be an HTTPS URL in production.";
    }

    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return "APP_BASE_URL must not include credentials, query strings, or hashes.";
    }

    return undefined;
  } catch {
    return "APP_BASE_URL must be a valid HTTPS URL.";
  }
};

const validateAuth0Domain: RuntimeEnvValidator = (value) => {
  if (/^https?:\/\//iu.test(value)) {
    return "AUTH0_DOMAIN must be a hostname, not a URL.";
  }

  try {
    const parsed = new URL(`https://${value}`);

    if (parsed.hostname !== value || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return "AUTH0_DOMAIN must be a hostname without a path, query string, or hash.";
    }

    if (!/^[a-z0-9.-]+$/iu.test(parsed.hostname)) {
      return "AUTH0_DOMAIN must be a valid hostname.";
    }

    return undefined;
  } catch {
    return "AUTH0_DOMAIN must be a valid hostname.";
  }
};

const validateAuth0Secret: RuntimeEnvValidator = (value) => {
  if (!/^[a-f0-9]{64}$/iu.test(value)) {
    return "AUTH0_SECRET must be a 64-character hex string.";
  }

  return undefined;
};

const validateDatabaseUrl: RuntimeEnvValidator = (value) => {
  try {
    parseDatabaseEnv({ DATABASE_URL: value });
  } catch {
    return "DATABASE_URL must be a valid Postgres connection URL.";
  }

  try {
    const parsed = new URL(value);

    if (hasPlaceholderFragment(parsed.username) || hasPlaceholderFragment(parsed.password)) {
      return "DATABASE_URL must include real database credentials, not placeholders.";
    }
  } catch {
    return "DATABASE_URL must be a valid Postgres connection URL.";
  }

  return undefined;
};

const validateGitHubAppId: RuntimeEnvValidator = (value) => {
  if (!/^\d+$/u.test(value)) {
    return "GITHUB_APP_ID must be a numeric GitHub App id.";
  }

  return undefined;
};

const validateGitHubPrivateKey: RuntimeEnvValidator = (value) => {
  const normalized = value.replace(/\\n/gu, "\n");

  if (
    !/-----BEGIN (?:RSA |EC |)PRIVATE KEY-----/u.test(normalized) ||
    !/-----END (?:RSA |EC |)PRIVATE KEY-----/u.test(normalized)
  ) {
    return "GITHUB_APP_PRIVATE_KEY must be a PEM private key or escaped PEM private key.";
  }

  return undefined;
};

const validators = new Map<string, RuntimeEnvValidator>([
  ["APP_BASE_URL", validateAppBaseUrl],
  ["AUTH0_DOMAIN", validateAuth0Domain],
  ["AUTH0_SECRET", validateAuth0Secret],
  ["WEB_BASE_URL", validateBaseUrl],
  ["DATABASE_URL", validateDatabaseUrl],
  ["GITHUB_APP_ID", validateGitHubAppId],
  ["GITHUB_APP_PRIVATE_KEY", validateGitHubPrivateKey],
]);

const checkRequirement = (
  requirement: RuntimeEnvRequirement,
  env: ProductionRuntimeEnvInput,
): RuntimeEnvCheck => {
  const value = normalizeValue(env[requirement.key]);

  if (!value) {
    return {
      ...requirement,
      message: requirement.required
        ? `${requirement.key} is required.`
        : `${requirement.key} is optional and not configured.`,
      status: "missing",
    };
  }

  if (placeholderPattern.test(value) || hasPlaceholderFragment(value)) {
    return {
      ...requirement,
      message: `${requirement.key} must be set to a real runtime value, not a placeholder.`,
      status: "placeholder",
    };
  }

  const invalidMessage = validators.get(requirement.key)?.(value);

  if (invalidMessage !== undefined) {
    return {
      ...requirement,
      message: invalidMessage,
      status: "invalid",
    };
  }

  return {
    ...requirement,
    message: `${requirement.key} is configured.`,
    status: "configured",
  };
};

export const assessProductionRuntimeEnv = (
  env: ProductionRuntimeEnvInput,
): ProductionRuntimeReadiness => {
  const checks = productionRuntimeRequirements.map((requirement) =>
    checkRequirement(requirement, env),
  );
  const blockedKeys = checks
    .filter((check) => check.required && check.status !== "configured")
    .map((check) => check.key);

  return {
    blockedKeys,
    checks,
    ready: blockedKeys.length === 0,
  };
};
