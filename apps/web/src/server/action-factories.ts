import "server-only";

import { revalidatePath as defaultRevalidatePath } from "next/cache";
import { cookies as defaultCookies } from "next/headers";

import { createGitHubAppClient } from "@control-plane/github";
import {
  CortexTaskExecutionModeSchema,
  CortexTaskStatusSchema,
  type CortexTask,
  type CortexTaskExecutionMode,
  type CortexTaskStatus,
  type SetupPrPreview,
} from "@control-plane/shared";

import { getDatabase } from "../db";
import { createBillingPlanLimitService } from "../billing/plan-limits";
import { createDrizzleUsageEventStore } from "../billing/usage-events";
import { createGitHubAppRequestFunction } from "../github/app-request";
import {
  createDrizzleGitHubIssueSyncStore,
  createGitHubIssueSyncService,
  type SyncCortexTaskToGitHubIssueInput,
  type SyncedGitHubIssueCortexTask,
} from "../github/issues";
import {
  createDrizzlePublicGitHubRepositoryStore,
  createPublicGitHubRepositoryService,
  type RegisteredPublicGitHubRepository,
  type RegisterPublicGitHubRepositoryInput,
} from "../github/public-repositories";
import {
  createCortexTaskRunnerQueueService,
  createDrizzleCortexTaskRunnerQueueStore,
} from "../jobs/cortex-queue";
import {
  createApprovalActionService,
  type ApprovalActionData,
  type ApprovalActionInput,
} from "../approvals/actions";
import {
  APPROVAL_REASON_MAX_LENGTH,
  RUN_ID_MAX_LENGTH as APPROVAL_RUN_ID_MAX_LENGTH,
  WORKSPACE_ID_MAX_LENGTH as APPROVAL_WORKSPACE_ID_MAX_LENGTH,
} from "../approvals/constants";
import { createDrizzleApprovalDecisionStore } from "../approvals/decisions";
import {
  createDrizzleRepoMappingStore,
  createRepoMappingService,
  type CreateRepoMappingInput,
  type DeleteRepoMappingInput,
  type DeletedRepoMappingData,
  type RepoMappingData,
} from "../repo-mappings/repo-mappings";
import {
  createDrizzleLinearIssueCandidateImportStore,
  createLinearIssueCandidateImportService,
  type ImportedLinearIssueCandidateTask,
  type ImportLinearIssueCandidateInput,
} from "../linear/import-candidates";
import {
  createDrizzleLinearTaskSyncStore,
  createLinearTaskSyncService,
  type SyncCortexTaskToLinearInput,
  type SyncedLinearCortexTask,
} from "../linear/task-sync";
import {
  createCortexTaskService,
  createDrizzleCortexTaskStore,
  type TransitionCortexTaskStatusInput,
  type UpdateCortexTaskExecutionModeInput,
} from "../repo-readiness/cortex-tasks";
import {
  createDrizzleRepoFindingStore,
  createRepoFindingService,
  type ConvertFindingToTaskInput,
  type ConvertedFindingTask,
  type PersistedFinding,
  type UpdateFindingStatusInput,
} from "../repo-readiness/findings";
import {
  createDrizzleRepoScanStore,
  createRepoScanService,
  type GetRepoScanStatusInput,
  type RepoScanStatusSummary,
  type TriggeredRepoScan,
  type TriggerRepoScanInput,
} from "../repo-readiness/repo-scans";
import {
  createDrizzleTaskRecommendationStore,
  createTaskRecommendationService,
  type ApproveTaskRecommendationInput,
  type ApproveTaskRecommendationsInput,
  type ApprovedTaskRecommendation,
  type PersistedTaskRecommendation,
  type TaskRecommendationStatusUpdate,
  type UpdateTaskRecommendationStatusInput,
} from "../repo-readiness/task-recommendations";
import {
  createDrizzleSetupPrCreationStore,
  createSetupPrCreationService,
  type CreateSetupPrFromPreviewInput,
  type SetupPrCreationResult,
} from "../setup-pr/creation";
import {
  createDrizzleSetupPrPreviewStore,
  createSetupPrPreviewService,
  type CreateSetupPrPreviewInput,
} from "../setup-pr/previews";
import {
  APPROVE_MANUAL_TASK_ID_MAX_LENGTH,
  APPROVE_MANUAL_TASK_WORKSPACE_ID_MAX_LENGTH,
  createApproveManualTaskService,
  createDrizzleApproveManualTaskStore,
  type ApprovedManualTaskData,
  type ApproveManualTaskInput,
} from "../tasks/approve";
import {
  createDrizzleManualTaskStore,
  createManualTaskService,
  type CreateManualTaskInput,
  type ManualTaskData,
  type ManualTaskMode,
} from "../tasks/manual-tasks";
import {
  CANCELLATION_REASON_MAX_LENGTH,
  RUN_ID_MAX_LENGTH,
  WORKSPACE_ID_MAX_LENGTH,
  createCancelRunService,
  createDrizzleCancelRunStore,
  type CancelRunData,
  type CancelRunInput,
} from "../runs/cancel";
import {
  REPAIR_FEEDBACK_MAX_LENGTH,
  RUN_ID_MAX_LENGTH as REPAIR_RUN_ID_MAX_LENGTH,
  WORKSPACE_ID_MAX_LENGTH as REPAIR_WORKSPACE_ID_MAX_LENGTH,
  createDrizzleRepairRequestStore,
  createRepairRequestService,
  type RepairRequestData,
  type RequestRepairInput,
} from "../repairs/repair-requests";
import {
  createDrizzleRunnerPairingStore,
  createRunnerPairingCodeService,
  type CreatedRunnerPairingCodeResult,
  type CreateRunnerPairingCodeInput,
} from "../runner-pairing/pairing-codes";
import {
  RUNNER_ID_MAX_LENGTH,
  WORKSPACE_ID_MAX_LENGTH as RUNNER_REVOKE_WORKSPACE_ID_MAX_LENGTH,
  createDrizzleRunnerRevokeStore,
  createRunnerRevokeService,
  type RevokeRunnerData,
  type RevokeRunnerInput,
} from "../runners/revoke";
import { assertSafeWebBoundPayload, hasUnsafePayloadPathText } from "../security/payload-guard";

import { createActionError, runServerAction, type ActionResult } from "./errors";
import {
  createDrizzleWorkspaceMutationStore,
  createWorkspaceMutationService,
  type CreateWorkspaceData,
  type CreateWorkspaceInput,
  type SelectedWorkspaceData,
  type SelectWorkspaceInput,
  type UpdateWorkspaceNameData,
  type UpdateWorkspaceNameInput,
} from "./workspace-mutations";

export const SELECTED_WORKSPACE_COOKIE_NAME = "aicp_selected_workspace_id";

type CreateWorkspaceAction = (input: unknown) => Promise<ActionResult<CreateWorkspaceData>>;
export type CreateRunnerPairingCodeActionState =
  ActionResult<CreatedRunnerPairingCodeResult> | null;
