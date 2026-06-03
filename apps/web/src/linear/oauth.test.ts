import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importLinearOAuth = async () => import("./oauth");

type StoredLinearOAuthConnection = {
  accessTokenCiphertext: string | null;
  accessTokenKeyId: string | null;
  connectedAt: Date;
  connectedByActorId: string;
  createdAt: Date;
  expiresAt: Date | null;
  id: string;
  linearActorId: string;
  linearWorkspaceId: string;
  linearWorkspaceName: string;
  refreshTokenCiphertext: string | null;
  refreshTokenKeyId: string | null;
  revokedAt: Date | null;
  revokedByActorId: string | null;
  scopes: string[];
  updatedAt: Date;
  workspaceId: string;
};

const rawAccessToken = "linear-access-token-plaintext";
const rawRefreshToken = "linear-refresh-token-plaintext";
const accessCiphertextPlaceholder = "sealed-linear-access-token-ciphertext";
const refreshCiphertextPlaceholder = "sealed-linear-refresh-token-ciphertext";
const keyIdPlaceholder = "linear-oauth-test-key-id";

type StoredAuditEvent = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  workspaceId: string;
};

const now = new Date("2026-05-24T14:00:00.000Z");
const expiresAt = new Date("2026-06-23T14:00:00.000Z");

