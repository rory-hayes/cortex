import { describe, expect, it } from "vitest";

type ValidationCommand = {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  timeoutSeconds: number;
  required: boolean;
};

type ValidationCommandModule = {
  ValidationCommandSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
};

const loadValidationCommandModule = async () =>
  (await import("./validation-command.js")) as ValidationCommandModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<ValidationCommandModule>;

const validCommand = (overrides: Partial<ValidationCommand> = {}): ValidationCommand => ({
  id: "test",
  label: "Run tests",
  command: "pnpm test",
  timeoutSeconds: 120,
  required: true,
  ...overrides,
});

describe("ValidationCommand", () => {
  it("validates a required command with all required fields", async () => {
    const { ValidationCommandSchema } = await loadValidationCommandModule();

    expect(ValidationCommandSchema.safeParse(validCommand()).success).toBe(true);
  });

  it("validates a command with an optional cwd", async () => {
    const { ValidationCommandSchema } = await loadValidationCommandModule();

    expect(
      ValidationCommandSchema.safeParse(
        validCommand({
          cwd: "packages/shared",
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects missing fields and empty command descriptors", async () => {
    const { ValidationCommandSchema } = await loadValidationCommandModule();

    expect(ValidationCommandSchema.safeParse({ ...validCommand(), id: undefined }).success).toBe(
      false,
    );
    expect(ValidationCommandSchema.safeParse({ ...validCommand(), label: undefined }).success).toBe(
      false,
    );
    expect(
      ValidationCommandSchema.safeParse({ ...validCommand(), command: undefined }).success,
    ).toBe(false);
    expect(
      ValidationCommandSchema.safeParse({ ...validCommand(), timeoutSeconds: undefined }).success,
    ).toBe(false);
    expect(
      ValidationCommandSchema.safeParse({ ...validCommand(), required: undefined }).success,
    ).toBe(false);
    expect(ValidationCommandSchema.safeParse(validCommand({ id: "" })).success).toBe(false);
    expect(ValidationCommandSchema.safeParse(validCommand({ label: "" })).success).toBe(false);
    expect(ValidationCommandSchema.safeParse(validCommand({ command: "" })).success).toBe(false);
    expect(ValidationCommandSchema.safeParse(validCommand({ cwd: "" })).success).toBe(false);
  });

  it("rejects invalid required flags and invalid timeout values", async () => {
    const { ValidationCommandSchema } = await loadValidationCommandModule();

    expect(
      ValidationCommandSchema.safeParse(validCommand({ required: "true" as never })).success,
    ).toBe(false);
    expect(ValidationCommandSchema.safeParse(validCommand({ timeoutSeconds: 0 })).success).toBe(
      false,
    );
    expect(ValidationCommandSchema.safeParse(validCommand({ timeoutSeconds: -1 })).success).toBe(
      false,
    );
    expect(ValidationCommandSchema.safeParse(validCommand({ timeoutSeconds: 1.5 })).success).toBe(
      false,
    );
  });

  it("exports the validation command contract from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();

    expect(shared.ValidationCommandSchema?.safeParse(validCommand()).success).toBe(true);
  });
});