type CreateRunnerPairingCodeAction = (
  previousState: CreateRunnerPairingCodeActionState,
  input: unknown,
) => Promise<ActionResult<CreatedRunnerPairingCodeResult>>;
export type CreatedManualTaskActionData = {
  acceptanceCriteriaCount: number;
  contextFilePathCount: number;
  id: string;
  mode: ManualTaskData["mode"];
  repoMappingId: string;
  status: string;
  workspaceId: string;
};
export type CreateManualTaskActionState = ActionResult<CreatedManualTaskActionData> | null;
type CreateManualTaskAction = (
  previousState: CreateManualTaskActionState,
  input: unknown,
) => Promise<ActionResult<CreatedManualTaskActionData>>;
export type ApprovedManualTaskActionData = ApprovedManualTaskData;
type ApproveManualTaskAction = (
  input: unknown,
) => Promise<ActionResult<ApprovedManualTaskActionData>>;
type SelectWorkspaceAction = (input: unknown) => Promise<ActionResult<SelectedWorkspaceData>>;
type UpdateWorkspaceNameAction = (input: unknown) => Promise<ActionResult<UpdateWorkspaceNameData>>;
type CancelRunAction = (input: unknown) => Promise<ActionResult<CancelRunData>>;
type RequestRepairAction = (input: unknown) => Promise<ActionResult<RepairRequestData>>;
type ApproveRunAction = (input: unknown) => Promise<ActionResult<ApprovalActionData>>;
type RejectRunAction = (input: unknown) => Promise<ActionResult<ApprovalActionData>>;
type CreateRepoMappingAction = (input: unknown) => Promise<ActionResult<RepoMappingData>>;
type DeleteRepoMappingAction = (input: unknown) => Promise<ActionResult<DeletedRepoMappingData>>;
type RevokeRunnerAction = (input: unknown) => Promise<ActionResult<RevokeRunnerData>>;
export type UpdateFindingStatusActionData = {
  findingId: string;
  status: "dismissed" | "deferred";
  taskIdCount: number;
  workspaceId: string;
};
type UpdateFindingStatusAction = (
  input: unknown,
) => Promise<ActionResult<UpdateFindingStatusActionData>>;
export type ConvertFindingToTaskActionData = {
  approvalStatus: "not_requested";
  findingId: string;
  repoId: string;
  status: "draft";
  taskId: string;
  workspaceId: string;
};
type ConvertFindingToTaskAction = (
  input: unknown,
) => Promise<ActionResult<ConvertFindingToTaskActionData>>;
export type ApproveTaskRecommendationActionData = {
  approvalStatus: "not_requested";
  repoId: string;
  status: "draft";
  taskId: string;
  taskRecommendationId: string;
  workspaceId: string;
};
type ApproveTaskRecommendationAction = (
  input: unknown,
) => Promise<ActionResult<ApproveTaskRecommendationActionData>>;
export type ApproveTaskRecommendationsActionData = {
  approvals: ApproveTaskRecommendationActionData[];
};
type ApproveTaskRecommendationsAction = (
  input: unknown,
) => Promise<ActionResult<ApproveTaskRecommendationsActionData>>;
export type UpdateTaskRecommendationStatusActionData = {
  status: "deferred" | "ignored";
  taskRecommendationId: string;
  workspaceId: string;
};
type UpdateTaskRecommendationStatusAction = (
  input: unknown,
) => Promise<ActionResult<UpdateTaskRecommendationStatusActionData>>;
export type TransitionCortexTaskStatusActionData = {
  approvalStatus: CortexTask["approvalStatus"];
  repoId: string;
  status: CortexTaskStatus;
  taskId: string;
  workspaceId: string;
};
type TransitionCortexTaskStatusAction = (
  input: unknown,
) => Promise<ActionResult<TransitionCortexTaskStatusActionData>>;
export type UpdateCortexTaskExecutionModeActionData = {
  approvalStatus: CortexTask["approvalStatus"];
  executionMode: CortexTaskExecutionMode;
  repoId: string;
  status: CortexTaskStatus;
  taskId: string;
  workspaceId: string;
};
type UpdateCortexTaskExecutionModeAction = (
  input: unknown,
) => Promise<ActionResult<UpdateCortexTaskExecutionModeActionData>>;
export type CreateSetupPrPreviewActionData = {
  fileCount: number;
  previewId: string;
  repoId: string;
  status: "draft";
  taskCount: number;
  workspaceId: string;
};
type CreateSetupPrPreviewAction = (
  input: unknown,
) => Promise<ActionResult<CreateSetupPrPreviewActionData>>;
export type CreateSetupPrFromPreviewActionData = {
  branchName: string;
  previewId: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  repoId: string;
  status: "pr_created";
  workspaceId: string;
};
type CreateSetupPrFromPreviewAction = (
  input: unknown,
) => Promise<ActionResult<CreateSetupPrFromPreviewActionData>>;
export type ImportLinearIssueCandidateActionData = ImportedLinearIssueCandidateTask;
type ImportLinearIssueCandidateAction = (
  input: unknown,
) => Promise<ActionResult<ImportLinearIssueCandidateActionData>>;
export type SyncCortexTaskToLinearActionData = SyncedLinearCortexTask;
type SyncCortexTaskToLinearAction = (
  input: unknown,
) => Promise<ActionResult<SyncCortexTaskToLinearActionData>>;
export type SyncCortexTaskToGitHubIssueActionData = SyncedGitHubIssueCortexTask;
type SyncCortexTaskToGitHubIssueAction = (
  input: unknown,
) => Promise<ActionResult<SyncCortexTaskToGitHubIssueActionData>>;
export type TriggerRepoScanActionData = {
  repoId: string;
  scanId: string;
  status: "queued" | "running";
  workspaceId: string;
};
type TriggerRepoScanAction = (input: unknown) => Promise<ActionResult<TriggerRepoScanActionData>>;
export type TriggerPublicRepoScanInput = RegisterPublicGitHubRepositoryInput & {
  productGoal?: string;
};
type TriggerPublicRepoScanAction = (
  input: unknown,
) => Promise<ActionResult<TriggerRepoScanActionData>>;
export type GetRepoScanStatusActionData = RepoScanStatusSummary;
type GetRepoScanStatusAction = (
  input: unknown,
) => Promise<ActionResult<GetRepoScanStatusActionData | null>>;

const WORKSPACE_NAME_MAX_LENGTH = 120;
const PRODUCT_GOAL_MAX_LENGTH = 500;

const isFormDataInput = (input: unknown): input is FormData =>
  typeof FormData !== "undefined" && input instanceof FormData;

const getStringField = (input: unknown, field: string): string => {
  if (isFormDataInput(input)) {
    const value = input.get(field);

    return typeof value === "string" ? value.trim() : "";
  }

  if (typeof input !== "object" || input === null) {
    throw createActionError("validation_error");
  }

  const fields = input as Record<string, unknown>;

  return typeof fields[field] === "string" ? fields[field].trim() : "";
};

const getOptionalStringField = (input: unknown, field: string): string | undefined => {
  const value = getStringField(input, field);

  return value.length > 0 ? value : undefined;
};

const getStringFieldValues = (input: unknown, field: string): string[] => {
  if (isFormDataInput(input)) {
    return input
      .getAll(field)
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0);
  }

  if (input instanceof URLSearchParams) {
    return input
      .getAll(field)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  if (typeof input !== "object" || input === null) {
    throw createActionError("validation_error");
  }

  const value = (input as Record<string, unknown>)[field];
  const values = Array.isArray(value) ? value : [value];

  return values
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
};

const parseWorkspaceName = (input: unknown): string => {
  const name = getStringField(input, "name");

  if (name.length === 0 || name.length > WORKSPACE_NAME_MAX_LENGTH) {
    throw createActionError("validation_error");
  }

  return name;
};

const parseWorkspaceId = (input: unknown): string => {
  const workspaceId = getStringField(input, "workspaceId");

  if (workspaceId.length === 0) {
    throw createActionError("validation_error");
  }

  return workspaceId;
};

const parseBoundedStringField = (input: unknown, field: string, maxLength: number): string => {
  const value = getStringField(input, field);

  if (value.length === 0 || value.length > maxLength) {
    throw createActionError("validation_error");
  }

  return value;
};

const hasInputField = (input: unknown, field: string): boolean => {
  if (isFormDataInput(input)) {
    return input.has(field);
  }

  if (input instanceof URLSearchParams) {
    return input.has(field);
  }

  return typeof input === "object" && input !== null && field in input;
};

const parseOptionalBoundedStringField = (
  input: unknown,
  field: string,
  maxLength: number,
): string | undefined => {
  if (!hasInputField(input, field)) {
    return undefined;
  }

  return parseBoundedStringField(input, field, maxLength);
};

const parseOptionalBoundedStringValuesField = (
  input: unknown,
  field: string,
  maxLength: number,
): string[] | undefined => {
  if (!hasInputField(input, field)) {
    return undefined;
  }

  const values = getStringFieldValues(input, field);

  if (values.length === 0 || values.some((value) => value.length > maxLength)) {
    throw createActionError("validation_error");
  }

  return values;
};

const parseCreateWorkspaceInput = (input: unknown): CreateWorkspaceInput => ({
  name: parseWorkspaceName(input),
});

const parseSelectWorkspaceInput = (input: unknown): SelectWorkspaceInput => ({
  workspaceId: parseWorkspaceId(input),
});

const parseCreateRunnerPairingCodeInput = (input: unknown): CreateRunnerPairingCodeInput => ({
  workspaceId: parseWorkspaceId(input),
});

const parseUpdateWorkspaceNameInput = (input: unknown): UpdateWorkspaceNameInput => {
  return {
    name: parseWorkspaceName(input),
    workspaceId: parseWorkspaceId(input),
  };
};

const parseCancelRunInput = (input: unknown): CancelRunInput => ({
  reason: parseBoundedStringField(input, "reason", CANCELLATION_REASON_MAX_LENGTH),
  runId: parseBoundedStringField(input, "runId", RUN_ID_MAX_LENGTH),
  workspaceId: parseBoundedStringField(input, "workspaceId", WORKSPACE_ID_MAX_LENGTH),
});

const parseApprovalActionInput = (input: unknown): ApprovalActionInput => {
  assertOnlyAllowedActionFields(input, approvalActionFields);

  return {
    reason: parseBoundedStringField(input, "reason", APPROVAL_REASON_MAX_LENGTH),
    runId: parseBoundedStringField(input, "runId", APPROVAL_RUN_ID_MAX_LENGTH),
    workspaceId: parseBoundedStringField(input, "workspaceId", APPROVAL_WORKSPACE_ID_MAX_LENGTH),
  };
};

const unsafeApproveManualTaskFormFields = new Set([
  "acceptancecriteria",
  "content",
  "contents",
  "contextfilepaths",
  "dependencygraph",
  "dependencygraphs",
  "diff",
  "filecontent",
  "filecontents",
  "filetree",
  "filetrees",
  "localpath",
  "log",
  "logs",
  "objective",
  "output",
  "patch",
  "policysnapshot",
  "rawdiff",
  "rawlog",
  "rawoutput",
  "rawpatch",
  "rawsource",
  "rawstderr",
  "rawstdout",
  "sourcecode",
  "sourcecontent",
  "stderr",
  "stdout",
  "snippet",
  "snippets",
  "title",
  "validationcommands",
]);

