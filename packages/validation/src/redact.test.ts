import { describe, expect, it } from "vitest";

import { redactValidationOutput } from "./redact.js";

const syntheticValidationSecrets = [
  "VALIDATION_DOTENV_SECRET_12345",
  "VALIDATION_PRIVATE_KEY_BODY_12345",
  "https://validation-user:validation-pass@example.test/repo.git",
  "ghp_validationabcdefghijklmnopqrstuvwxyz123456",
  "sk-proj-validationabcdefghijklmnopqrstuvwxyz1234567890",
  "AKIAIOSFODNN7EXAMPLE",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2YWxpZGF0aW9uIjoiMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  "validation-password-fixture-12345",
  "validation-json-token-fixture-12345",
  "validation-dotenv-secret-fixture-12345",
  "V4l1d8t10nH1ghEntr0pyString7Q9zX2cM5nB8pR3sT6",
] as const;

describe("redactValidationOutput", () => {
  it("leaves ordinary validation output unchanged", () => {
    const output = "vitest passed\ncoverage unchanged\n";

    expect(redactValidationOutput(output)).toEqual({
      text: output,
      redactionApplied: false,
    });
  });

  it("returns the validation redaction shape when secrets are removed", () => {
    const result = redactValidationOutput(
      [
        "API_TOKEN=VALIDATION_DOTENV_SECRET_12345",
        "-----BEGIN PRIVATE KEY-----",
        "VALIDATION_PRIVATE_KEY_BODY_12345",
        "-----END PRIVATE KEY-----",
        "remote https://validation-user:validation-pass@example.test/repo.git",
        "github ghp_validationabcdefghijklmnopqrstuvwxyz123456",
        "openai sk-proj-validationabcdefghijklmnopqrstuvwxyz1234567890",
        "aws AKIAIOSFODNN7EXAMPLE",
        "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2YWxpZGF0aW9uIjoiMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        "password: validation-password-fixture-12345",
        '{"token":"validation-json-token-fixture-12345"}',
        "db_password=validation-dotenv-secret-fixture-12345",
        "bearer token V4l1d8t10nH1ghEntr0pyString7Q9zX2cM5nB8pR3sT6",
      ].join("\n"),
    );

    const serializedResult = JSON.stringify(result);

    expect(result.redactionApplied).toBe(true);
    expect(result.text).toContain("[REDACTED_SECRET]");
    expect(result.text).toContain("[REDACTED_PRIVATE_KEY]");
    expect(result.text).toContain("https://[REDACTED_CREDENTIALS]@example.test/repo.git");
    expect(result.text).toContain('"token":"[REDACTED_SECRET]"');
    expect(result.text).toContain("db_password=[REDACTED_SECRET]");
    expect(Object.keys(result).sort()).toEqual(["redactionApplied", "text"]);
    for (const secret of syntheticValidationSecrets) {
      expect(serializedResult).not.toContain(secret);
    }
  });
});
