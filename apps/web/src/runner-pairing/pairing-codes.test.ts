import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importPairingCodes = async () => import("./pairing-codes");

type StoredPairingCode = {
  createdAt: Date;
  createdByActorId: string;
  credentialHash: string;
  expiresAt: Date;
  id: string;
  updatedAt: Date;
  usedAt: Date | null;
  usedByRunnerId: string | null;
  workspaceId: string;
};

type StoredAuditEvent = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  runnerId?: string;
  workspaceId: string;
};

const now = new Date("2026-05-22T13:00:00.000Z");
const expiresAt = new Date("2026-05-22T13:10:00.000Z");

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const createStore = (
  options: {
    memberships?: Array<{ userId: string; workspaceId: string }>;
    pairings?: StoredPairingCode[];
  } = {},
) => {
  const pairingCodes = [...(options.pairings ?? [])];
  const auditEvents: StoredAuditEvent[] = [];

  return {
    auditEvents,
    createRunnerPairingCodeWithAudit: vi.fn(
      async (input: {
        auditEvent: StoredAuditEvent;
        pairingCode: StoredPairingCode;
      }): Promise<StoredPairingCode> => {
        pairingCodes.push(input.pairingCode);
        auditEvents.push(input.auditEvent);

        return input.pairingCode;
      },
    ),
    findWorkspaceMembership: vi.fn(async (input: { userId: string; workspaceId: string }) =>
      options.memberships?.some(
        (membership) =>
          membership.userId === input.userId && membership.workspaceId === input.workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    pairingCodes,
    redeemRunnerPairingCodeWithAudit: vi.fn(
      async (input: {
        auditEventFor: (row: { id: string; workspaceId: string }) => StoredAuditEvent;
        credentialHash: string;
        redeemedAt: Date;
        usedByRunnerId: string;
      }): Promise<{ id: string; workspaceId: string } | null> => {
        const pairingCode = pairingCodes.find(
          (candidate) =>
            candidate.credentialHash === input.credentialHash &&
            candidate.usedAt === null &&
            candidate.expiresAt.getTime() > input.redeemedAt.getTime(),
        );

        if (pairingCode === undefined) {
          return null;
        }

        pairingCode.usedAt = input.redeemedAt;
        pairingCode.usedByRunnerId = input.usedByRunnerId;
        pairingCode.updatedAt = input.redeemedAt;
        auditEvents.push(
          input.auditEventFor({
            id: pairingCode.id,
            workspaceId: pairingCode.workspaceId,
          }),
        );

        return {
          id: pairingCode.id,
          workspaceId: pairingCode.workspaceId,
        };
      },
    ),
  };
};

const createPairing = (overrides: Partial<StoredPairingCode> = {}): StoredPairingCode => ({
  createdAt: now,
  createdByActorId: "user_1",
  credentialHash: sha256("RUNNER-LINK"),
  expiresAt,
  id: "pairing_1",
  updatedAt: now,
  usedAt: null,
  usedByRunnerId: null,
  workspaceId: "workspace_1",
  ...overrides,
});

const expectNoCredentialMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const unsafeKeys: string[] = [];

  const collectKeys = (candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) {
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(collectKeys);

      return;
    }

    for (const [key, childValue] of Object.entries(candidate)) {
      if (
        /^(credentialHash|credential_hash|code|hash|pairingCode|rawCode|secret|token)$/i.test(key)
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain("PAIR-RAW-CODE");
  expect(serialized).not.toContain("RUNNER-LINK");
  expect(serialized).not.toContain(sha256("PAIR-RAW-CODE"));
  expect(serialized).not.toContain(sha256("RUNNER-LINK"));
  expect(unsafeKeys).toEqual([]);
};

describe("runner pairing code service", () => {
  test("hashes trimmed pairing-code input with SHA-256", async () => {
    const { hashRunnerPairingCode } = await importPairingCodes();

    expect(hashRunnerPairingCode("  RUNNER-LINK  ")).toBe(sha256("RUNNER-LINK"));
  });

  test("generates URL-safe high-entropy pairing codes", async () => {
    const { generateRunnerPairingCode } = await importPairingCodes();

    const firstCode = generateRunnerPairingCode();
    const secondCode = generateRunnerPairingCode();

    expect(firstCode).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(secondCode).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(secondCode).not.toBe(firstCode);
  });

  test("blocks unauthenticated users before creating a pairing code", async () => {
    const { createRunnerPairingCodeService } = await importPairingCodes();
    const store = createStore();
    const service = createRunnerPairingCodeService({
      getAuthContext: async () => ({ userId: null }),
      store,
    });

    await expect(
      service.createRunnerPairingCode({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(store.createRunnerPairingCodeWithAudit).not.toHaveBeenCalled();
  });

  test("blocks non-members before creating a pairing code for a workspace", async () => {
    const { createRunnerPairingCodeService } = await importPairingCodes();
    const store = createStore({ memberships: [{ userId: "user_2", workspaceId: "workspace_1" }] });
    const service = createRunnerPairingCodeService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.createRunnerPairingCode({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.createRunnerPairingCodeWithAudit).not.toHaveBeenCalled();
  });

  test("returns the raw code once while storing only the hash and safe audit metadata", async () => {
    const { RUNNER_PAIRING_CODE_TTL_MS, createRunnerPairingCodeService } =
      await importPairingCodes();
    const store = createStore({ memberships: [{ userId: "user_1", workspaceId: "workspace_1" }] });
    const service = createRunnerPairingCodeService({
      createAuditEventId: () => "audit_1",
      createPairingId: () => "pairing_1",
      generateCode: () => "PAIR-RAW-CODE",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => now,
      store,
    });

    await expect(
      service.createRunnerPairingCode({ workspaceId: "  workspace_1  " }),
    ).resolves.toEqual({
      code: "PAIR-RAW-CODE",
      expiresAt: new Date(now.getTime() + RUNNER_PAIRING_CODE_TTL_MS),
      pairingId: "pairing_1",
      ttlSeconds: 600,
      workspaceId: "workspace_1",
    });

    expect(store.createRunnerPairingCodeWithAudit).toHaveBeenCalledTimes(1);
    expect(store.pairingCodes).toEqual([
      {
        createdAt: now,
        createdByActorId: "user_1",
        credentialHash: sha256("PAIR-RAW-CODE"),
        expiresAt: new Date(now.getTime() + RUNNER_PAIRING_CODE_TTL_MS),
        id: "pairing_1",
        updatedAt: now,
        usedAt: null,
        usedByRunnerId: null,
        workspaceId: "workspace_1",
      },
    ]);
    expect(Object.keys(store.pairingCodes[0] ?? {})).not.toEqual(
      expect.arrayContaining(["code", "pairingCode", "rawCode", "token"]),
    );
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        createdAt: now,
        eventType: "runner_pairing.created",
        id: "audit_1",
        message: "Runner pairing code created.",
        metadata: {
          expiresAt: new Date(now.getTime() + RUNNER_PAIRING_CODE_TTL_MS).toISOString(),
          pairingId: "pairing_1",
          ttlSeconds: 600,
        },
        workspaceId: "workspace_1",
      }),
    ]);
    const storedPairingsWithoutHashes = store.pairingCodes.map((pairingCode) =>
      Object.fromEntries(Object.entries(pairingCode).filter(([key]) => key !== "credentialHash")),
    );

    expectNoCredentialMaterial({
      auditEvents: store.auditEvents,
      storedPairings: storedPairingsWithoutHashes,
    });
  });

  test("redeems a normalized code by atomically consuming an unused unexpired row", async () => {
    const { createRunnerPairingCodeService } = await importPairingCodes();
    const pairingCode = createPairing();
    const store = createStore({ pairings: [pairingCode] });
    const service = createRunnerPairingCodeService({
      createAuditEventId: () => "audit_1",
      now: () => now,
      store,
    });

    await expect(
      service.redeemRunnerPairingCode({
        code: "  RUNNER-LINK  ",
        runnerId: "runner_1",
      }),
    ).resolves.toEqual({
      pairingId: "pairing_1",
      status: "redeemed",
      workspaceId: "workspace_1",
    });

    expect(store.redeemRunnerPairingCodeWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialHash: sha256("RUNNER-LINK"),
        redeemedAt: now,
        usedByRunnerId: "runner_1",
      }),
    );
    expect(pairingCode.usedAt).toBe(now);
    expect(pairingCode.usedByRunnerId).toBe("runner_1");
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        createdAt: now,
        eventType: "runner_pairing.redeemed",
        id: "audit_1",
        message: "Runner pairing code redeemed.",
        metadata: {
          pairingId: "pairing_1",
        },
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoCredentialMaterial(store.auditEvents);
  });

  test("returns a generic non-redeemable result for expired codes", async () => {
    const { createRunnerPairingCodeService } = await importPairingCodes();
    const store = createStore({
      pairings: [createPairing({ expiresAt: new Date("2026-05-22T12:59:59.000Z") })],
    });
    const service = createRunnerPairingCodeService({
      now: () => now,
      store,
    });

    await expect(
      service.redeemRunnerPairingCode({ code: "RUNNER-LINK", runnerId: "runner_1" }),
    ).resolves.toEqual({ status: "not_redeemable" });
    expect(store.auditEvents).toEqual([]);
  });

  test("returns the same generic result when a code is reused", async () => {
    const { createRunnerPairingCodeService } = await importPairingCodes();
    const pairingCode = createPairing();
    const store = createStore({ pairings: [pairingCode] });
    const service = createRunnerPairingCodeService({
      createAuditEventId: () => "audit_1",
      now: () => now,
      store,
    });

    await expect(
      service.redeemRunnerPairingCode({ code: "RUNNER-LINK", runnerId: "runner_1" }),
    ).resolves.toMatchObject({ status: "redeemed" });
    await expect(
      service.redeemRunnerPairingCode({ code: "RUNNER-LINK", runnerId: "runner_2" }),
    ).resolves.toEqual({ status: "not_redeemable" });

    expect(pairingCode.usedByRunnerId).toBe("runner_1");
    expect(store.auditEvents).toHaveLength(1);
  });

  test("wraps Drizzle creation and redemption audit writes in transactions", async () => {
    const { createDrizzleRunnerPairingStore } = await importPairingCodes();
    const insertReturning = vi.fn(async () => [{ id: "pairing_1", workspaceId: "workspace_1" }]);
    const insertValues = vi.fn(() => ({ returning: insertReturning }));
    const insert = vi.fn(() => ({ values: insertValues }));
    const updateReturning = vi.fn(async () => [{ id: "pairing_1", workspaceId: "workspace_1" }]);
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));
    const transaction = vi.fn(
      async (callback: (tx: { insert: typeof insert; update: typeof update }) => unknown) =>
        callback({ insert, update }),
    );
    const store = createDrizzleRunnerPairingStore({ transaction } as never);

    await expect(
      store.createRunnerPairingCodeWithAudit({
        auditEvent: {
          actorId: "user_1",
          createdAt: now,
          eventType: "runner_pairing.created",
          id: "audit_1",
          message: "Runner pairing code created.",
          metadata: { pairingId: "pairing_1" },
          workspaceId: "workspace_1",
        },
        pairingCode: createPairing(),
      }),
    ).resolves.toMatchObject({ id: "pairing_1", workspaceId: "workspace_1" });
    await expect(
      store.redeemRunnerPairingCodeWithAudit({
        auditEventFor: (row) => ({
          createdAt: now,
          eventType: "runner_pairing.redeemed",
          id: "audit_2",
          message: "Runner pairing code redeemed.",
          metadata: { pairingId: row.id },
          runnerId: "runner_1",
          workspaceId: row.workspaceId,
        }),
        credentialHash: sha256("RUNNER-LINK"),
        redeemedAt: now,
        usedByRunnerId: "runner_1",
      }),
    ).resolves.toEqual({ id: "pairing_1", workspaceId: "workspace_1" });

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledWith({
      updatedAt: now,
      usedAt: now,
      usedByRunnerId: "runner_1",
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "runner_pairing.redeemed" }),
    );
  });
});