const unsafeManualTaskFormFields = new Set([
  "content",
  "contents",
  "dependencygraph",
  "dependencygraphs",
  "diff",
  "filecontent",
  "filecontents",
  "filetree",
  "filetrees",
  "log",
  "logs",
  "output",
  "patch",
  "policysnapshot",
  "rawdiff",
  "rawlog",
  "rawoutput",
  "rawpatch",
  "rawsource",
  "rawstderr",
  "rawstdout",
  "sourcecode",
  "sourcecontent",
  "stderr",
  "stdout",
  "snippet",
  "snippets",
  "validationcommands",
]);

const normalizeActionFieldName = (field: string): string =>
  field.toLowerCase().replace(/[^a-z0-9]/g, "");

const isNextServerActionField = (field: string): boolean => field.startsWith("$ACTION_");

const approvalActionFields = new Set(["workspaceid", "runid", "reason"]);
const convertFindingToTaskActionFields = new Set(["workspaceid", "findingid"]);
const findingStatusActionFields = new Set(["workspaceid", "findingid", "status"]);
const repairActionFields = new Set(["workspaceid", "previousrunid", "feedback"]);
const taskRecommendationActionFields = new Set([
  "acceptancecriteria",
  "objective",
  "taskrecommendationid",
  "title",
  "workspaceid",
]);
const taskRecommendationsActionFields = new Set([
  "recommendations",
  "taskrecommendationid",
  "taskrecommendationids",
  "workspaceid",
]);
const taskRecommendationApprovalRequestFields = new Set([
  "acceptancecriteria",
  "objective",
  "taskrecommendationid",
  "title",
]);
const taskRecommendationStatusActionFields = new Set([
  "workspaceid",
  "taskrecommendationid",
  "status",
]);
const cortexTaskStatusActionFields = new Set(["workspaceid", "taskid", "status"]);
const cortexTaskExecutionModeActionFields = new Set(["workspaceid", "taskid", "executionmode"]);
const setupPrPreviewActionFields = new Set([
  "excludedtaskid",
  "excludedtaskids",
  "excludedtemplateid",
  "excludedtemplateids",
  "repoid",
  "taskid",
  "taskids",
  "workspaceid",
]);
const setupPrCreationActionFields = new Set(["previewid", "workspaceid"]);
const importLinearIssueCandidateActionFields = new Set([
  "workspaceid",
  "linearissuecandidateid",
  "repoid",
]);
const triggerRepoScanActionFields = new Set(["workspaceId", "repoId", "productGoal"]);
const getRepoScanStatusActionFields = new Set(["workspaceId", "repoId", "scanId"]);
const syncCortexTaskToLinearCanonicalActionFields = new Set([
  "workspaceId",
  "taskId",
  "linearConnectionId",
  "teamId",
  "projectId",
  "statusId",
]);
const syncCortexTaskToGitHubIssueCanonicalActionFields = new Set(["workspaceId", "taskId"]);
const triggerPublicRepoScanActionFields = new Set(["workspaceId", "repositoryUrl", "productGoal"]);

const assertNoUnsafeManualTaskFormFields = (input: unknown): void => {
  const fields =
    isFormDataInput(input) || input instanceof URLSearchParams
      ? Array.from(input.keys())
      : typeof input === "object" && input !== null
        ? Object.keys(input)
        : [];

  if (fields.some((field) => unsafeManualTaskFormFields.has(normalizeActionFieldName(field)))) {
    throw createActionError("validation_error");
  }
};

const assertNoUnsafeApproveManualTaskFormFields = (input: unknown): void => {
  const fields =
    isFormDataInput(input) || input instanceof URLSearchParams
      ? Array.from(input.keys())
      : typeof input === "object" && input !== null
        ? Object.keys(input)
        : [];

  if (
    fields.some((field) => unsafeApproveManualTaskFormFields.has(normalizeActionFieldName(field)))
  ) {
    throw createActionError("validation_error");
  }
};

const assertOnlyAllowedActionFields = (input: unknown, allowedFields: Set<string>): void => {
  const fields =
    isFormDataInput(input) || input instanceof URLSearchParams
      ? Array.from(input.keys())
      : typeof input === "object" && input !== null
        ? Object.keys(input)
        : [];

  if (
    fields.some(
      (field) =>
        !isNextServerActionField(field) && !allowedFields.has(normalizeActionFieldName(field)),
    )
  ) {
    throw createActionError("validation_error");
  }
};

const assertOnlyAllowedCanonicalActionFields = (
  input: unknown,
  allowedCanonicalFields: Set<string>,
): void => {
  const fields =
    isFormDataInput(input) || input instanceof URLSearchParams
      ? Array.from(input.keys())
      : typeof input === "object" && input !== null
        ? Object.keys(input)
        : [];
  const normalizedAllowedFields = new Set(
    Array.from(allowedCanonicalFields, (field) => normalizeActionFieldName(field)),
  );

  if (
    fields.some((field) => {
      if (isNextServerActionField(field)) {
        return false;
      }

      return (
        !allowedCanonicalFields.has(field) ||
        !normalizedAllowedFields.has(normalizeActionFieldName(field))
      );
    })
  ) {
    throw createActionError("validation_error");
  }
};

const parseRequestRepairInput = (input: unknown): RequestRepairInput => {
  assertOnlyAllowedActionFields(input, repairActionFields);

  return {
    feedback: parseBoundedStringField(input, "feedback", REPAIR_FEEDBACK_MAX_LENGTH),
    previousRunId: parseBoundedStringField(input, "previousRunId", REPAIR_RUN_ID_MAX_LENGTH),
    workspaceId: parseBoundedStringField(input, "workspaceId", REPAIR_WORKSPACE_ID_MAX_LENGTH),
  };
};

const parseFindingStatus = (input: unknown): "dismissed" | "deferred" => {
  const status = getStringField(input, "status");

  if (status === "dismissed" || status === "deferred") {
    return status;
  }

  throw createActionError("validation_error");
};

const parseUpdateFindingStatusInput = (input: unknown): UpdateFindingStatusInput => {
  assertOnlyAllowedActionFields(input, findingStatusActionFields);

  return {
    findingId: parseBoundedStringField(input, "findingId", 240),
    status: parseFindingStatus(input),
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
};

const parseConvertFindingToTaskInput = (input: unknown): ConvertFindingToTaskInput => {
  assertOnlyAllowedActionFields(input, convertFindingToTaskActionFields);

  return {
    findingId: parseBoundedStringField(input, "findingId", 240),
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
};

const parseTaskRecommendationApprovalRequest = (
  input: unknown,
): ApproveTaskRecommendationsInput["recommendations"][number] => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw createActionError("validation_error");
  }

  const request: ApproveTaskRecommendationsInput["recommendations"][number] = {
    taskRecommendationId: parseBoundedStringField(input, "taskRecommendationId", 240),
  };
  const title = parseOptionalBoundedStringField(input, "title", 240);
  const objective = parseOptionalBoundedStringField(input, "objective", 1_000);
  const acceptanceCriteria = parseOptionalBoundedStringValuesField(
    input,
    "acceptanceCriteria",
    1_000,
  );

  if (title !== undefined) {
    request.title = title;
  }

  if (objective !== undefined) {
    request.objective = objective;
  }

  if (acceptanceCriteria !== undefined) {
    request.acceptanceCriteria = acceptanceCriteria;
  }

  return request;
};

