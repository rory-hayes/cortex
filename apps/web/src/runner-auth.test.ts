import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  LinkRunnerResponseSchema,
  RunnerCapabilitiesSchema,
  type RunnerCapabilities,
} from "@control-plane/shared";

import type {
  LinkedRunnerRecord,
  LinkRunnerWithPairingCodeInput,
  RunnerLinkStore,
} from "./runner-auth";

vi.mock("server-only", () => ({}));

const importRunnerAuth = async () => import("./runner-auth");

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

type StoredRunner = {
  capabilities: RunnerCapabilities;
  createdAt: Date;
  credentialHash: string;
  displayName: string;
  id: string;
  lastHeartbeatAt: Date | null;
  linkedAt: Date;
  status: "idle" | "busy" | "offline";
  updatedAt: Date;
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

const validCapabilities = (runnerId = "runner_from_request"): RunnerCapabilities =>
  RunnerCapabilitiesSchema.parse({
    contractVersion: CONTRACT_VERSION,
    runnerId,
    os: {
      platform: "darwin",
      release: "25.5.0",
      arch: "arm64",
    },
    shell: "/bin/zsh",
    tools: {
      git: {
        available: true,
        version: "2.49.0",
        path: "/usr/bin/git",
      },
      node: {
        available: true,
        version: "24.0.0",
        path: "/opt/homebrew/bin/node",
      },
    },
    maxConcurrentJobs: 1,
    supportsDryRun: true,
    supportsCancellation: true,
    reportedAt: "2026-05-22T12:59:30.000Z",
  });

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

const createStore = (
  pairings: StoredPairingCode[] = [],
): RunnerLinkStore & {
  auditEvents: StoredAuditEvent[];
  pairingCodes: StoredPairingCode[];
  runners: StoredRunner[];
} => {
  const pairingCodes = [...pairings];
  const runners: StoredRunner[] = [];
  const auditEvents: StoredAuditEvent[] = [];

  return {
    auditEvents,
    linkRunnerWithPairingCode: vi.fn(
      async (input: LinkRunnerWithPairingCodeInput): Promise<LinkedRunnerRecord | null> => {
        const pairingCode = pairingCodes.find(
          (candidate) =>
            candidate.credentialHash === input.pairingCodeHash &&
            candidate.usedAt === null &&
            candidate.expiresAt.getTime() > input.linkedAt.getTime(),
        );

        if (pairingCode === undefined) {
          return null;
        }

        pairingCode.usedAt = input.linkedAt;
        pairingCode.updatedAt = input.linkedAt;

        const runner = input.createRunnerRow({
          pairingId: pairingCode.id,
          workspaceId: pairingCode.workspaceId,
        });

        runners.push(runner);
        pairingCode.usedByRunnerId = runner.id;
        auditEvents.push(
          input.createAuditEvent({
            linkedAt: runner.linkedAt,
            pairingId: pairingCode.id,
            runnerId: runner.id,
            workspaceId: pairingCode.workspaceId,
          }),
        );

        return {
          linkedAt: runner.linkedAt,
          pairingId: pairingCode.id,
          runnerId: runner.id,
          workspaceId: runner.workspaceId,
        };
      },
    ),
    pairingCodes,
    runners,
  };
};

type StoredAuthenticationRunner = {
  credentialHash: string;
  id: string;
  revokedAt: Date | null;
  workspaceId: string;
};

type StoredAuthenticationAuditEvent = {
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  runnerId?: string;
  workspaceId: string;
};

const createAuthenticationStore = (runners: StoredAuthenticationRunner[] = []) => {
  const auditEvents: StoredAuthenticationAuditEvent[] = [];

  return {
    auditEvents,
    findRunnerAuthRecord: vi.fn(async ({ runnerId }: { runnerId: string }) => {
      const runner = runners.find((candidate) => candidate.id === runnerId);

      if (runner === undefined) {
        return null;
      }

      return runner;
    }),
    insertRunnerAuthFailureAudit: vi.fn(async (event: StoredAuthenticationAuditEvent) => {
      auditEvents.push(event);
    }),
    runners,
  };
};

const createAuthenticationServiceFor = async (
  store: ReturnType<typeof createAuthenticationStore>,
) => {
  const { createRunnerAuthenticationService } = await importRunnerAuth();

  return createRunnerAuthenticationService({
    createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
    now: () => now,
    store,
  });
};

const createAuthenticatedRequest = (input: {
  authorization?: string;
  body?: unknown;
  runnerId?: string;
}) =>
  new Request("https://control-plane.test/api/runner/heartbeat", {
    body: JSON.stringify(input.body ?? { runnerId: input.runnerId ?? "runner_1" }),
    headers: {
      ...(input.authorization === undefined ? {} : { authorization: input.authorization }),
      ...(input.runnerId === undefined ? {} : { "x-control-plane-runner-id": input.runnerId }),
    },
    method: "POST",
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
        /^(body|code|credential|credentialHash|credential_hash|diff|hash|logs?|pairingCode|patch|rawCode|rawLog|request|secret|source|token)$/i.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain("RUNNER-LINK");
  expect(serialized).not.toContain("runner-secret-credential");
  expect(serialized).not.toContain(sha256("RUNNER-LINK"));
  expect(serialized).not.toContain(sha256("runner-secret-credential"));
  expect(unsafeKeys).toEqual([]);
};

describe("runner link service", () => {
  test("generates URL-safe high-entropy runner credentials", async () => {
    const { generateRunnerCredential } = await importRunnerAuth();

    const firstCredential = generateRunnerCredential();
    const secondCredential = generateRunnerCredential();

    expect(firstCredential).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(secondCredential).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(secondCredential).not.toBe(firstCredential);
  });

  test("hashRunnerCredential returns only SHA-256 hash material", async () => {
    const { hashRunnerCredential } = await importRunnerAuth();

    const hashedCredential = hashRunnerCredential("runner-secret-credential");

    expect(hashedCredential).toBe(sha256("runner-secret-credential"));
    expect(hashedCredential).toMatch(/^[a-f0-9]{64}$/);
    expect(hashedCredential).not.toContain("runner-secret-credential");
  });

  test("links a valid pairing code once and returns schema-valid response data", async () => {
    const { createRunnerLinkService } = await importRunnerAuth();
    const store = createStore([createPairing()]);
    const service = createRunnerLinkService({
      createAuditEventId: () => "audit_1",
      createRunnerId: () => "runner_server",
      generateCredential: () => "runner-secret-credential",
      now: () => now,
      store,
    });

    const result = await service.linkRunner({
      capabilities: validCapabilities(),
      pairingCode: "  RUNNER-LINK  ",
      pollingBaseUrl: "https://control-plane.test/api",
    });

    expect(result).toEqual({
      response: {
        contractVersion: CONTRACT_VERSION,
        linkedAt: now.toISOString(),
        pollIntervalSeconds: 15,
        pollingBaseUrl: "https://control-plane.test/api",
        runnerCredential: "runner-secret-credential",
        runnerId: "runner_server",
        workspaceId: "workspace_1",
      },
      status: "linked",
    });
    expect(LinkRunnerResponseSchema.safeParse(result.response).success).toBe(true);
    expect(store.runners).toHaveLength(1);
    expect(store.pairingCodes[0]?.usedByRunnerId).toBe("runner_server");
  });

  test("overwrites request capabilities.runnerId with the server-generated runner id", async () => {
    const { createRunnerLinkService } = await importRunnerAuth();
    const store = createStore([createPairing()]);
    const service = createRunnerLinkService({
      createRunnerId: () => "runner_authoritative",
      generateCredential: () => "runner-secret-credential",
      now: () => now,
      store,
    });

    await service.linkRunner({
      capabilities: validCapabilities("runner_untrusted"),
      pairingCode: "RUNNER-LINK",
      pollingBaseUrl: "https://control-plane.test/api",
    });

    expect(store.runners[0]?.id).toBe("runner_authoritative");
    expect(store.runners[0]?.capabilities.runnerId).toBe("runner_authoritative");
    expect(store.runners[0]?.capabilities.runnerId).not.toBe("runner_untrusted");
  });

  test("rejects unsafe capability values before linking or storing runner metadata", async () => {
    const { createRunnerLinkService } = await importRunnerAuth();
    const unsafeValue = "diff --git a/src/private.ts b/src/private.ts";
    const store = createStore([createPairing()]);
    const service = createRunnerLinkService({
      createRunnerId: () => "runner_server",
      generateCredential: () => "runner-secret-credential",
      now: () => now,
      store,
    });

    await expect(
      service.linkRunner({
        capabilities: {
          ...validCapabilities(),
          shell: unsafeValue,
        } as RunnerCapabilities,
        pairingCode: "RUNNER-LINK",
        pollingBaseUrl: "https://control-plane.test/api",
      }),
    ).rejects.toThrow();
    expect(store.linkRunnerWithPairingCode).not.toHaveBeenCalled();
    expect(store.runners).toEqual([]);
    expect(JSON.stringify(store)).not.toContain(unsafeValue);
  });

  test("stores the runner credential hash without the raw runnerCredential", async () => {
    const { createRunnerLinkService } = await importRunnerAuth();
    const store = createStore([createPairing()]);
    const service = createRunnerLinkService({
      createRunnerId: () => "runner_server",
      generateCredential: () => "runner-secret-credential",
      now: () => now,
      store,
    });

    await service.linkRunner({
      capabilities: validCapabilities(),
      pairingCode: "RUNNER-LINK",
      pollingBaseUrl: "https://control-plane.test/api",
    });

    expect(store.runners[0]).toEqual(
      expect.objectContaining({
        credentialHash: sha256("runner-secret-credential"),
        id: "runner_server",
        workspaceId: "workspace_1",
      }),
    );
    expect(Object.keys(store.runners[0] ?? {})).not.toEqual(
      expect.arrayContaining(["runnerCredential", "credential", "token", "secret"]),
    );
    expect(JSON.stringify(store.runners)).not.toContain("runner-secret-credential");
  });

  test("writes audit metadata with runner and pairing ids only", async () => {
    const { createRunnerLinkService } = await importRunnerAuth();
    const store = createStore([createPairing()]);
    const service = createRunnerLinkService({
      createAuditEventId: () => "audit_1",
      createRunnerId: () => "runner_server",
      generateCredential: () => "runner-secret-credential",
      now: () => now,
      store,
    });

    await service.linkRunner({
      capabilities: validCapabilities(),
      pairingCode: "RUNNER-LINK",
      pollingBaseUrl: "https://control-plane.test/api",
    });

    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        createdAt: now,
        eventType: "runner.linked",
        id: "audit_1",
        message: "Runner linked.",
        metadata: {
          pairingId: "pairing_1",
          runnerId: "runner_server",
        },
        runnerId: "runner_server",
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoCredentialMaterial(store.auditEvents);
  });

  test("returns the same non-linkable result for expired, used, unknown, and blank codes", async () => {
    const { createRunnerLinkService } = await importRunnerAuth();
    const serviceFor = (store = createStore()) =>
      createRunnerLinkService({
        createRunnerId: () => "runner_server",
        generateCredential: () => "runner-secret-credential",
        now: () => now,
        store,
      });

    const expiredStore = createStore([
      createPairing({ expiresAt: new Date("2026-05-22T12:59:59.000Z") }),
    ]);
    const usedStore = createStore([createPairing({ usedAt: now, usedByRunnerId: "runner_old" })]);
    const unknownStore = createStore();
    const blankStore = createStore([createPairing()]);

    const results = await Promise.all([
      serviceFor(expiredStore).linkRunner({
        capabilities: validCapabilities(),
        pairingCode: "RUNNER-LINK",
        pollingBaseUrl: "https://control-plane.test/api",
      }),
      serviceFor(usedStore).linkRunner({
        capabilities: validCapabilities(),
        pairingCode: "RUNNER-LINK",
        pollingBaseUrl: "https://control-plane.test/api",
      }),
      serviceFor(unknownStore).linkRunner({
        capabilities: validCapabilities(),
        pairingCode: "RUNNER-LINK",
        pollingBaseUrl: "https://control-plane.test/api",
      }),
      serviceFor(blankStore).linkRunner({
        capabilities: validCapabilities(),
        pairingCode: "   ",
        pollingBaseUrl: "https://control-plane.test/api",
      }),
    ]);

    expect(results).toEqual([
      { status: "invalid_pairing_code" },
      { status: "invalid_pairing_code" },
      { status: "invalid_pairing_code" },
      { status: "invalid_pairing_code" },
    ]);
    expect(expiredStore.runners).toHaveLength(0);
    expect(usedStore.runners).toHaveLength(0);
    expect(unknownStore.runners).toHaveLength(0);
    expect(blankStore.runners).toHaveLength(0);
    expect(blankStore.linkRunnerWithPairingCode).not.toHaveBeenCalled();
  });

  test("rejects a second redemption of the same pairing code", async () => {
    const { createRunnerLinkService } = await importRunnerAuth();
    const store = createStore([createPairing()]);
    let runnerSequence = 0;
    const service = createRunnerLinkService({
      createRunnerId: () => `runner_${++runnerSequence}`,
      generateCredential: () => "runner-secret-credential",
      now: () => now,
      store,
    });

    await expect(
      service.linkRunner({
        capabilities: validCapabilities(),
        pairingCode: "RUNNER-LINK",
        pollingBaseUrl: "https://control-plane.test/api",
      }),
    ).resolves.toMatchObject({ status: "linked" });
    await expect(
      service.linkRunner({
        capabilities: validCapabilities(),
        pairingCode: "RUNNER-LINK",
        pollingBaseUrl: "https://control-plane.test/api",
      }),
    ).resolves.toEqual({ status: "invalid_pairing_code" });

    expect(store.runners).toHaveLength(1);
    expect(store.pairingCodes[0]?.usedByRunnerId).toBe("runner_1");
  });

  test("wraps Drizzle runner creation, pairing consumption, and audit writes in one transaction", async () => {
    const { createDrizzleRunnerLinkStore } = await importRunnerAuth();
    const consumeReturning = vi.fn(async () => [
      {
        pairingId: "pairing_1",
        workspaceId: "workspace_1",
      },
    ]);
    const consumeWhere = vi.fn(() => ({ returning: consumeReturning }));
    const consumeSet = vi.fn(() => ({ where: consumeWhere }));
    const attachWhere = vi.fn(async () => undefined);
    const attachSet = vi.fn(() => ({ where: attachWhere }));
    let updateCount = 0;
    const update = vi.fn(() => {
      updateCount += 1;

      return updateCount === 1 ? { set: consumeSet } : { set: attachSet };
    });
    const insertRunnerReturning = vi.fn(async () => [
      {
        id: "runner_server",
        linkedAt: now,
        workspaceId: "workspace_1",
      },
    ]);
    const insertRunnerValues = vi.fn(() => ({ returning: insertRunnerReturning }));
    const insertAuditValues = vi.fn(async () => undefined);
    let insertCount = 0;
    const insert = vi.fn(() => {
      insertCount += 1;

      return insertCount === 1 ? { values: insertRunnerValues } : { values: insertAuditValues };
    });
    const transaction = vi.fn(
      async (callback: (tx: { insert: typeof insert; update: typeof update }) => unknown) =>
        callback({ insert, update }),
    );
    const store = createDrizzleRunnerLinkStore({ transaction } as never);

    await expect(
      store.linkRunnerWithPairingCode({
        createAuditEvent: (row) => ({
          createdAt: now,
          eventType: "runner.linked",
          id: "audit_1",
          message: "Runner linked.",
          metadata: {
            pairingId: row.pairingId,
            runnerId: row.runnerId,
          },
          runnerId: row.runnerId,
          workspaceId: row.workspaceId,
        }),
        createRunnerRow: (row) => ({
          capabilities: validCapabilities("runner_server"),
          createdAt: now,
          credentialHash: sha256("runner-secret-credential"),
          displayName: "Local runner",
          id: "runner_server",
          lastHeartbeatAt: now,
          linkedAt: now,
          status: "idle",
          updatedAt: now,
          workspaceId: row.workspaceId,
        }),
        linkedAt: now,
        pairingCodeHash: sha256("RUNNER-LINK"),
      }),
    ).resolves.toEqual({
      linkedAt: now,
      pairingId: "pairing_1",
      runnerId: "runner_server",
      workspaceId: "workspace_1",
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(consumeSet).toHaveBeenCalledWith({
      updatedAt: now,
      usedAt: now,
    });
    expect(insertRunnerValues).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialHash: sha256("runner-secret-credential"),
        id: "runner_server",
        workspaceId: "workspace_1",
      }),
    );
    expect(attachSet).toHaveBeenCalledWith({
      updatedAt: now,
      usedByRunnerId: "runner_server",
    });
    expect(insertAuditValues).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "runner.linked",
        runnerId: "runner_server",
        workspaceId: "workspace_1",
      }),
    );
  });
});

