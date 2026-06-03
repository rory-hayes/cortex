import { describe, expect, it } from "vitest";

import { redactLogText } from "./redact.js";

type RedactionFixture = {
  name: string;
  input: string;
  secrets: readonly string[];
  expectedTextIncludes: readonly string[];
};

const baseSyntheticSecrets = [
  "SUPER_SECRET_DOTENV_VALUE_12345",
  "FAKE_PRIVATE_KEY_BODY_1234567890",
  "https://deploy-user:deploy-pass@example.test/repo.git",
  "ghp_abcdefghijklmnopqrstuvwxyz123456",
  "github_pat_11AA22BB33CC_abcdefghijklmnopqrstuvwxyz1234567890",
  "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH",
  "AKIAIOSFODNN7EXAMPLE",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  "ya29.a0AfH6SMBabcdefghijklmnopqrstuvwxyz1234567890",
  "password-from-fixture-12345",
  "api-key-from-fixture-12345",
  "token-from-fixture-12345",
  "secret-from-fixture-12345",
  "json-password-fixture-12345",
  "json-api-key-fixture-12345",
  "lowercase-dotenv-password-fixture-12345",
  "N0qF7zR2vL9xP4mK8sD1hT6wY3cB5nJ2uE9aQ7rV4pX1",
] as const;