const parseApproveTaskRecommendationInput = (input: unknown): ApproveTaskRecommendationInput => {
  assertOnlyAllowedActionFields(input, taskRecommendationActionFields);

  const request = parseTaskRecommendationApprovalRequest(input);

  return {
    ...request,
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
};

const parseApproveTaskRecommendationsInput = (input: unknown): ApproveTaskRecommendationsInput => {
  assertOnlyAllowedActionFields(input, taskRecommendationsActionFields);

  const workspaceId = parseBoundedStringField(input, "workspaceId", 240);

  if (typeof input === "object" && input !== null && "recommendations" in input) {
    const recommendations = (input as { recommendations?: unknown }).recommendations;

    if (!Array.isArray(recommendations) || recommendations.length === 0) {
      throw createActionError("validation_error");
    }

    return {
      recommendations: recommendations.map((recommendation) => {
        assertOnlyAllowedActionFields(recommendation, taskRecommendationApprovalRequestFields);

        return parseTaskRecommendationApprovalRequest(recommendation);
      }),
      workspaceId,
    };
  }

  const taskRecommendationIds = [
    ...getStringFieldValues(input, "taskRecommendationId"),
    ...getStringFieldValues(input, "taskRecommendationIds"),
  ];

  if (taskRecommendationIds.length === 0) {
    throw createActionError("validation_error");
  }

  return {
    recommendations: taskRecommendationIds.map((taskRecommendationId) => ({
      taskRecommendationId,
    })),
    workspaceId,
  };
};

const parseTaskRecommendationStatus = (input: unknown): "deferred" | "ignored" => {
  const status = getStringField(input, "status") as TaskRecommendationStatusUpdate;

  if (status === "dismissed" || status === "ignored") {
    return "ignored";
  }

  if (status === "deferred") {
    return status;
  }

  throw createActionError("validation_error");
};

const parseUpdateTaskRecommendationStatusInput = (
  input: unknown,
): UpdateTaskRecommendationStatusInput => {
  assertOnlyAllowedActionFields(input, taskRecommendationStatusActionFields);

  return {
    status: parseTaskRecommendationStatus(input),
    taskRecommendationId: parseBoundedStringField(input, "taskRecommendationId", 240),
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
};

const parseCortexTaskStatus = (input: unknown): CortexTaskStatus => {
  const result = CortexTaskStatusSchema.safeParse(getStringField(input, "status"));

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const parseCortexTaskExecutionMode = (input: unknown): CortexTaskExecutionMode => {
  const result = CortexTaskExecutionModeSchema.safeParse(getStringField(input, "executionMode"));

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

const parseTransitionCortexTaskStatusInput = (input: unknown): TransitionCortexTaskStatusInput => {
  assertOnlyAllowedActionFields(input, cortexTaskStatusActionFields);

  return {
    status: parseCortexTaskStatus(input),
    taskId: parseBoundedStringField(input, "taskId", 240),
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
};

const parseUpdateCortexTaskExecutionModeInput = (
  input: unknown,
): UpdateCortexTaskExecutionModeInput => {
  assertOnlyAllowedActionFields(input, cortexTaskExecutionModeActionFields);

  return {
    executionMode: parseCortexTaskExecutionMode(input),
    taskId: parseBoundedStringField(input, "taskId", 240),
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
};

const parseOptionalIdValues = (input: unknown, ...fields: string[]): string[] => [
  ...new Set(fields.flatMap((field) => getStringFieldValues(input, field))),
];

const parseCreateSetupPrPreviewInput = (input: unknown): CreateSetupPrPreviewInput => {
  assertOnlyAllowedActionFields(input, setupPrPreviewActionFields);

  const taskIds = parseOptionalIdValues(input, "taskId", "taskIds");

  if (taskIds.length === 0) {
    throw createActionError("validation_error");
  }

  const excludedTaskIds = parseOptionalIdValues(input, "excludedTaskId", "excludedTaskIds");
  const excludedTemplateIds = parseOptionalIdValues(
    input,
    "excludedTemplateId",
    "excludedTemplateIds",
  );

  return {
    repoId: parseBoundedStringField(input, "repoId", 240),
    taskIds,
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
    ...(excludedTaskIds.length === 0 ? {} : { excludedTaskIds }),
    ...(excludedTemplateIds.length === 0 ? {} : { excludedTemplateIds }),
  };
};

const parseCreateSetupPrFromPreviewInput = (input: unknown): CreateSetupPrFromPreviewInput => {
  assertOnlyAllowedActionFields(input, setupPrCreationActionFields);

  return {
    previewId: parseBoundedStringField(input, "previewId", 240),
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
};

const parseImportLinearIssueCandidateInput = (input: unknown): ImportLinearIssueCandidateInput => {
  assertOnlyAllowedActionFields(input, importLinearIssueCandidateActionFields);

  return {
    linearIssueCandidateId: parseBoundedStringField(input, "linearIssueCandidateId", 240),
    repoId: parseBoundedStringField(input, "repoId", 240),
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
};

const parseOptionalProductGoal = (input: unknown): string | undefined => {
  if (!hasInputField(input, "productGoal")) {
    return undefined;
  }

  const productGoal = getStringField(input, "productGoal");

  if (productGoal.length === 0) {
    return undefined;
  }

  if (productGoal.length > PRODUCT_GOAL_MAX_LENGTH || hasUnsafePayloadPathText(productGoal)) {
    throw createActionError("validation_error");
  }

  try {
    assertSafeWebBoundPayload(productGoal);
  } catch {
    throw createActionError("validation_error");
  }

  return productGoal;
};

const parseTriggerRepoScanInput = (input: unknown): TriggerRepoScanInput => {
  assertOnlyAllowedCanonicalActionFields(input, triggerRepoScanActionFields);
  const productGoal = parseOptionalProductGoal(input);

  return {
    ...(productGoal === undefined ? {} : { productGoal }),
    repoId: parseBoundedStringField(input, "repoId", 240),
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
};

const parseTriggerPublicRepoScanInput = (input: unknown): TriggerPublicRepoScanInput => {
  assertOnlyAllowedCanonicalActionFields(input, triggerPublicRepoScanActionFields);
  const productGoal = parseOptionalProductGoal(input);
  const repositoryUrl = parseBoundedStringField(input, "repositoryUrl", 512);

  try {
    assertSafeWebBoundPayload(repositoryUrl);
  } catch {
    throw createActionError("validation_error");
  }

  return {
    ...(productGoal === undefined ? {} : { productGoal }),
    repositoryUrl,
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
};

const parseGetRepoScanStatusInput = (input: unknown): GetRepoScanStatusInput => {
  assertOnlyAllowedCanonicalActionFields(input, getRepoScanStatusActionFields);

  const workspaceId = parseBoundedStringField(input, "workspaceId", 240);
  const repoId = getOptionalStringField(input, "repoId");
  const scanId = getOptionalStringField(input, "scanId");

  if (
    (repoId === undefined && scanId === undefined) ||
    (repoId !== undefined && scanId !== undefined)
  ) {
    throw createActionError("validation_error");
  }

  if (scanId === undefined) {
    if (repoId === undefined) {
      throw createActionError("validation_error");
    }

    return { repoId, workspaceId };
  }

  return { scanId, workspaceId };
};

const parseSyncCortexTaskToLinearInput = (input: unknown): SyncCortexTaskToLinearInput => {
  assertOnlyAllowedCanonicalActionFields(input, syncCortexTaskToLinearCanonicalActionFields);

  const parsedInput: SyncCortexTaskToLinearInput = {
    linearConnectionId: parseBoundedStringField(input, "linearConnectionId", 240),
    taskId: parseBoundedStringField(input, "taskId", 240),
    teamId: parseBoundedStringField(input, "teamId", 240),
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
  const projectId = getOptionalStringField(input, "projectId");
  const statusId = getOptionalStringField(input, "statusId");

  if (projectId !== undefined) {
    parsedInput.projectId = projectId;
  }

  if (statusId !== undefined) {
    parsedInput.statusId = statusId;
  }

  return parsedInput;
};

const parseSyncCortexTaskToGitHubIssueInput = (
  input: unknown,
): SyncCortexTaskToGitHubIssueInput => {
  assertOnlyAllowedCanonicalActionFields(input, syncCortexTaskToGitHubIssueCanonicalActionFields);

  return {
    taskId: parseBoundedStringField(input, "taskId", 240),
    workspaceId: parseBoundedStringField(input, "workspaceId", 240),
  };
};

const splitMultilineField = (input: unknown, field: string): string[] =>
  getStringFieldValues(input, field)
    .flatMap((value) => value.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const parseManualTaskMode = (input: unknown): ManualTaskMode => {
  const mode = getStringField(input, "mode");

  if (mode === "execute" || mode === "dryRun") {
    return mode;
  }

  throw createActionError("validation_error");
};

const parseCreateManualTaskInput = (input: unknown): CreateManualTaskInput => {
  assertNoUnsafeManualTaskFormFields(input);

  const acceptanceCriteria = splitMultilineField(input, "acceptanceCriteria");
  if (acceptanceCriteria.length === 0) {
    throw createActionError("validation_error");
  }

  const parsedInput: CreateManualTaskInput = {
    acceptanceCriteria,
    mode: parseManualTaskMode(input),
    objective: getStringField(input, "objective"),
    repoMappingId: getStringField(input, "repoMappingId"),
    title: getStringField(input, "title"),
    workspaceId: getStringField(input, "workspaceId"),
  };
  const contextFilePaths = splitMultilineField(input, "contextFilePaths");

  if (contextFilePaths.length > 0) {
    parsedInput.contextFilePaths = contextFilePaths;
  }

  if (
    parsedInput.workspaceId.length === 0 ||
    parsedInput.repoMappingId.length === 0 ||
    parsedInput.title.length === 0 ||
    parsedInput.objective.length === 0
  ) {
    throw createActionError("validation_error");
  }

  return parsedInput;
};

const parseApproveManualTaskInput = (input: unknown): ApproveManualTaskInput => {
  assertNoUnsafeApproveManualTaskFormFields(input);

  return {
    taskId: parseBoundedStringField(input, "taskId", APPROVE_MANUAL_TASK_ID_MAX_LENGTH),
    workspaceId: parseBoundedStringField(
      input,
      "workspaceId",
      APPROVE_MANUAL_TASK_WORKSPACE_ID_MAX_LENGTH,
    ),
  };
};

const parseCreateRepoMappingInput = (input: unknown): CreateRepoMappingInput => {
  const parsedInput: CreateRepoMappingInput = {
    defaultBranch: getStringField(input, "defaultBranch"),
    localPath: getStringField(input, "localPath"),
    repositoryName: getStringField(input, "repositoryName"),
    repositoryOwner: getStringField(input, "repositoryOwner"),
    runnerId: getStringField(input, "runnerId"),
    workspaceId: getStringField(input, "workspaceId"),
  };
  const provider = getOptionalStringField(input, "provider");
  const remoteUrl = getOptionalStringField(input, "remoteUrl");
  const repositoryExternalId = getOptionalStringField(input, "repositoryExternalId");
  const githubInstallationId = getOptionalStringField(input, "githubInstallationId");

  if (
    parsedInput.workspaceId.length === 0 ||
    parsedInput.runnerId.length === 0 ||
    parsedInput.localPath.length === 0 ||
    parsedInput.repositoryOwner.length === 0 ||
    parsedInput.repositoryName.length === 0 ||
    parsedInput.defaultBranch.length === 0
  ) {
    throw createActionError("validation_error");
  }

  if (provider !== undefined) {
    parsedInput.provider = provider;
  }

  if (remoteUrl !== undefined) {
    parsedInput.remoteUrl = remoteUrl;
  }

  if (repositoryExternalId !== undefined) {
    parsedInput.repositoryExternalId = repositoryExternalId;
  }

  if (githubInstallationId !== undefined) {
    parsedInput.githubInstallationId = githubInstallationId;
  }

  return parsedInput;
};

const parseDeleteRepoMappingInput = (input: unknown): DeleteRepoMappingInput => {
  const parsedInput = {
    repoMappingId: getStringField(input, "repoMappingId"),
    workspaceId: getStringField(input, "workspaceId"),
  };

  if (parsedInput.workspaceId.length === 0 || parsedInput.repoMappingId.length === 0) {
    throw createActionError("validation_error");
  }

  return parsedInput;
};

const parseRevokeRunnerInput = (input: unknown): RevokeRunnerInput => ({
  runnerId: parseBoundedStringField(input, "runnerId", RUNNER_ID_MAX_LENGTH),
  workspaceId: parseBoundedStringField(input, "workspaceId", RUNNER_REVOKE_WORKSPACE_ID_MAX_LENGTH),
});

const createWorkspaceWithDatabase = async (
  input: CreateWorkspaceInput,
): Promise<CreateWorkspaceData> => {
  const { db } = getDatabase();
  const service = createWorkspaceMutationService({
    store: createDrizzleWorkspaceMutationStore(db),
  });

  return service.createWorkspace(input);
};

const createRunnerPairingCodeWithDatabase = async (
  input: CreateRunnerPairingCodeInput,
): Promise<CreatedRunnerPairingCodeResult> => {
  const { db } = getDatabase();
  const service = createRunnerPairingCodeService({
    store: createDrizzleRunnerPairingStore(db),
  });

  return service.createRunnerPairingCode(input);
};

const selectWorkspaceWithDatabase = async (
  input: SelectWorkspaceInput,
): Promise<SelectedWorkspaceData> => {
  const { db } = getDatabase();
  const service = createWorkspaceMutationService({
    store: createDrizzleWorkspaceMutationStore(db),
  });

  return service.selectWorkspace(input);
};

const updateWorkspaceNameWithDatabase = async (
  input: UpdateWorkspaceNameInput,
): Promise<UpdateWorkspaceNameData> => {
  const { db } = getDatabase();
  const service = createWorkspaceMutationService({
    store: createDrizzleWorkspaceMutationStore(db),
  });

  return service.updateWorkspaceName(input);
};

const cancelRunWithDatabase = async (input: CancelRunInput): Promise<CancelRunData> => {
  const { db } = getDatabase();
  const service = createCancelRunService({
    store: createDrizzleCancelRunStore(db),
  });

  return service.cancelRun(input);
};

const requestRepairWithDatabase = async (input: RequestRepairInput): Promise<RepairRequestData> => {
  const { db } = getDatabase();
  const service = createRepairRequestService({
    store: createDrizzleRepairRequestStore(db),
  });

  return service.requestRepair(input);
};

const createApprovalActionServiceWithDatabase = () => {
  const { db } = getDatabase();

  return createApprovalActionService({
    store: createDrizzleApprovalDecisionStore(db),
  });
};

const approveRunWithDatabase = async (input: ApprovalActionInput): Promise<ApprovalActionData> =>
  createApprovalActionServiceWithDatabase().approveRun(input);

const rejectRunWithDatabase = async (input: ApprovalActionInput): Promise<ApprovalActionData> =>
  createApprovalActionServiceWithDatabase().rejectRun(input);

const createRepoMappingWithDatabase = async (
  input: CreateRepoMappingInput,
): Promise<RepoMappingData> => {
  const { db } = getDatabase();
  const service = createRepoMappingService({
    store: createDrizzleRepoMappingStore(db),
  });

  return service.createRepoMapping(input);
};

const createManualTaskWithDatabase = async (
  input: CreateManualTaskInput,
): Promise<ManualTaskData> => {
  const { db } = getDatabase();
  const service = createManualTaskService({
    store: createDrizzleManualTaskStore(db),
  });

  return service.createManualTask(input);
};

const approveManualTaskWithDatabase = async (
  input: ApproveManualTaskInput,
): Promise<ApprovedManualTaskData> => {
  const { db } = getDatabase();
  const service = createApproveManualTaskService({
    store: createDrizzleApproveManualTaskStore(db),
  });

  return service.approveManualTask(input);
};

const deleteRepoMappingWithDatabase = async (
  input: DeleteRepoMappingInput,
): Promise<DeletedRepoMappingData> => {
  const { db } = getDatabase();
  const service = createRepoMappingService({
    store: createDrizzleRepoMappingStore(db),
  });

  return service.deleteRepoMapping(input);
};

const revokeRunnerWithDatabase = async (input: RevokeRunnerInput): Promise<RevokeRunnerData> => {
  const { db } = getDatabase();
  const service = createRunnerRevokeService({
    store: createDrizzleRunnerRevokeStore(db),
  });

  return service.revokeRunner(input);
};

const createRepoFindingServiceWithDatabase = () => {
  const { db } = getDatabase();

  return createRepoFindingService({
    store: createDrizzleRepoFindingStore(db),
  });
};

const toUpdateFindingStatusActionData = (
  finding: PersistedFinding,
): UpdateFindingStatusActionData => {
  if (finding.finding.status !== "dismissed" && finding.finding.status !== "deferred") {
    throw createActionError("validation_error");
  }

  return {
    findingId: finding.finding.findingId,
    status: finding.finding.status,
    taskIdCount: finding.taskIds.length,
    workspaceId: finding.finding.workspaceId,
  };
};

const updateFindingStatusWithDatabase = async (
  input: UpdateFindingStatusInput,
): Promise<UpdateFindingStatusActionData> =>
  toUpdateFindingStatusActionData(
    await createRepoFindingServiceWithDatabase().updateFindingStatus(input),
  );

const toConvertFindingToTaskActionData = (
  conversion: ConvertedFindingTask,
): ConvertFindingToTaskActionData => {
  if (conversion.task.status !== "draft" || conversion.task.approvalStatus !== "not_requested") {
    throw createActionError("validation_error");
  }

  return {
    approvalStatus: conversion.task.approvalStatus,
    findingId: conversion.finding.finding.findingId,
    repoId: conversion.task.repoId,
    status: conversion.task.status,
    taskId: conversion.task.taskId,
    workspaceId: conversion.task.workspaceId,
  };
};

const convertFindingToTaskWithDatabase = async (
  input: ConvertFindingToTaskInput,
): Promise<ConvertFindingToTaskActionData> =>
  toConvertFindingToTaskActionData(
    await createRepoFindingServiceWithDatabase().convertFindingToTask(input),
  );

const createTaskRecommendationServiceWithDatabase = () => {
  const { db } = getDatabase();

  return createTaskRecommendationService({
    store: createDrizzleTaskRecommendationStore(db),
  });
};

const toApproveTaskRecommendationActionData = (
  approval: ApprovedTaskRecommendation,
): ApproveTaskRecommendationActionData => {
  if (approval.task.status !== "draft" || approval.task.approvalStatus !== "not_requested") {
    throw createActionError("validation_error");
  }

  return {
    approvalStatus: approval.task.approvalStatus,
    repoId: approval.task.repoId,
    status: approval.task.status,
    taskId: approval.task.taskId,
    taskRecommendationId: approval.recommendation.recommendation.taskRecommendationId,
    workspaceId: approval.task.workspaceId,
  };
};

const toApproveTaskRecommendationsActionData = (
  approvals: readonly ApprovedTaskRecommendation[],
): ApproveTaskRecommendationsActionData => ({
  approvals: approvals.map(toApproveTaskRecommendationActionData),
});

const approveTaskRecommendationWithDatabase = async (
  input: ApproveTaskRecommendationInput,
): Promise<ApproveTaskRecommendationActionData> =>
  toApproveTaskRecommendationActionData(
    await createTaskRecommendationServiceWithDatabase().approveTaskRecommendation(input),
  );

const approveTaskRecommendationsWithDatabase = async (
  input: ApproveTaskRecommendationsInput,
): Promise<ApproveTaskRecommendationsActionData> =>
  toApproveTaskRecommendationsActionData(
    await createTaskRecommendationServiceWithDatabase().approveTaskRecommendations(input),
  );

const toUpdateTaskRecommendationStatusActionData = (
  recommendation: PersistedTaskRecommendation,
): UpdateTaskRecommendationStatusActionData => {
  if (
    recommendation.recommendation.status !== "ignored" &&
    recommendation.recommendation.status !== "deferred"
  ) {
    throw createActionError("validation_error");
  }

  return {
    status: recommendation.recommendation.status,
    taskRecommendationId: recommendation.recommendation.taskRecommendationId,
    workspaceId: recommendation.recommendation.workspaceId,
  };
};

const updateTaskRecommendationStatusWithDatabase = async (
  input: UpdateTaskRecommendationStatusInput,
): Promise<UpdateTaskRecommendationStatusActionData> =>
  toUpdateTaskRecommendationStatusActionData(
    await createTaskRecommendationServiceWithDatabase().updateTaskRecommendationStatus(input),
  );

const toTransitionCortexTaskStatusActionData = (
  task: CortexTask,
): TransitionCortexTaskStatusActionData => ({
  approvalStatus: task.approvalStatus,
  repoId: task.repoId,
  status: task.status,
  taskId: task.taskId,
  workspaceId: task.workspaceId,
});

const toUpdateCortexTaskExecutionModeActionData = (
  task: CortexTask,
): UpdateCortexTaskExecutionModeActionData => ({
  approvalStatus: task.approvalStatus,
  executionMode: task.executionMode,
  repoId: task.repoId,
  status: task.status,
  taskId: task.taskId,
  workspaceId: task.workspaceId,
});

const transitionCortexTaskStatusWithDatabase = async (
  input: TransitionCortexTaskStatusInput,
): Promise<TransitionCortexTaskStatusActionData> => {
  const { db } = getDatabase();

  if (input.status === "queued") {
    const service = createCortexTaskRunnerQueueService({
      store: createDrizzleCortexTaskRunnerQueueStore(db),
    });
    const queued = await service.queueApprovedCortexTask({
      taskId: input.taskId,
      workspaceId: input.workspaceId,
    });

    return {
      approvalStatus: queued.approvalStatus,
      repoId: queued.repoId,
      status: queued.status,
      taskId: queued.taskId,
      workspaceId: queued.workspaceId,
    };
  }

  const service = createCortexTaskService({
    store: createDrizzleCortexTaskStore(db),
  });

  return toTransitionCortexTaskStatusActionData(await service.transitionCortexTaskStatus(input));
};

const updateCortexTaskExecutionModeWithDatabase = async (
  input: UpdateCortexTaskExecutionModeInput,
): Promise<UpdateCortexTaskExecutionModeActionData> => {
  const { db } = getDatabase();
  const service = createCortexTaskService({
    store: createDrizzleCortexTaskStore(db),
  });

  return toUpdateCortexTaskExecutionModeActionData(
    await service.updateCortexTaskExecutionMode(input),
  );
};

const createSetupPrPreviewWithDatabase = async (
  input: CreateSetupPrPreviewInput,
): Promise<SetupPrPreview> => {
  const { db } = getDatabase();
  const service = createSetupPrPreviewService({
    store: createDrizzleSetupPrPreviewStore(db),
  });

  return service.createSetupPrPreview(input);
};

const createSetupPrGithubClient = (): Parameters<
  typeof createSetupPrCreationService
>[0]["githubClient"] =>
  createGitHubAppClient({
    request: createGitHubAppRequestFunction(),
  });

const createSetupPrFromPreviewWithDatabase = async (
  input: CreateSetupPrFromPreviewInput,
): Promise<SetupPrCreationResult> => {
  const { db } = getDatabase();
  const service = createSetupPrCreationService({
    githubClient: createSetupPrGithubClient(),
    store: createDrizzleSetupPrCreationStore(db),
  });

  return service.createSetupPrFromPreview(input);
};

const importLinearIssueCandidateWithDatabase = async (
  input: ImportLinearIssueCandidateInput,
): Promise<ImportLinearIssueCandidateActionData> => {
  const { db } = getDatabase();
  const service = createLinearIssueCandidateImportService({
    store: createDrizzleLinearIssueCandidateImportStore(db),
  });

  return service.importLinearIssueCandidate(input);
};

const syncCortexTaskToLinearWithDatabase = async (
  input: SyncCortexTaskToLinearInput,
): Promise<SyncCortexTaskToLinearActionData> => {
  const { db } = getDatabase();
  const cortexAppBaseUrl = process.env.CORTEX_APP_BASE_URL;
  const service = createLinearTaskSyncService({
    ...(cortexAppBaseUrl === undefined ? {} : { cortexAppBaseUrl }),
    store: createDrizzleLinearTaskSyncStore(db),
  });

  return service.syncCortexTaskToLinear(input);
};

const syncCortexTaskToGitHubIssueWithDatabase = async (
  input: SyncCortexTaskToGitHubIssueInput,
): Promise<SyncCortexTaskToGitHubIssueActionData> => {
  const { db } = getDatabase();
  const cortexAppBaseUrl = process.env.CORTEX_APP_BASE_URL;
  const service = createGitHubIssueSyncService({
    ...(cortexAppBaseUrl === undefined ? {} : { cortexAppBaseUrl }),
    githubClient: createGitHubAppClient({
      request: createGitHubAppRequestFunction(),
    }),
    store: createDrizzleGitHubIssueSyncStore(db),
  });

  return service.syncCortexTaskToGitHubIssue(input);
};

const triggerRepoScanWithDatabase = async (
  input: TriggerRepoScanInput,
): Promise<TriggeredRepoScan> => {
  const { db } = getDatabase();
  const service = createRepoScanService({
    store: createDrizzleRepoScanStore(db),
    usageLimitService: createBillingPlanLimitService({
      store: createDrizzleUsageEventStore(db),
    }),
  });

  return service.triggerRepoScan(input);
};

const registerPublicGitHubRepositoryWithDatabase = async (
  input: RegisterPublicGitHubRepositoryInput,
): Promise<RegisteredPublicGitHubRepository> => {
  const { db } = getDatabase();
  const service = createPublicGitHubRepositoryService({
    store: createDrizzlePublicGitHubRepositoryStore(db),
  });

  return service.registerPublicGitHubRepository(input);
};

const getRepoScanStatusWithDatabase = async (
  input: GetRepoScanStatusInput,
): Promise<RepoScanStatusSummary | null> => {
  const { db } = getDatabase();
  const service = createRepoScanService({
    store: createDrizzleRepoScanStore(db),
  });

  return service.getRepoScanStatus(input);
};

const revalidateWorkspaceSurfaces = (revalidatePath: (path: string) => void) => {
  revalidatePath("/workspaces");
  revalidatePath("/dashboard");
};

const revalidateRunSurfaces = (revalidatePath: (path: string) => void, runId: string) => {
  revalidatePath("/dashboard/runs");
  revalidatePath(`/dashboard/runs/${encodeURIComponent(runId)}`);
};

const revalidateApprovalSurfaces = (revalidatePath: (path: string) => void, runId: string) => {
  revalidateRunSurfaces(revalidatePath, runId);
  revalidatePath("/dashboard/approvals");
  revalidatePath("/dashboard/pull-requests");
  revalidatePath("/dashboard/audit-log");
  revalidatePath("/dashboard");
};

const revalidateFindingSurfaces = (revalidatePath: (path: string) => void) => {
  revalidatePath("/dashboard/findings");
  revalidatePath("/dashboard/audit-log");
  revalidatePath("/dashboard");
};

const revalidateFindingConversionSurfaces = (revalidatePath: (path: string) => void) => {
  revalidateFindingSurfaces(revalidatePath);
  revalidatePath("/dashboard/tasks");
};

const revalidateTaskRecommendationSurfaces = (revalidatePath: (path: string) => void) => {
  revalidatePath("/dashboard/task-recommendations");
  revalidatePath("/dashboard/tasks");
  revalidatePath("/dashboard/findings");
  revalidatePath("/dashboard/audit-log");
  revalidatePath("/dashboard");
};

const revalidateCortexTaskSurfaces = (revalidatePath: (path: string) => void) => {
  revalidatePath("/dashboard/tasks");
  revalidatePath("/dashboard/task-recommendations");
  revalidatePath("/dashboard/findings");
  revalidatePath("/dashboard/audit-log");
  revalidatePath("/dashboard");
};

const revalidateSetupPrPreviewSurfaces = (revalidatePath: (path: string) => void) => {
  revalidatePath("/dashboard/setup-prs");
  revalidatePath("/dashboard/tasks");
  revalidatePath("/dashboard/audit-log");
  revalidatePath("/dashboard");
};

const revalidateSetupPrCreationSurfaces = (revalidatePath: (path: string) => void) => {
  revalidatePath("/dashboard/setup-prs");
  revalidatePath("/dashboard/pull-requests");
  revalidatePath("/dashboard/audit-log");
  revalidatePath("/dashboard");
};

const revalidateLinearImportSurfaces = (revalidatePath: (path: string) => void) => {
  revalidatePath("/dashboard/tasks");
  revalidatePath("/dashboard/audit-log");
  revalidatePath("/dashboard");
};

const revalidateRepoScanSurfaces = (revalidatePath: (path: string) => void) => {
  revalidatePath("/dashboard/repositories");
  revalidatePath("/dashboard/audit-log");
  revalidatePath("/dashboard");
};

const toTriggerRepoScanActionData = (scan: TriggeredRepoScan): TriggerRepoScanActionData => ({
  repoId: scan.repoId,
  scanId: scan.scanId,
  status: scan.status,
  workspaceId: scan.workspaceId,
});

const toCreateSetupPrPreviewActionData = (
  preview: SetupPrPreview,
): CreateSetupPrPreviewActionData => {
  if (preview.status !== "draft") {
    throw createActionError("validation_error");
  }

  return {
    fileCount: preview.files.length,
    previewId: preview.previewId,
    repoId: preview.repoId,
    status: preview.status,
    taskCount: preview.taskIds.length,
    workspaceId: preview.workspaceId,
  };
};

const toCreateSetupPrFromPreviewActionData = (
  result: SetupPrCreationResult,
): CreateSetupPrFromPreviewActionData => {
  if (result.preview.status !== "pr_created") {
    throw createActionError("validation_error");
  }

  return {
    branchName: result.branchName,
    previewId: result.preview.previewId,
    pullRequestNumber: result.pullRequestNumber,
    pullRequestUrl: result.pullRequestUrl,
    repoId: result.preview.repoId,
    status: result.preview.status,
    workspaceId: result.preview.workspaceId,
  };
};

const setSelectedWorkspaceCookie = async (workspaceId: string) => {
  const cookieStore = await defaultCookies();

  cookieStore.set(SELECTED_WORKSPACE_COOKIE_NAME, workspaceId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 180,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
};

export const createCancelRunAction = (
  deps: {
    cancelRun?: (input: CancelRunInput) => Promise<CancelRunData>;
    revalidatePath?: (path: string) => void;
  } = {},
): CancelRunAction => {
  const cancelRun = deps.cancelRun ?? cancelRunWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseCancelRunInput(input);
      const data = await cancelRun(parsedInput);

      revalidateRunSurfaces(revalidatePath, data.runId);

      return data;
    });
};

export const createRequestRepairAction = (
  deps: {
    revalidatePath?: (path: string) => void;
    requestRepair?: (input: RequestRepairInput) => Promise<RepairRequestData>;
  } = {},
): RequestRepairAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const requestRepair = deps.requestRepair ?? requestRepairWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseRequestRepairInput(input);
      const data = await requestRepair(parsedInput);

      revalidateRunSurfaces(revalidatePath, data.previousRunId);
      revalidatePath("/dashboard/approvals");
      revalidatePath("/dashboard/pull-requests");
      revalidatePath(`/dashboard/runs/${encodeURIComponent(data.queuedRunId)}`);
      revalidatePath("/dashboard");

      return data;
    });
};

export const createApproveRunAction = (
  deps: {
    approveRun?: (input: ApprovalActionInput) => Promise<ApprovalActionData>;
    revalidatePath?: (path: string) => void;
  } = {},
): ApproveRunAction => {
  const approveRun = deps.approveRun ?? approveRunWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseApprovalActionInput(input);
      const data = await approveRun(parsedInput);

      revalidateApprovalSurfaces(revalidatePath, data.runId);

      return data;
    });
};

export const createRejectRunAction = (
  deps: {
    rejectRun?: (input: ApprovalActionInput) => Promise<ApprovalActionData>;
    revalidatePath?: (path: string) => void;
  } = {},
): RejectRunAction => {
  const rejectRun = deps.rejectRun ?? rejectRunWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseApprovalActionInput(input);
      const data = await rejectRun(parsedInput);

      revalidateApprovalSurfaces(revalidatePath, data.runId);

      return data;
    });
};

export const createUpdateFindingStatusAction = (
  deps: {
    revalidatePath?: (path: string) => void;
    updateFindingStatus?: (
      input: UpdateFindingStatusInput,
    ) => Promise<UpdateFindingStatusActionData>;
  } = {},
): UpdateFindingStatusAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const updateFindingStatus = deps.updateFindingStatus ?? updateFindingStatusWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseUpdateFindingStatusInput(input);
      const data = await updateFindingStatus(parsedInput);

      revalidateFindingSurfaces(revalidatePath);

      return data;
    });
};

export const createConvertFindingToTaskAction = (
  deps: {
    convertFindingToTask?: (
      input: ConvertFindingToTaskInput,
    ) => Promise<ConvertFindingToTaskActionData>;
    revalidatePath?: (path: string) => void;
  } = {},
): ConvertFindingToTaskAction => {
  const convertFindingToTask = deps.convertFindingToTask ?? convertFindingToTaskWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseConvertFindingToTaskInput(input);
      const data = await convertFindingToTask(parsedInput);

      revalidateFindingConversionSurfaces(revalidatePath);

      return data;
    });
};

