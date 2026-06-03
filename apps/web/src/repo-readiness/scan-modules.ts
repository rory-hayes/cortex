import "server-only";

import {
  createAgentReadinessScanModule,
  type AgentReadinessScanModuleInput,
} from "./scan-modules/agent-readiness";
import {
  createArchitectureScanModule,
  type ArchitectureScanModuleInput,
} from "./scan-modules/architecture";
import {
  createBacklogQualityScanModule,
  type BacklogQualityScanModuleInput,
} from "./scan-modules/backlog-quality";
import { createCiCdScanModule, type CiCdScanModuleInput } from "./scan-modules/ci-cd";
import {
  createGitHubInventoryScanModule,
  type GitHubInventoryScanModuleInput,
} from "./scan-modules/github-inventory";
import {
  createProductClarityScanModule,
  type ProductClarityScanModuleInput,
} from "./scan-modules/product-clarity";
import {
  createRepoHygieneScanModule,
  type RepoHygieneScanModuleInput,
} from "./scan-modules/repo-hygiene";
import { createSecurityScanModule, type SecurityScanModuleInput } from "./scan-modules/security";
import {
  createValidationPostureScanModule,
  type ValidationPostureScanModuleInput,
} from "./scan-modules/validation-posture";

export { createAgentReadinessScanModule } from "./scan-modules/agent-readiness";
export type { AgentReadinessScanModuleInput } from "./scan-modules/agent-readiness";
export { createArchitectureScanModule } from "./scan-modules/architecture";
export type { ArchitectureScanModuleInput } from "./scan-modules/architecture";
export { createBacklogQualityScanModule } from "./scan-modules/backlog-quality";
export type { BacklogQualityScanModuleInput } from "./scan-modules/backlog-quality";
export { createCiCdScanModule } from "./scan-modules/ci-cd";
export type { CiCdScanModuleInput } from "./scan-modules/ci-cd";
export { createGitHubInventoryScanModule } from "./scan-modules/github-inventory";
export type { GitHubInventoryScanModuleInput } from "./scan-modules/github-inventory";
export { createProductClarityScanModule } from "./scan-modules/product-clarity";
export type { ProductClarityScanModuleInput } from "./scan-modules/product-clarity";
export { createRepoHygieneScanModule } from "./scan-modules/repo-hygiene";
export type { RepoHygieneScanModuleInput } from "./scan-modules/repo-hygiene";
export { createSecurityScanModule } from "./scan-modules/security";
export type { SecurityScanModuleInput } from "./scan-modules/security";
export { createValidationPostureScanModule } from "./scan-modules/validation-posture";
export type { ValidationPostureScanModuleInput } from "./scan-modules/validation-posture";
export {
  runRepoScanModules,
  type RepoScanModuleDefinition,
  type RepoScanModuleRunContext,
  type RepoScanModuleRunResult,
  type RepoScanModuleTerminalStatus,
  type RunRepoScanModulesInput,
} from "./scan-module-runner";
import type { RepoScanModuleDefinition } from "./scan-module-runner";

export type RepoReadinessScanModulesInput = GitHubInventoryScanModuleInput &
  ProductClarityScanModuleInput &
  AgentReadinessScanModuleInput &
  ArchitectureScanModuleInput &
  BacklogQualityScanModuleInput &
  ValidationPostureScanModuleInput &
  CiCdScanModuleInput &
  SecurityScanModuleInput &
  RepoHygieneScanModuleInput;

export const createRepoReadinessScanModules = (
  input: RepoReadinessScanModulesInput,
): RepoScanModuleDefinition[] => [
  createGitHubInventoryScanModule({ inventoryService: input.inventoryService }),
  createProductClarityScanModule({
    findingService: input.findingService,
    ...(input.now === undefined ? {} : { now: input.now }),
    taskRecommendationService: input.taskRecommendationService,
  }),
  createAgentReadinessScanModule({
    findingService: input.findingService,
    ...(input.now === undefined ? {} : { now: input.now }),
    taskRecommendationService: input.taskRecommendationService,
  }),
  createArchitectureScanModule({
    findingService: input.findingService,
    ...(input.now === undefined ? {} : { now: input.now }),
    taskRecommendationService: input.taskRecommendationService,
  }),
  createBacklogQualityScanModule({
    findingService: input.findingService,
    ...(input.now === undefined ? {} : { now: input.now }),
    taskRecommendationService: input.taskRecommendationService,
  }),
  createValidationPostureScanModule({
    findingService: input.findingService,
    ...(input.now === undefined ? {} : { now: input.now }),
    taskRecommendationService: input.taskRecommendationService,
  }),
  createCiCdScanModule({
    findingService: input.findingService,
    ...(input.now === undefined ? {} : { now: input.now }),
    taskRecommendationService: input.taskRecommendationService,
  }),
  createSecurityScanModule({
    findingService: input.findingService,
    ...(input.now === undefined ? {} : { now: input.now }),
    taskRecommendationService: input.taskRecommendationService,
  }),
  createRepoHygieneScanModule({
    findingService: input.findingService,
    ...(input.now === undefined ? {} : { now: input.now }),
    taskRecommendationService: input.taskRecommendationService,
  }),
];