const createConnection = (
  overrides: Partial<StoredLinearOAuthConnection> = {},
): StoredLinearOAuthConnection => ({
  accessTokenCiphertext: accessCiphertextPlaceholder,
  accessTokenKeyId: keyIdPlaceholder,
  connectedAt: now,
  connectedByActorId: "user_1",
  createdAt: now,
  expiresAt,
  id: "linear_connection_1",
  linearActorId: "linear_actor_1",
  linearWorkspaceId: "linear_workspace_1",
  linearWorkspaceName: "Linear Platform",
  refreshTokenCiphertext: refreshCiphertextPlaceholder,
  refreshTokenKeyId: keyIdPlaceholder,
  revokedAt: null,
  revokedByActorId: null,
  scopes: ["issues:read", "read"],
  updatedAt: now,
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  options: {
    connections?: StoredLinearOAuthConnection[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
  } = {},
) => {
  const connections = [...(options.connections ?? [])];
  const auditEvents: StoredAuditEvent[] = [];

  return {
    auditEvents,
    connections,
    createLinearOAuthConnectionWithAudit: vi.fn(
      async (input: {
        auditEvent: StoredAuditEvent;
        connection: StoredLinearOAuthConnection;
      }): Promise<StoredLinearOAuthConnection> => {
        connections.push(input.connection);
        auditEvents.push(input.auditEvent);

        return input.connection;
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
    revokeLinearOAuthConnectionWithAudit: vi.fn(
      async (input: {
        auditEventFor: (row: StoredLinearOAuthConnection) => StoredAuditEvent;
        connectionId: string;
        revokedAt: Date;
        revokedByActorId: string;
        workspaceId: string;
      }): Promise<StoredLinearOAuthConnection | null> => {
        const connection = connections.find(
          (candidate) =>
            candidate.id === input.connectionId &&
            candidate.workspaceId === input.workspaceId &&
            candidate.revokedAt === null,
        );

        if (connection === undefined) {
          return null;
        }

        connection.accessTokenCiphertext = null;
        connection.accessTokenKeyId = null;
        connection.refreshTokenCiphertext = null;
        connection.refreshTokenKeyId = null;
        connection.revokedAt = input.revokedAt;
        connection.revokedByActorId = input.revokedByActorId;
        connection.updatedAt = input.revokedAt;
        auditEvents.push(input.auditEventFor(connection));

        return connection;
      },
    ),
  };
};

const createSealer = () => ({
  sealCredential: vi.fn(async (input: { plaintext: string; purpose: "access" | "refresh" }) => ({
    ciphertext:
      input.purpose === "access" ? accessCiphertextPlaceholder : refreshCiphertextPlaceholder,
    keyId: keyIdPlaceholder,
  })),
});

const createInput = {
  accessToken: rawAccessToken,
  expiresAt,
  linearActorId: " linear_actor_1 ",
  linearWorkspaceId: " linear_workspace_1 ",
  linearWorkspaceName: " Linear Platform ",
  refreshToken: rawRefreshToken,
  scopes: [" read ", "issues:read", "read", " "],
  workspaceId: " workspace_1 ",
};

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
      if (/(accessToken|refreshToken|ciphertext|credential|keyId|secret|token)/iu.test(key)) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain(rawAccessToken);
  expect(serialized).not.toContain(rawRefreshToken);
  expect(serialized).not.toContain(accessCiphertextPlaceholder);
  expect(serialized).not.toContain(refreshCiphertextPlaceholder);
  expect(serialized).not.toContain(keyIdPlaceholder);
  expect(unsafeKeys).toEqual([]);
};

describe("Linear OAuth connection service", () => {
  test("uses AES-GCM credential sealing and fails closed when env key material is unavailable", async () => {
    const {
      LinearOAuthCredentialSealingError,
      createAesGcmLinearOAuthCredentialSealer,
      createEnvLinearOAuthCredentialSealer,
    } = await importLinearOAuth();

    expect(() => createEnvLinearOAuthCredentialSealer({} as NodeJS.ProcessEnv)).toThrow(
      LinearOAuthCredentialSealingError,
    );

    const sealer = createAesGcmLinearOAuthCredentialSealer({
      key: Buffer.alloc(32, 7),
      keyId: "test-key",
      randomBytes: () => Buffer.alloc(12, 1),
    });
    const sealed = await sealer.sealCredential({
      plaintext: "placeholder",
      purpose: "access",
    });

    expect(sealed).toEqual({
      ciphertext: expect.stringMatching(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u),
      keyId: "test-key",
    });
    expect(sealed.ciphertext).not.toContain("placeholder");
  });

  test("unseals AES-GCM credentials only with the matching key id and purpose", async () => {
    const {
      LinearOAuthCredentialSealingError,
      createAesGcmLinearOAuthCredentialSealer,
      createAesGcmLinearOAuthCredentialUnsealer,
    } = await importLinearOAuth();
    const key = Buffer.alloc(32, 7);
    const sealer = createAesGcmLinearOAuthCredentialSealer({
      key,
      keyId: "test-key",
      randomBytes: () => Buffer.alloc(12, 1),
    });
    const unsealer = createAesGcmLinearOAuthCredentialUnsealer({
      key,
      keyId: "test-key",
    });
    const sealed = await sealer.sealCredential({
      plaintext: rawAccessToken,
      purpose: "access",
    });

    await expect(
      unsealer.unsealCredential({
        credential: sealed,
        purpose: "access",
      }),
    ).resolves.toBe(rawAccessToken);
    await expect(
      unsealer.unsealCredential({
        credential: sealed,
        purpose: "refresh",
      }),
    ).rejects.toBeInstanceOf(LinearOAuthCredentialSealingError);
    await expect(
      createAesGcmLinearOAuthCredentialUnsealer({
        key: Buffer.alloc(32, 8),
        keyId: "test-key",
      }).unsealCredential({
        credential: sealed,
        purpose: "access",
      }),
    ).rejects.toBeInstanceOf(LinearOAuthCredentialSealingError);
  });

  test("fails closed for malformed ciphertext without leaking token material", async () => {
    const { LinearOAuthCredentialSealingError, createAesGcmLinearOAuthCredentialUnsealer } =
      await importLinearOAuth();
    const unsealer = createAesGcmLinearOAuthCredentialUnsealer({
      key: Buffer.alloc(32, 7),
      keyId: "test-key",
    });
    const malformed = {
      ciphertext: `v1.malformed.${rawAccessToken}.ciphertext`,
      keyId: "test-key",
    };

    const result = await Promise.allSettled([
      unsealer.unsealCredential({
        credential: malformed,
        purpose: "access",
      }),
    ]);

    expect(result[0]).toMatchObject({
      reason: expect.any(LinearOAuthCredentialSealingError),
      status: "rejected",
    });
    expect(JSON.stringify(result)).not.toContain(rawAccessToken);
    expect(JSON.stringify(result)).not.toContain(malformed.ciphertext);
  });

  test("blocks unauthenticated users before creating or revoking connections", async () => {
    const { createLinearOAuthConnectionService } = await importLinearOAuth();
    const store = createStore();
    const sealer = createSealer();
    const service = createLinearOAuthConnectionService({
      getAuthContext: async () => ({ userId: null }),
      sealer,
      store,
    });

    await expect(service.createLinearOAuthConnection(createInput)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      service.revokeLinearOAuthConnection({
        connectionId: "linear_connection_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(sealer.sealCredential).not.toHaveBeenCalled();
    expect(store.createLinearOAuthConnectionWithAudit).not.toHaveBeenCalled();
    expect(store.revokeLinearOAuthConnectionWithAudit).not.toHaveBeenCalled();
  });

  test("blocks non-members before creating or revoking workspace connections", async () => {
    const { createLinearOAuthConnectionService } = await importLinearOAuth();
    const store = createStore({
      connections: [createConnection()],
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
    });
    const sealer = createSealer();
    const service = createLinearOAuthConnectionService({
      getAuthContext: async () => ({ userId: "user_1" }),
      sealer,
      store,
    });

    await expect(service.createLinearOAuthConnection(createInput)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      service.revokeLinearOAuthConnection({
        connectionId: "linear_connection_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(sealer.sealCredential).not.toHaveBeenCalled();
    expect(store.createLinearOAuthConnectionWithAudit).not.toHaveBeenCalled();
    expect(store.revokeLinearOAuthConnectionWithAudit).not.toHaveBeenCalled();
  });

  test("seals raw access and refresh tokens before persistence and returns safe connection data", async () => {
    const { createLinearOAuthConnectionService } = await importLinearOAuth();
    const store = createStore({ memberships: [{ userId: "user_1", workspaceId: "workspace_1" }] });
    const sealer = createSealer();
    const service = createLinearOAuthConnectionService({
      createAuditEventId: () => "audit_1",
      createConnectionId: () => "linear_connection_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => now,
      sealer,
      store,
    });

    expect(createInput.accessToken).not.toBe(accessCiphertextPlaceholder);
    expect(createInput.refreshToken).not.toBe(refreshCiphertextPlaceholder);

    const result = await service.createLinearOAuthConnection(createInput);

    expect(sealer.sealCredential).toHaveBeenCalledWith({
      plaintext: rawAccessToken,
      purpose: "access",
    });
    expect(sealer.sealCredential).toHaveBeenCalledWith({
      plaintext: rawRefreshToken,
      purpose: "refresh",
    });
    expect(store.connections).toEqual([
      {
        ...createConnection(),
        connectedAt: now,
        createdAt: now,
        expiresAt,
        updatedAt: now,
      },
    ]);
    const storedConnection = store.connections[0];
    expect(storedConnection).toMatchObject({
      accessTokenCiphertext: accessCiphertextPlaceholder,
      accessTokenKeyId: keyIdPlaceholder,
      refreshTokenCiphertext: refreshCiphertextPlaceholder,
      refreshTokenKeyId: keyIdPlaceholder,
    });
    expect(JSON.stringify(store.connections)).not.toContain(rawAccessToken);
    expect(JSON.stringify(store.connections)).not.toContain(rawRefreshToken);
    expect(result).toEqual({
      connectedAt: now,
      connectedByActorId: "user_1",
      createdAt: now,
      expiresAt,
      id: "linear_connection_1",
      linearActorId: "linear_actor_1",
      linearWorkspaceId: "linear_workspace_1",
      linearWorkspaceName: "Linear Platform",
      revokedAt: null,
      revokedByActorId: null,
      scopes: ["issues:read", "read"],
      updatedAt: now,
      workspaceId: "workspace_1",
    });
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        createdAt: now,
        eventType: "linear_oauth_connection.created",
        id: "audit_1",
        metadata: {
          connectionId: "linear_connection_1",
          expiresAt: expiresAt.toISOString(),
          linearWorkspaceId: "linear_workspace_1",
          scopeCount: 2,
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoCredentialMaterial({ auditEvents: store.auditEvents, result });
  });

  test("fails closed without persisting when credential sealing is unavailable", async () => {
    const { createLinearOAuthConnectionService } = await importLinearOAuth();
    const store = createStore({ memberships: [{ userId: "user_1", workspaceId: "workspace_1" }] });
    const service = createLinearOAuthConnectionService({
      getAuthContext: async () => ({ userId: "user_1" }),
      sealer: {
        sealCredential: vi.fn(async () => {
          throw new Error("sealer unavailable");
        }),
      },
      store,
    });

    await expect(service.createLinearOAuthConnection(createInput)).rejects.toThrow(
      /sealer unavailable/u,
    );
    expect(store.createLinearOAuthConnectionWithAudit).not.toHaveBeenCalled();
    expect(store.connections).toEqual([]);
  });

  test("revokes active connections by clearing ciphertext fields and returning safe metadata", async () => {
    const { createLinearOAuthConnectionService } = await importLinearOAuth();
    const connection = createConnection();
    const store = createStore({
      connections: [connection],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createLinearOAuthConnectionService({
      createAuditEventId: () => "audit_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => now,
      sealer: createSealer(),
      store,
    });

    const result = await service.revokeLinearOAuthConnection({
      connectionId: " linear_connection_1 ",
      workspaceId: " workspace_1 ",
    });

    expect(connection).toMatchObject({
      accessTokenCiphertext: null,
      accessTokenKeyId: null,
      refreshTokenCiphertext: null,
      refreshTokenKeyId: null,
      revokedAt: now,
      revokedByActorId: "user_1",
      updatedAt: now,
    });
    expect(result).toEqual({
      connectedAt: now,
      connectedByActorId: "user_1",
      createdAt: now,
      expiresAt,
      id: "linear_connection_1",
      linearActorId: "linear_actor_1",
      linearWorkspaceId: "linear_workspace_1",
      linearWorkspaceName: "Linear Platform",
      revokedAt: now,
      revokedByActorId: "user_1",
      scopes: ["issues:read", "read"],
      updatedAt: now,
      workspaceId: "workspace_1",
    });
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        createdAt: now,
        eventType: "linear_oauth_connection.revoked",
        id: "audit_1",
        metadata: {
          connectionId: "linear_connection_1",
          linearWorkspaceId: "linear_workspace_1",
          revokedAt: now.toISOString(),
          scopeCount: 2,
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoCredentialMaterial({ auditEvents: store.auditEvents, result });
  });

  test("keeps the OAuth module server-only and free of client component directives", async () => {
    const source = await readFile(new URL("./oauth.ts", import.meta.url), "utf8");

    expect(source.trimStart()).toMatch(/^import "server-only";/u);
    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("'use client'");
    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/u);
  });
});