export const createApproveTaskRecommendationAction = (
  deps: {
    approveTaskRecommendation?: (
      input: ApproveTaskRecommendationInput,
    ) => Promise<ApproveTaskRecommendationActionData>;
    revalidatePath?: (path: string) => void;
  } = {},
): ApproveTaskRecommendationAction => {
  const approveTaskRecommendation =
    deps.approveTaskRecommendation ?? approveTaskRecommendationWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseApproveTaskRecommendationInput(input);
      const data = await approveTaskRecommendation(parsedInput);

      revalidateTaskRecommendationSurfaces(revalidatePath);

      return data;
    });
};

export const createApproveTaskRecommendationsAction = (
  deps: {
    approveTaskRecommendations?: (
      input: ApproveTaskRecommendationsInput,
    ) => Promise<ApproveTaskRecommendationsActionData>;
    revalidatePath?: (path: string) => void;
  } = {},
): ApproveTaskRecommendationsAction => {
  const approveTaskRecommendations =
    deps.approveTaskRecommendations ?? approveTaskRecommendationsWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseApproveTaskRecommendationsInput(input);
      const data = await approveTaskRecommendations(parsedInput);

      revalidateTaskRecommendationSurfaces(revalidatePath);

      return data;
    });
};

export const createUpdateTaskRecommendationStatusAction = (
  deps: {
    revalidatePath?: (path: string) => void;
    updateTaskRecommendationStatus?: (
      input: UpdateTaskRecommendationStatusInput,
    ) => Promise<UpdateTaskRecommendationStatusActionData>;
  } = {},
): UpdateTaskRecommendationStatusAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const updateTaskRecommendationStatus =
    deps.updateTaskRecommendationStatus ?? updateTaskRecommendationStatusWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseUpdateTaskRecommendationStatusInput(input);
      const data = await updateTaskRecommendationStatus(parsedInput);

      revalidateTaskRecommendationSurfaces(revalidatePath);

      return data;
    });
};