describe("runner authentication service", () => {
  test("constant-time hash comparison helper only accepts matching SHA-256 hashes", async () => {
    const { compareRunnerCredentialHashes } = await importRunnerAuth();

    expect(
      compareRunnerCredentialHashes(
        sha256("runner-secret-credential"),
        sha256("runner-secret-credential"),
      ),
    ).toBe(true);
    expect(
      compareRunnerCredentialHashes(
        sha256("runner-secret-credential"),
        sha256("wrong-runner-credential"),
      ),
    ).toBe(false);
    expect(
      compareRunnerCredentialHashes("not-a-valid-hash", sha256("runner-secret-credential")),
    ).toBe(false);
    expect(
      compareRunnerCredentialHashes(sha256("runner-secret-credential"), "not-a-valid-hash"),
    ).toBe(false);
  });

  test("valid bearer credential plus runner id resolves safe runner identity", async () => {
    const store = createAuthenticationStore([
      {
        credentialHash: sha256("runner-secret-credential"),
        id: "runner_1",
        revokedAt: null,
        workspaceId: "workspace_1",
      },
    ]);
    const service = await createAuthenticationServiceFor(store);

    await expect(
      service.authenticateRunnerRequest(
        createAuthenticatedRequest({
          authorization: "Bearer runner-secret-credential",
          runnerId: "runner_1",
        }),
      ),
    ).resolves.toEqual({
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    });

    expect(store.findRunnerAuthRecord).toHaveBeenCalledWith({ runnerId: "runner_1" });
    expect(store.insertRunnerAuthFailureAudit).not.toHaveBeenCalled();
  });

  test("rejects missing and malformed authorization headers before DB lookup", async () => {
    const cases = [
      {
        name: "missing authorization header",
        request: createAuthenticatedRequest({
          runnerId: "runner_1",
        }),
      },
      {
        name: "blank authorization header",
        request: createAuthenticatedRequest({
          authorization: "   ",
          runnerId: "runner_1",
        }),
      },
      {
        name: "non-bearer scheme",
        request: createAuthenticatedRequest({
          authorization: "Basic runner-secret-credential",
          runnerId: "runner_1",
        }),
      },
      {
        name: "blank bearer credential",
        request: createAuthenticatedRequest({
          authorization: "Bearer   ",
          runnerId: "runner_1",
        }),
      },
      {
        name: "comma-joined duplicate-looking bearer values",
        request: createAuthenticatedRequest({
          authorization: "Bearer runner-secret-credential, Bearer second-credential",
          runnerId: "runner_1",
        }),
      },
    ];

    for (const testCase of cases) {
      const store = createAuthenticationStore([
        {
          credentialHash: sha256("runner-secret-credential"),
          id: "runner_1",
          revokedAt: null,
          workspaceId: "workspace_1",
        },
      ]);
      const service = await createAuthenticationServiceFor(store);

      await expect(
        service.authenticateRunnerRequest(testCase.request),
        testCase.name,
      ).rejects.toMatchObject({
        code: "invalid_runner_auth",
        message: "Invalid runner credentials.",
      });

      expect(store.findRunnerAuthRecord, testCase.name).not.toHaveBeenCalled();
      expect(store.insertRunnerAuthFailureAudit, testCase.name).not.toHaveBeenCalled();
    }
  });

  test("rejects missing runner id before DB lookup", async () => {
    const store = createAuthenticationStore([
      {
        credentialHash: sha256("runner-secret-credential"),
        id: "runner_1",
        revokedAt: null,
        workspaceId: "workspace_1",
      },
    ]);
    const service = await createAuthenticationServiceFor(store);

    await expect(
      service.authenticateRunnerRequest(
        createAuthenticatedRequest({
          authorization: "Bearer runner-secret-credential",
        }),
      ),
    ).rejects.toMatchObject({
      code: "invalid_runner_auth",
      message: "Invalid runner credentials.",
    });

    expect(store.findRunnerAuthRecord).not.toHaveBeenCalled();
    expect(store.insertRunnerAuthFailureAudit).not.toHaveBeenCalled();
  });

  test("rejects unknown, mismatched, malformed-hash, and revoked runners with one generic failure", async () => {
    const revokedAt = new Date("2026-05-22T13:05:00.000Z");
    const cases = [
      {
        audit: false,
        name: "unknown runner",
        request: createAuthenticatedRequest({
          authorization: "Bearer runner-secret-credential",
          runnerId: "runner_unknown",
        }),
        runners: [],
      },
      {
        audit: true,
        name: "wrong credential",
        request: createAuthenticatedRequest({
          authorization: "Bearer wrong-runner-credential",
          runnerId: "runner_1",
        }),
        runners: [
          {
            credentialHash: sha256("runner-secret-credential"),
            id: "runner_1",
            revokedAt: null,
            workspaceId: "workspace_1",
          },
        ],
      },
      {
        audit: true,
        name: "malformed stored hash",
        request: createAuthenticatedRequest({
          authorization: "Bearer runner-secret-credential",
          runnerId: "runner_1",
        }),
        runners: [
          {
            credentialHash: "not-a-valid-sha256-hex-hash",
            id: "runner_1",
            revokedAt: null,
            workspaceId: "workspace_1",
          },
        ],
      },
      {
        audit: true,
        name: "revoked runner",
        request: createAuthenticatedRequest({
          authorization: "Bearer runner-secret-credential",
          runnerId: "runner_1",
        }),
        runners: [
          {
            credentialHash: sha256("runner-secret-credential"),
            id: "runner_1",
            revokedAt,
            workspaceId: "workspace_1",
          },
        ],
      },
    ];

    for (const testCase of cases) {
      const store = createAuthenticationStore(testCase.runners);
      const service = await createAuthenticationServiceFor(store);

      await expect(
        service.authenticateRunnerRequest(testCase.request),
        testCase.name,
      ).rejects.toMatchObject({
        code: "invalid_runner_auth",
        message: "Invalid runner credentials.",
      });

      expect(store.auditEvents).toHaveLength(testCase.audit ? 1 : 0);
    }
  });

  test("reads runner identity only from x-control-plane-runner-id, not legacy headers, body, query, or cookies", async () => {
    const store = createAuthenticationStore([
      {
        credentialHash: sha256("runner-secret-credential"),
        id: "runner_1",
        revokedAt: null,
        workspaceId: "workspace_1",
      },
    ]);
    const service = await createAuthenticationServiceFor(store);
    const request = new Request(
      "https://control-plane.test/api/runner/heartbeat?runnerId=runner_1",
      {
        body: JSON.stringify({
          runnerId: "runner_1",
          source: "request body must not be consulted",
        }),
        headers: {
          authorization: "Bearer runner-secret-credential",
          cookie: "runnerId=runner_1",
          "x-runner-id": "runner_1",
        },
        method: "POST",
      },
    );

    await expect(service.authenticateRunnerRequest(request)).rejects.toMatchObject({
      code: "invalid_runner_auth",
    });
    expect(store.findRunnerAuthRecord).not.toHaveBeenCalled();
    expect(store.insertRunnerAuthFailureAudit).not.toHaveBeenCalled();
  });

  test("uses hashed credential material and keeps raw credential, hashes, headers, and request bodies out of errors and audit metadata", async () => {
    const store = createAuthenticationStore([
      {
        credentialHash: sha256("runner-secret-credential"),
        id: "runner_1",
        revokedAt: null,
        workspaceId: "workspace_1",
      },
    ]);
    const service = await createAuthenticationServiceFor(store);
    const request = createAuthenticatedRequest({
      authorization: "Bearer wrong-runner-credential",
      body: {
        credential: "body-credential-that-must-not-leak",
        source: "raw body field",
      },
      runnerId: "runner_1",
    });

    await expect(service.authenticateRunnerRequest(request)).rejects.toMatchObject({
      code: "invalid_runner_auth",
    });

    const serializedFailureMaterial = JSON.stringify({
      auditEvents: store.auditEvents,
      calls: store.insertRunnerAuthFailureAudit.mock.calls,
    });

    expect(store.findRunnerAuthRecord).toHaveBeenCalledWith({ runnerId: "runner_1" });
    expect(serializedFailureMaterial).not.toContain("wrong-runner-credential");
    expect(serializedFailureMaterial).not.toContain("runner-secret-credential");
    expect(serializedFailureMaterial).not.toContain("body-credential-that-must-not-leak");
    expect(serializedFailureMaterial).not.toContain("raw body field");
    expect(serializedFailureMaterial).not.toContain(sha256("runner-secret-credential"));
    expect(serializedFailureMaterial).not.toContain(sha256("wrong-runner-credential"));
    expect(serializedFailureMaterial).not.toMatch(
      /authorization|bearer|body|credentialHash|source|diff|patch|logs?/i,
    );
  });

  test("writes safe audit metadata for existing-runner authentication failures only", async () => {
    const store = createAuthenticationStore([
      {
        credentialHash: sha256("runner-secret-credential"),
        id: "runner_1",
        revokedAt: null,
        workspaceId: "workspace_1",
      },
    ]);
    const service = await createAuthenticationServiceFor(store);

    await expect(
      service.authenticateRunnerRequest(
        createAuthenticatedRequest({
          authorization: "Bearer wrong-runner-credential",
          runnerId: "runner_1",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_runner_auth" });

    await expect(
      service.authenticateRunnerRequest(
        createAuthenticatedRequest({
          authorization: "Bearer wrong-runner-credential",
          runnerId: "runner_unknown",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_runner_auth" });

    expect(store.auditEvents).toEqual([
      {
        createdAt: now,
        eventType: "runner.auth_failed",
        id: "audit_1",
        message: "Runner authentication failed.",
        metadata: {
          reason: "mismatch",
        },
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
    ]);
    expectNoCredentialMaterial(store.auditEvents);
  });

  test("audits revoked runner failures with safe reason metadata only", async () => {
    const revokedAt = new Date("2026-05-22T13:05:00.000Z");
    const store = createAuthenticationStore([
      {
        credentialHash: sha256("runner-secret-credential"),
        id: "runner_1",
        revokedAt,
        workspaceId: "workspace_1",
      },
    ]);
    const service = await createAuthenticationServiceFor(store);

    await expect(
      service.authenticateRunnerRequest(
        createAuthenticatedRequest({
          authorization: "Bearer runner-secret-credential",
          runnerId: "runner_1",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_runner_auth" });

    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "runner.auth_failed",
        metadata: {
          reason: "revoked",
        },
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoCredentialMaterial(store.auditEvents);
  });
});