const realWorldRedactionFixtures = [
  {
    name: "GitHub token variants",
    input: [
      "before github tokens",
      "github classic ghp_fakeGithubClassicToken1234567890",
      "github oauth gho_fakeGithubOauthToken1234567890",
      "github user ghu_fakeGithubUserToken1234567890",
      "github server ghs_fakeGithubServerToken1234567890",
      "github refresh ghr_fakeGithubRefreshToken1234567890",
      "github fine-grained github_pat_11AA22BB33CC_fakeFineGrainedGithubToken1234567890",
      "after github tokens",
    ].join("\n"),
    secrets: [
      "ghp_fakeGithubClassicToken1234567890",
      "gho_fakeGithubOauthToken1234567890",
      "ghu_fakeGithubUserToken1234567890",
      "ghs_fakeGithubServerToken1234567890",
      "ghr_fakeGithubRefreshToken1234567890",
      "github_pat_11AA22BB33CC_fakeFineGrainedGithubToken1234567890",
    ],
    expectedTextIncludes: [
      "before github tokens",
      "github classic [REDACTED_SECRET]",
      "github oauth [REDACTED_SECRET]",
      "github user [REDACTED_SECRET]",
      "github server [REDACTED_SECRET]",
      "github refresh [REDACTED_SECRET]",
      "github fine-grained [REDACTED_SECRET]",
      "after github tokens",
    ],
  },
  {
    name: "Linear API and OAuth bearer credentials",
    input: [
      "linear api lin_api_fakeLinearApiToken1234567890",
      "Authorization: Bearer linear-oauth-access-token-fixture-12345",
    ].join("\n"),
    secrets: ["lin_api_fakeLinearApiToken1234567890", "linear-oauth-access-token-fixture-12345"],
    expectedTextIncludes: [
      "linear api [REDACTED_SECRET]",
      "Authorization: Bearer [REDACTED_SECRET]",
    ],
  },
  {
    name: "OpenAI key variants",
    input: [
      "openai default sk-fakeOpenAISecretKey1234567890",
      "openai project sk-proj-fakeOpenAIProjectKey1234567890",
      "openai service sk-svcacct-fakeOpenAIServiceAccountKey1234567890",
    ].join("\n"),
    secrets: [
      "sk-fakeOpenAISecretKey1234567890",
      "sk-proj-fakeOpenAIProjectKey1234567890",
      "sk-svcacct-fakeOpenAIServiceAccountKey1234567890",
    ],
    expectedTextIncludes: [
      "openai default [REDACTED_SECRET]",
      "openai project [REDACTED_SECRET]",
      "openai service [REDACTED_SECRET]",
    ],
  },
  {
    name: "generic bearer headers",
    input: [
      "before bearer",
      "Authorization: Bearer opaque-session-token-without-provider-prefix",
      "after bearer",
    ].join("\n"),
    secrets: ["opaque-session-token-without-provider-prefix"],
    expectedTextIncludes: [
      "before bearer",
      "Authorization: Bearer [REDACTED_SECRET]",
      "after bearer",
    ],
  },
  {
    name: "private key block labels",
    input: [
      "loading rsa key",
      "-----BEGIN RSA PRIVATE KEY-----",
      "FAKE_RSA_PRIVATE_KEY_BODY_1234567890",
      "-----END RSA PRIVATE KEY-----",
      "loading ec key",
      "-----BEGIN EC PRIVATE KEY-----",
      "FAKE_EC_PRIVATE_KEY_BODY_1234567890",
      "-----END EC PRIVATE KEY-----",
      "loading openssh key",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "FAKE_OPENSSH_PRIVATE_KEY_BODY_1234567890",
      "-----END OPENSSH PRIVATE KEY-----",
      "loading generic key",
      "-----BEGIN PRIVATE KEY-----",
      "FAKE_GENERIC_PRIVATE_KEY_BODY_1234567890",
      "-----END PRIVATE KEY-----",
      "done loading keys",
    ].join("\n"),
    secrets: [
      "FAKE_RSA_PRIVATE_KEY_BODY_1234567890",
      "FAKE_EC_PRIVATE_KEY_BODY_1234567890",
      "FAKE_OPENSSH_PRIVATE_KEY_BODY_1234567890",
      "FAKE_GENERIC_PRIVATE_KEY_BODY_1234567890",
    ],
    expectedTextIncludes: [
      "loading rsa key",
      "loading ec key",
      "loading openssh key",
      "loading generic key",
      "done loading keys",
      "[REDACTED_PRIVATE_KEY]",
    ],
  },
  {
    name: "credential URLs with password and token-only userinfo",
    input: [
      "before credential URLs",
      "service https://user:p%40ss@example.test/path",
      "clone https://deploy-user-fixture:deploy-password-fixture@example.test/repo.git",
      "metadata https://token-only-userinfo-fixture@example.test/org/repo?ref=main",
      "after credential URLs",
    ].join("\n"),
    secrets: [
      "user:p%40ss",
      "p%40ss",
      "deploy-user-fixture",
      "deploy-password-fixture",
      "token-only-userinfo-fixture",
    ],
    expectedTextIncludes: [
      "before credential URLs",
      "service https://[REDACTED_CREDENTIALS]@example.test/path",
      "clone https://[REDACTED_CREDENTIALS]@example.test/repo.git",
      "metadata https://[REDACTED_CREDENTIALS]@example.test/org/repo?ref=main",
      "after credential URLs",
    ],
  },
  {
    name: "provider env lines and varied secret assignments",
    input: [
      "before env lines",
      "export GITHUB_TOKEN=ghp_envGithubToken1234567890",
      'OPENAI_API_KEY="sk-proj-envOpenAIProjectKey1234567890"',
      "LINEAR_API_KEY='lin_api_envLinearToken1234567890'",
      "DATABASE_URL=postgres://env-user:env-pass@example.test/app",
      'export mixedCaseSecret = "quoted-env-secret-value-12345"',
      "database_token='single-quoted-env-token-value-12345'",
      "lowercase_secret=unquoted-env-secret-value-12345",
      "ApiSecret = whitespace-env-secret-value-12345",
      "after env lines",
    ].join("\n"),
    secrets: [
      "ghp_envGithubToken1234567890",
      "sk-proj-envOpenAIProjectKey1234567890",
      "lin_api_envLinearToken1234567890",
      "postgres://env-user:env-pass@example.test/app",
      "quoted-env-secret-value-12345",
      "single-quoted-env-token-value-12345",
      "unquoted-env-secret-value-12345",
      "whitespace-env-secret-value-12345",
    ],
    expectedTextIncludes: [
      "before env lines",
      "export GITHUB_TOKEN=[REDACTED_SECRET]",
      "OPENAI_API_KEY=[REDACTED_SECRET]",
      "LINEAR_API_KEY=[REDACTED_SECRET]",
      "DATABASE_URL=[REDACTED_SECRET]",
      "export mixedCaseSecret = [REDACTED_SECRET]",
      "database_token=[REDACTED_SECRET]",
      "lowercase_secret=[REDACTED_SECRET]",
      "ApiSecret = [REDACTED_SECRET]",
      "after env lines",
    ],
  },
] satisfies readonly RedactionFixture[];