export const createTransitionCortexTaskStatusAction = (
  deps: {
    revalidatePath?: (path: string) => void;
    transitionCortexTaskStatus?: (
      input: TransitionCortexTaskStatusInput,
    ) => Promise<TransitionCortexTaskStatusActionData>;
  } = {},
): TransitionCortexTaskStatusAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const transitionCortexTaskStatus =
    deps.transitionCortexTaskStatus ?? transitionCortexTaskStatusWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseTransitionCortexTaskStatusInput(input);
      const data = await transitionCortexTaskStatus(parsedInput);

      revalidateCortexTaskSurfaces(revalidatePath);

      return data;
    });
};

export const createUpdateCortexTaskExecutionModeAction = (
  deps: {
    revalidatePath?: (path: string) => void;
    updateCortexTaskExecutionMode?: (
      input: UpdateCortexTaskExecutionModeInput,
    ) => Promise<UpdateCortexTaskExecutionModeActionData>;
  } = {},
): UpdateCortexTaskExecutionModeAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const updateCortexTaskExecutionMode =
    deps.updateCortexTaskExecutionMode ?? updateCortexTaskExecutionModeWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseUpdateCortexTaskExecutionModeInput(input);
      const data = await updateCortexTaskExecutionMode(parsedInput);

      revalidateCortexTaskSurfaces(revalidatePath);

      return data;
    });
};

