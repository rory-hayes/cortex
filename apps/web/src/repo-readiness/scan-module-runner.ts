import "server-only";

import {
  type RepoScan,
  type RepoScanInventory,
  type RepoScanModuleStatus,
  type RepoScanModuleStatusValue,
} from "@control-plane/shared";

import { createActionError } from "../server/errors";
import type { RepoScanService, UpdateRepoScanStatusInput } from "./repo-scans";

export type RepoScanModuleTerminalStatus = Exclude<RepoScanModuleStatusValue, "queued" | "running">;

export type RepoScanModuleRunContext = {
  repoId: string;
  scan?: RepoScan;
  scanId: string;
  workspaceId: string;
};

export type RepoScanModuleRunResult = {
  findingIds?: string[];
  inventory?: RepoScanInventory;
  metadata?: Record<string, unknown>;
  readinessReportId?: string;
  status: RepoScanModuleTerminalStatus;
  summary: string;
  taskRecommendationIds?: string[];
};

export type RepoScanModuleDefinition = {
  id: string;
  label: string;
  order: number;
  required: boolean;
  run: (context: RepoScanModuleRunContext) => Promise<RepoScanModuleRunResult>;
};

export type RunRepoScanModulesInput = {
  modules: RepoScanModuleDefinition[];
  now?: () => Date;
  scanId: string;
  service: Pick<RepoScanService, "getRepoScan" | "updateRepoScanStatus">;
  workspaceId: string;
};

const queuedStatusFor = (module: RepoScanModuleDefinition): RepoScanModuleStatus => ({
  id: module.id,
  label: module.label,
  metadata: {},
  order: module.order,
  required: module.required,
  status: "queued",
  summary: "Queued for repo scan module execution.",
});

const sortModules = (modules: RepoScanModuleDefinition[]): RepoScanModuleDefinition[] =>
  [...modules].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

const failedResultFromThrownError = (): RepoScanModuleRunResult => ({
  metadata: {
    errorKind: "module_execution_failed",
  },
  status: "failed",
  summary: "Repo scan module failed without exposing provider details.",
});

const shouldFailScan = (
  module: RepoScanModuleDefinition,
  result: RepoScanModuleRunResult,
): boolean => module.required && (result.status === "failed" || result.status === "blocked");

const failureSummaryFor = (result: RepoScanModuleRunResult): string =>
  result.status === "blocked"
    ? "Required repo scan module blocked."
    : "Required repo scan module failed.";

const appendUniqueIds = (
  existingIds: readonly string[],
  emittedIds: readonly string[],
): string[] => {
  const ids = new Set(existingIds);

  for (const emittedId of emittedIds) {
    ids.add(emittedId);
  }

  return [...ids];
};

const getModuleStatusAt = (
  moduleStatuses: RepoScanModuleStatus[],
  index: number,
): RepoScanModuleStatus => {
  const moduleStatus = moduleStatuses[index];

  if (moduleStatus === undefined) {
    throw createActionError("validation_error");
  }

  return moduleStatus;
};

export const runRepoScanModules = async ({
  modules,
  now = () => new Date(),
  scanId,
  service,
  workspaceId,
}: RunRepoScanModulesInput): Promise<RepoScan> => {
  const existingScan = await service.getRepoScan({ scanId, workspaceId });

  if (existingScan === null) {
    throw createActionError("validation_error");
  }

  const orderedModules = sortModules(modules);
  const moduleStatuses = orderedModules.map(queuedStatusFor);
  let currentScan = existingScan;

  const persist = async (
    statusSummary: string,
    updates: Partial<
      Pick<
        UpdateRepoScanStatusInput,
        | "failureSummary"
        | "findingIds"
        | "inventory"
        | "readinessReportId"
        | "taskRecommendationIds"
      >
    > = {},
    status: UpdateRepoScanStatusInput["status"] = "running",
  ): Promise<void> => {
    currentScan = await service.updateRepoScanStatus({
      moduleStatuses: moduleStatuses.map((moduleStatus) => ({
        ...moduleStatus,
        metadata: { ...moduleStatus.metadata },
      })),
      scanId,
      status,
      statusSummary,
      workspaceId,
      ...updates,
    });
  };

  for (const module of orderedModules) {
    const moduleIndex = moduleStatuses.findIndex((status) => status.id === module.id);
    const currentModuleStatus = getModuleStatusAt(moduleStatuses, moduleIndex);
    const startedAt = now().toISOString();

    moduleStatuses[moduleIndex] = {
      ...currentModuleStatus,
      metadata: {},
      startedAt,
      status: "running",
      summary: `${module.label} is running.`,
    };
    await persist(`Repo scan module ${module.label} is running.`);

    let result: RepoScanModuleRunResult;
    try {
      result = await module.run({
        repoId: currentScan.repoId,
        scan: currentScan,
        scanId,
        workspaceId,
      });
    } catch {
      result = failedResultFromThrownError();
    }

    const terminalUpdates: Partial<
      Pick<
        UpdateRepoScanStatusInput,
        "findingIds" | "inventory" | "readinessReportId" | "taskRecommendationIds"
      >
    > = {};

    if (result.findingIds !== undefined) {
      terminalUpdates.findingIds = appendUniqueIds(currentScan.findingIds, result.findingIds);
    }

    if (result.inventory !== undefined) {
      terminalUpdates.inventory = result.inventory;
    }

    if (result.readinessReportId !== undefined) {
      terminalUpdates.readinessReportId = result.readinessReportId;
    }

    if (result.taskRecommendationIds !== undefined) {
      terminalUpdates.taskRecommendationIds = appendUniqueIds(
        currentScan.taskRecommendationIds,
        result.taskRecommendationIds,
      );
    }

    moduleStatuses[moduleIndex] = {
      ...getModuleStatusAt(moduleStatuses, moduleIndex),
      finishedAt: now().toISOString(),
      metadata: result.metadata ?? {},
      status: result.status,
      summary: result.summary,
    };
    await persist(
      `Repo scan module ${module.label} finished with ${result.status}.`,
      terminalUpdates,
    );

    if (shouldFailScan(module, result)) {
      const skippedAt = now().toISOString();

      for (let index = moduleIndex + 1; index < moduleStatuses.length; index += 1) {
        const queuedModuleStatus = getModuleStatusAt(moduleStatuses, index);

        if (queuedModuleStatus.status === "queued") {
          moduleStatuses[index] = {
            ...queuedModuleStatus,
            finishedAt: skippedAt,
            status: "skipped",
            summary: "Skipped because a required repo scan module failed.",
          };
        }
      }

      await persist(
        "Repo readiness scan failed because a required module did not pass.",
        {
          failureSummary: failureSummaryFor(result),
        },
        "failed",
      );

      return currentScan;
    }
  }

  return currentScan;
};