const syntheticSecrets = [
  ...baseSyntheticSecrets,
  ...realWorldRedactionFixtures.flatMap((fixture) => fixture.secrets),
];

const expectRedactedFixture = (fixture: RedactionFixture): void => {
  const result = redactLogText(fixture.input);
  const serializedResult = JSON.stringify(result);

  expect(result.redactionApplied).toBe(true);
  expect(Object.keys(result).sort()).toEqual(["redactionApplied", "text"]);

  for (const secret of fixture.secrets) {
    expect(serializedResult).not.toContain(secret);
  }

  for (const expectedText of fixture.expectedTextIncludes) {
    expect(result.text).toContain(expectedText);
  }
};

describe("redactLogText", () => {
  it("leaves ordinary output unchanged", () => {
    const input = "tests passed\n2 files checked\n";

    expect(redactLogText(input)).toEqual({
      text: input,
      redactionApplied: false,
    });
  });

  it("redacts dotenv-style assignment lines", () => {
    const result = redactLogText(
      [
        "before",
        "DATABASE_URL=postgres://example.invalid/app",
        "export API_TOKEN=SUPER_SECRET_DOTENV_VALUE_12345",
        "after",
      ].join("\n"),
    );

    expect(result.redactionApplied).toBe(true);
    expect(result.text).toContain("DATABASE_URL=[REDACTED_SECRET]");
    expect(result.text).toContain("export API_TOKEN=[REDACTED_SECRET]");
    expect(result.text).not.toContain("SUPER_SECRET_DOTENV_VALUE_12345");
  });

  it("redacts private key blocks", () => {
    const result = redactLogText(
      [
        "loading key",
        "-----BEGIN PRIVATE KEY-----",
        "FAKE_PRIVATE_KEY_BODY_1234567890",
        "-----END PRIVATE KEY-----",
        "done",
      ].join("\n"),
    );

    expect(result.redactionApplied).toBe(true);
    expect(result.text).toContain("[REDACTED_PRIVATE_KEY]");
    expect(result.text).not.toContain("FAKE_PRIVATE_KEY_BODY_1234567890");
  });

  it("redacts credential URLs", () => {
    const result = redactLogText("fetching https://deploy-user:deploy-pass@example.test/repo.git");

    expect(result.redactionApplied).toBe(true);
    expect(result.text).toContain("https://[REDACTED_CREDENTIALS]@example.test/repo.git");
    expect(result.text).not.toContain("deploy-user");
    expect(result.text).not.toContain("deploy-pass");
  });

  it("redacts provider, JWT, and OAuth-style tokens", () => {
    const result = redactLogText(
      [
        "github token ghp_abcdefghijklmnopqrstuvwxyz123456",
        "fine-grained github token github_pat_11AA22BB33CC_abcdefghijklmnopqrstuvwxyz1234567890",
        "openai key sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH",
        "aws key AKIAIOSFODNN7EXAMPLE",
        "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        "oauth ya29.a0AfH6SMBabcdefghijklmnopqrstuvwxyz1234567890",
      ].join("\n"),
    );

    expect(result.redactionApplied).toBe(true);
    expect(result.text.match(/\[REDACTED_SECRET\]/g)).toHaveLength(6);
    expect(result.text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(result.text).not.toContain("github_pat_11AA22BB33CC");
    expect(result.text).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH");
    expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.text).not.toContain("eyJhbGciOiJIUzI1Ni");
    expect(result.text).not.toContain("ya29.a0AfH6SMB");
  });

  it("redacts password, api key, token, and secret assignments", () => {
    const result = redactLogText(
      [
        "password: password-from-fixture-12345",
        "api_key = api-key-from-fixture-12345",
        "accessToken: token-from-fixture-12345",
        "clientSecret = secret-from-fixture-12345",
      ].join("\n"),
    );

    expect(result.redactionApplied).toBe(true);
    expect(result.text).toContain("password: [REDACTED_SECRET]");
    expect(result.text).toContain("api_key = [REDACTED_SECRET]");
    expect(result.text).toContain("accessToken: [REDACTED_SECRET]");
    expect(result.text).toContain("clientSecret = [REDACTED_SECRET]");
    expect(result.text).not.toContain("password-from-fixture-12345");
    expect(result.text).not.toContain("api-key-from-fixture-12345");
    expect(result.text).not.toContain("token-from-fixture-12345");
    expect(result.text).not.toContain("secret-from-fixture-12345");
  });

  it("redacts quoted secret keys in serialized log output", () => {
    const result = redactLogText(
      [
        '{"password":"json-password-fixture-12345"}',
        '"api_key": "json-api-key-fixture-12345"',
      ].join("\n"),
    );

    expect(result.redactionApplied).toBe(true);
    expect(result.text).toContain('"password":"[REDACTED_SECRET]"');
    expect(result.text).toContain('"api_key": "[REDACTED_SECRET]"');
    expect(result.text).not.toContain("json-password-fixture-12345");
    expect(result.text).not.toContain("json-api-key-fixture-12345");
  });

  it("redacts lower and mixed-case dotenv-style secret assignment lines", () => {
    const result = redactLogText(
      [
        "db_password=lowercase-dotenv-password-fixture-12345",
        "Exported_Mixed_Token=secret-from-fixture-12345",
      ].join("\n"),
    );

    expect(result.redactionApplied).toBe(true);
    expect(result.text).toContain("db_password=[REDACTED_SECRET]");
    expect(result.text).toContain("Exported_Mixed_Token=[REDACTED_SECRET]");
    expect(result.text).not.toContain("lowercase-dotenv-password-fixture-12345");
    expect(result.text).not.toContain("secret-from-fixture-12345");
  });

  it("redacts high-entropy mixed strings", () => {
    const result = redactLogText("bearer token N0qF7zR2vL9xP4mK8sD1hT6wY3cB5nJ2uE9aQ7rV4pX1");

    expect(result).toEqual({
      text: "bearer token [REDACTED_SECRET]",
      redactionApplied: true,
    });
  });

  for (const fixture of realWorldRedactionFixtures) {
    it(`redacts ${fixture.name}`, () => {
      expectRedactedFixture(fixture);
    });
  }

  it("does not serialize original synthetic secret fixtures in redaction results", () => {
    const result = redactLogText(
      [
        "DATABASE_PASSWORD=SUPER_SECRET_DOTENV_VALUE_12345",
        "-----BEGIN PRIVATE KEY-----",
        "FAKE_PRIVATE_KEY_BODY_1234567890",
        "-----END PRIVATE KEY-----",
        "remote https://deploy-user:deploy-pass@example.test/repo.git",
        "ghp_abcdefghijklmnopqrstuvwxyz123456",
        "github_pat_11AA22BB33CC_abcdefghijklmnopqrstuvwxyz1234567890",
        "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH",
        "AKIAIOSFODNN7EXAMPLE",
        "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        "oauth ya29.a0AfH6SMBabcdefghijklmnopqrstuvwxyz1234567890",
        "password: password-from-fixture-12345",
        "api_key = api-key-from-fixture-12345",
        "accessToken: token-from-fixture-12345",
        "clientSecret = secret-from-fixture-12345",
        '{"password":"json-password-fixture-12345"}',
        '"api_key": "json-api-key-fixture-12345"',
        "db_password=lowercase-dotenv-password-fixture-12345",
        "bearer token N0qF7zR2vL9xP4mK8sD1hT6wY3cB5nJ2uE9aQ7rV4pX1",
        ...realWorldRedactionFixtures.map((fixture) => fixture.input),
      ].join("\n"),
    );

    const serializedResult = JSON.stringify(result);

    expect(result.redactionApplied).toBe(true);
    for (const secret of syntheticSecrets) {
      expect(serializedResult).not.toContain(secret);
    }
    expect(Object.keys(result).sort()).toEqual(["redactionApplied", "text"]);
  });
});