export const createCreateSetupPrPreviewAction = (
  deps: {
    createSetupPrPreview?: (input: CreateSetupPrPreviewInput) => Promise<SetupPrPreview>;
    revalidatePath?: (path: string) => void;
  } = {},
): CreateSetupPrPreviewAction => {
  const createSetupPrPreview = deps.createSetupPrPreview ?? createSetupPrPreviewWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseCreateSetupPrPreviewInput(input);
      const data = await createSetupPrPreview(parsedInput);

      revalidateSetupPrPreviewSurfaces(revalidatePath);

      return toCreateSetupPrPreviewActionData(data);
    });
};

export const createCreateSetupPrFromPreviewAction = (
  deps: {
    createSetupPrFromPreview?: (
      input: CreateSetupPrFromPreviewInput,
    ) => Promise<SetupPrCreationResult>;
    revalidatePath?: (path: string) => void;
  } = {},
): CreateSetupPrFromPreviewAction => {
  const createSetupPrFromPreview =
    deps.createSetupPrFromPreview ?? createSetupPrFromPreviewWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseCreateSetupPrFromPreviewInput(input);
      const data = await createSetupPrFromPreview(parsedInput);

      revalidateSetupPrCreationSurfaces(revalidatePath);

      return toCreateSetupPrFromPreviewActionData(data);
    });
};

export const createImportLinearIssueCandidateAction = (
  deps: {
    importLinearIssueCandidate?: (
      input: ImportLinearIssueCandidateInput,
    ) => Promise<ImportLinearIssueCandidateActionData>;
    revalidatePath?: (path: string) => void;
  } = {},
): ImportLinearIssueCandidateAction => {
  const importLinearIssueCandidate =
    deps.importLinearIssueCandidate ?? importLinearIssueCandidateWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseImportLinearIssueCandidateInput(input);
      const data = await importLinearIssueCandidate(parsedInput);

      revalidateLinearImportSurfaces(revalidatePath);

      return data;
    });
};

