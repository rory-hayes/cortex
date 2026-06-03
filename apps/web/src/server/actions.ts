"use server";

import "server-only";

import {
  createApproveManualTaskAction,
  createApproveTaskRecommendationAction,
  createApproveTaskRecommendationsAction,
  createApproveRunAction,
  createCancelRunAction,
  createConvertFindingToTaskAction,
  createCreateManualTaskAction,
  createCreateRepoMappingAction,
  createCreateRunnerPairingCodeAction,
  createCreateSetupPrFromPreviewAction,
  createCreateSetupPrPreviewAction,
  createCreateWorkspaceAction,
  createDeleteRepoMappingAction,
  createGetRepoScanStatusAction,
  createImportLinearIssueCandidateAction,
  createRequestRepairAction,
  createRevokeRunnerAction,
  createRejectRunAction,
  createSelectWorkspaceAction,
  createSyncCortexTaskToGitHubIssueAction,
  createSyncCortexTaskToLinearAction,
  createTransitionCortexTaskStatusAction,
  createTriggerRepoScanAction,
  createUpdateCortexTaskExecutionModeAction,
  createUpdateFindingStatusAction,
  createUpdateTaskRecommendationStatusAction,
  createUpdateWorkspaceNameAction,
  type CreateManualTaskActionState,
  type CreateRunnerPairingCodeActionState,
} from "./action-factories";

export type { CreateManualTaskActionState } from "./action-factories";

const cancelRun = createCancelRunAction();
const convertFindingToTask = createConvertFindingToTaskAction();
const importLinearIssueCandidate = createImportLinearIssueCandidateAction();
const requestRepair = createRequestRepairAction();
const approveManualTask = createApproveManualTaskAction();
const approveTaskRecommendation = createApproveTaskRecommendationAction();
const approveTaskRecommendations = createApproveTaskRecommendationsAction();
const approveRun = createApproveRunAction();
const createManualTask = createCreateManualTaskAction();
const createRepoMapping = createCreateRepoMappingAction();
const createRunnerPairingCode = createCreateRunnerPairingCodeAction();
const createSetupPrFromPreview = createCreateSetupPrFromPreviewAction();
const createSetupPrPreview = createCreateSetupPrPreviewAction();
const createWorkspace = createCreateWorkspaceAction();
const deleteRepoMapping = createDeleteRepoMappingAction();
const getRepoScanStatus = createGetRepoScanStatusAction();
const revokeRunner = createRevokeRunnerAction();
const rejectRun = createRejectRunAction();
const selectWorkspace = createSelectWorkspaceAction();
const syncCortexTaskToGitHubIssue = createSyncCortexTaskToGitHubIssueAction();
const syncCortexTaskToLinear = createSyncCortexTaskToLinearAction();
const transitionCortexTaskStatus = createTransitionCortexTaskStatusAction();
const triggerRepoScan = createTriggerRepoScanAction();
const updateCortexTaskExecutionMode = createUpdateCortexTaskExecutionModeAction();
const updateFindingStatus = createUpdateFindingStatusAction();
const updateTaskRecommendationStatus = createUpdateTaskRecommendationStatusAction();
const updateWorkspaceName = createUpdateWorkspaceNameAction();

export async function cancelRunAction(input: unknown) {
  return cancelRun(input);
}

export async function convertFindingToTaskAction(input: unknown) {
  return convertFindingToTask(input);
}

export async function importLinearIssueCandidateAction(input: unknown) {
  return importLinearIssueCandidate(input);
}

export async function requestRepairAction(input: unknown) {
  return requestRepair(input);
}

export async function approveManualTaskAction(input: unknown) {
  return approveManualTask(input);
}

export async function approveTaskRecommendationAction(input: unknown) {
  return approveTaskRecommendation(input);
}

export async function approveTaskRecommendationsAction(input: unknown) {
  return approveTaskRecommendations(input);
}

export async function approveRunAction(input: unknown) {
  return approveRun(input);
}

export async function createRunnerPairingCodeAction(
  previousState: CreateRunnerPairingCodeActionState,
  input: unknown,
) {
  return createRunnerPairingCode(previousState, input);
}

export async function createManualTaskAction(
  previousState: CreateManualTaskActionState,
  input: unknown,
) {
  return createManualTask(previousState, input);
}

export async function createWorkspaceAction(input: unknown) {
  return createWorkspace(input);
}

export async function createSetupPrPreviewAction(input: unknown) {
  return createSetupPrPreview(input);
}

export async function createSetupPrFromPreviewAction(input: unknown) {
  return createSetupPrFromPreview(input);
}

export async function createRepoMappingAction(input: unknown) {
  return createRepoMapping(input);
}

export async function deleteRepoMappingAction(input: unknown) {
  return deleteRepoMapping(input);
}

export async function getRepoScanStatusAction(input: unknown) {
  return getRepoScanStatus(input);
}

export async function revokeRunnerAction(input: unknown) {
  return revokeRunner(input);
}

export async function rejectRunAction(input: unknown) {
  return rejectRun(input);
}

export async function selectWorkspaceAction(input: unknown) {
  return selectWorkspace(input);
}

export async function syncCortexTaskToLinearAction(input: unknown) {
  return syncCortexTaskToLinear(input);
}

export async function syncCortexTaskToGitHubIssueAction(input: unknown) {
  return syncCortexTaskToGitHubIssue(input);
}

export async function transitionCortexTaskStatusAction(input: unknown) {
  return transitionCortexTaskStatus(input);
}

export async function updateCortexTaskExecutionModeAction(input: unknown) {
  return updateCortexTaskExecutionMode(input);
}

export async function triggerRepoScanAction(input: unknown) {
  return triggerRepoScan(input);
}

export async function updateFindingStatusAction(input: unknown) {
  return updateFindingStatus(input);
}

export async function updateTaskRecommendationStatusAction(input: unknown) {
  return updateTaskRecommendationStatus(input);
}

export async function updateWorkspaceNameAction(input: unknown) {
  return updateWorkspaceName(input);
}