export const createSyncCortexTaskToLinearAction = (
  deps: {
    revalidatePath?: (path: string) => void;
    syncCortexTaskToLinear?: (
      input: SyncCortexTaskToLinearInput,
    ) => Promise<SyncCortexTaskToLinearActionData>;
  } = {},
): SyncCortexTaskToLinearAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const syncCortexTaskToLinear = deps.syncCortexTaskToLinear ?? syncCortexTaskToLinearWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseSyncCortexTaskToLinearInput(input);
      const data = await syncCortexTaskToLinear(parsedInput);

      revalidateLinearImportSurfaces(revalidatePath);

      return data;
    });
};

export const createSyncCortexTaskToGitHubIssueAction = (
  deps: {
    revalidatePath?: (path: string) => void;
    syncCortexTaskToGitHubIssue?: (
      input: SyncCortexTaskToGitHubIssueInput,
    ) => Promise<SyncCortexTaskToGitHubIssueActionData>;
  } = {},
): SyncCortexTaskToGitHubIssueAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const syncCortexTaskToGitHubIssue =
    deps.syncCortexTaskToGitHubIssue ?? syncCortexTaskToGitHubIssueWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseSyncCortexTaskToGitHubIssueInput(input);
      const data = await syncCortexTaskToGitHubIssue(parsedInput);

      revalidateLinearImportSurfaces(revalidatePath);

      return data;
    });
};

export const createTriggerRepoScanAction = (
  deps: {
    revalidatePath?: (path: string) => void;
    triggerRepoScan?: (input: TriggerRepoScanInput) => Promise<TriggeredRepoScan>;
  } = {},
): TriggerRepoScanAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const triggerRepoScan = deps.triggerRepoScan ?? triggerRepoScanWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseTriggerRepoScanInput(input);
      const data = await triggerRepoScan(parsedInput);

      revalidateRepoScanSurfaces(revalidatePath);

      return toTriggerRepoScanActionData(data);
    });
};

export const createTriggerPublicRepoScanAction = (
  deps: {
    registerPublicGitHubRepository?: (
      input: RegisterPublicGitHubRepositoryInput,
    ) => Promise<RegisteredPublicGitHubRepository>;
    revalidatePath?: (path: string) => void;
    triggerRepoScan?: (input: TriggerRepoScanInput) => Promise<TriggeredRepoScan>;
  } = {},
): TriggerPublicRepoScanAction => {
  const registerPublicGitHubRepository =
    deps.registerPublicGitHubRepository ?? registerPublicGitHubRepositoryWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const triggerRepoScan = deps.triggerRepoScan ?? triggerRepoScanWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseTriggerPublicRepoScanInput(input);
      const repository = await registerPublicGitHubRepository({
        repositoryUrl: parsedInput.repositoryUrl,
        workspaceId: parsedInput.workspaceId,
      });
      const data = await triggerRepoScan({
        ...(parsedInput.productGoal === undefined ? {} : { productGoal: parsedInput.productGoal }),
        repoId: repository.repoId,
        workspaceId: parsedInput.workspaceId,
      });

      revalidateRepoScanSurfaces(revalidatePath);

      return toTriggerRepoScanActionData(data);
    });
};

export const createGetRepoScanStatusAction = (
  deps: {
    getRepoScanStatus?: (input: GetRepoScanStatusInput) => Promise<RepoScanStatusSummary | null>;
  } = {},
): GetRepoScanStatusAction => {
  const getRepoScanStatus = deps.getRepoScanStatus ?? getRepoScanStatusWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseGetRepoScanStatusInput(input);

      return getRepoScanStatus(parsedInput);
    });
};

export const createCreateWorkspaceAction = (
  deps: {
    createWorkspace?: (input: CreateWorkspaceInput) => Promise<CreateWorkspaceData>;
    revalidatePath?: (path: string) => void;
  } = {},
): CreateWorkspaceAction => {
  const createWorkspace = deps.createWorkspace ?? createWorkspaceWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseCreateWorkspaceInput(input);
      const data = await createWorkspace(parsedInput);

      revalidateWorkspaceSurfaces(revalidatePath);

      return data;
    });
};

export const createCreateRunnerPairingCodeAction = (
  deps: {
    createRunnerPairingCode?: (
      input: CreateRunnerPairingCodeInput,
    ) => Promise<CreatedRunnerPairingCodeResult>;
    revalidatePath?: (path: string) => void;
  } = {},
): CreateRunnerPairingCodeAction => {
  const createRunnerPairingCode =
    deps.createRunnerPairingCode ?? createRunnerPairingCodeWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (_previousState: CreateRunnerPairingCodeActionState, input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseCreateRunnerPairingCodeInput(input);
      const data = await createRunnerPairingCode(parsedInput);

      revalidatePath("/dashboard/runners");

      return data;
    });
};

export const createRevokeRunnerAction = (
  deps: {
    revalidatePath?: (path: string) => void;
    revokeRunner?: (input: RevokeRunnerInput) => Promise<RevokeRunnerData>;
  } = {},
): RevokeRunnerAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const revokeRunner = deps.revokeRunner ?? revokeRunnerWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseRevokeRunnerInput(input);
      const data = await revokeRunner(parsedInput);

      revalidatePath("/dashboard/runners");

      return data;
    });
};

export const createSelectWorkspaceAction = (
  deps: {
    revalidatePath?: (path: string) => void;
    selectWorkspace?: (input: SelectWorkspaceInput) => Promise<SelectedWorkspaceData>;
    setSelectedWorkspaceId?: (workspaceId: string) => Promise<void> | void;
  } = {},
): SelectWorkspaceAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const selectWorkspace = deps.selectWorkspace ?? selectWorkspaceWithDatabase;
  const setSelectedWorkspaceId = deps.setSelectedWorkspaceId ?? setSelectedWorkspaceCookie;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseSelectWorkspaceInput(input);
      const data = await selectWorkspace(parsedInput);

      await setSelectedWorkspaceId(data.workspaceId);
      revalidateWorkspaceSurfaces(revalidatePath);

      return data;
    });
};

export const createUpdateWorkspaceNameAction = (
  deps: {
    revalidatePath?: (path: string) => void;
    updateWorkspaceName?: (input: UpdateWorkspaceNameInput) => Promise<UpdateWorkspaceNameData>;
  } = {},
): UpdateWorkspaceNameAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const updateWorkspaceName = deps.updateWorkspaceName ?? updateWorkspaceNameWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseUpdateWorkspaceNameInput(input);
      const data = await updateWorkspaceName(parsedInput);

      revalidatePath("/dashboard/settings");

      return data;
    });
};

export const createCreateRepoMappingAction = (
  deps: {
    createRepoMapping?: (input: CreateRepoMappingInput) => Promise<RepoMappingData>;
    revalidatePath?: (path: string) => void;
  } = {},
): CreateRepoMappingAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const createRepoMapping = deps.createRepoMapping ?? createRepoMappingWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseCreateRepoMappingInput(input);
      const data = await createRepoMapping(parsedInput);

      revalidatePath("/dashboard/repositories");

      return data;
    });
};

export const createApproveManualTaskAction = (
  deps: {
    approveManualTask?: (input: ApproveManualTaskInput) => Promise<ApprovedManualTaskData>;
    revalidatePath?: (path: string) => void;
  } = {},
): ApproveManualTaskAction => {
  const approveManualTask = deps.approveManualTask ?? approveManualTaskWithDatabase;
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseApproveManualTaskInput(input);
      const data = await approveManualTask(parsedInput);

      revalidatePath("/dashboard/tasks");
      revalidatePath("/dashboard/runs");
      revalidatePath("/dashboard");

      return data;
    });
};

const toCreatedManualTaskActionData = (task: ManualTaskData): CreatedManualTaskActionData => ({
  acceptanceCriteriaCount: task.acceptanceCriteria.length,
  contextFilePathCount: task.contextFilePaths.length,
  id: task.id,
  mode: task.mode,
  repoMappingId: task.repoMappingId,
  status: task.status,
  workspaceId: task.workspaceId,
});

export const createCreateManualTaskAction = (
  deps: {
    createManualTask?: (input: CreateManualTaskInput) => Promise<ManualTaskData>;
    revalidatePath?: (path: string) => void;
  } = {},
): CreateManualTaskAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const createManualTask = deps.createManualTask ?? createManualTaskWithDatabase;

  return async (_previousState: CreateManualTaskActionState, input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseCreateManualTaskInput(input);
      const data = await createManualTask(parsedInput);

      revalidatePath("/dashboard/tasks");
      revalidatePath("/dashboard/tasks/new");

      return toCreatedManualTaskActionData(data);
    });
};

export const createDeleteRepoMappingAction = (
  deps: {
    deleteRepoMapping?: (input: DeleteRepoMappingInput) => Promise<DeletedRepoMappingData>;
    revalidatePath?: (path: string) => void;
  } = {},
): DeleteRepoMappingAction => {
  const revalidatePath = deps.revalidatePath ?? defaultRevalidatePath;
  const deleteRepoMapping = deps.deleteRepoMapping ?? deleteRepoMappingWithDatabase;

  return async (input: unknown) =>
    runServerAction(async () => {
      const parsedInput = parseDeleteRepoMappingInput(input);
      const data = await deleteRepoMapping(parsedInput);

      revalidatePath("/dashboard/repositories");

      return data;
    });
};
