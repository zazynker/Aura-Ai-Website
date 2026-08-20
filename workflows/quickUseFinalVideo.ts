import type {
  QuickUseDefinition,
  QuickUseFinalVideoDefinition,
} from './quickUseTypes';

/**
 * Minimum number of clips that makes a merge meaningful. A single included
 * clip is already the deliverable, so the run skips assembly entirely and no
 * provider call is made.
 */
export const QUICK_USE_FINAL_VIDEO_MIN_CLIPS = 2 as const;

/** Hard ceiling mirroring WORKFLOW_MAX_STEPS. Keeps the merge request bounded. */
export const QUICK_USE_FINAL_VIDEO_MAX_CLIPS = 8 as const;

/**
 * Structural shape shared by WorkflowStep and QuickUseExecutionStep. Both the
 * authoring surface and the compiled execution plan can be inspected with the
 * same helpers, so eligibility is decided identically in Builder and at run
 * time.
 */
export interface FinalVideoStepLike {
  id: string;
  order: number;
  title?: string;
  output: { assetType: 'image' | 'video' };
}

export interface FinalVideoWorkflowLike {
  steps: FinalVideoStepLike[];
}

export function createDefaultFinalVideoDefinition(): QuickUseFinalVideoDefinition {
  return { enabled: false, stepIds: [], transition: 'none' };
}

/** Only a video-producing step can contribute a clip to the final cut. */
export function isFinalVideoEligibleStep(step: FinalVideoStepLike): boolean {
  return step.output.assetType === 'video';
}

export function listFinalVideoEligibleSteps(
  workflow: FinalVideoWorkflowLike,
): FinalVideoStepLike[] {
  return [...workflow.steps]
    .filter(isFinalVideoEligibleStep)
    .sort((left, right) => left.order - right.order);
}

export function isStepIncludedInFinalVideo(
  definition: QuickUseDefinition,
  stepId: string,
): boolean {
  return Boolean(definition.finalVideo?.enabled)
    && (definition.finalVideo?.stepIds || []).includes(stepId);
}

/**
 * Toggles one step's membership. Membership is stored as authored step ids so
 * reordering steps in Builder never silently changes the final cut, and the
 * stored order is normalized to workflow order on every write.
 */
export function setStepIncludedInFinalVideo(
  definition: QuickUseDefinition,
  workflow: FinalVideoWorkflowLike,
  stepId: string,
  included: boolean,
): QuickUseDefinition {
  const eligible = listFinalVideoEligibleSteps(workflow);
  if (included && !eligible.some((step) => step.id === stepId)) {
    throw new Error('Only a video step can be added to the final video.');
  }
  const current = definition.finalVideo || createDefaultFinalVideoDefinition();
  const nextIds = new Set(current.stepIds);
  if (included) nextIds.add(stepId);
  else nextIds.delete(stepId);
  const orderedIds = eligible
    .filter((step) => nextIds.has(step.id))
    .map((step) => step.id);
  return {
    ...definition,
    finalVideo: {
      ...current,
      enabled: current.enabled || orderedIds.length >= QUICK_USE_FINAL_VIDEO_MIN_CLIPS,
      stepIds: orderedIds,
    },
  };
}

export function setFinalVideoEnabled(
  definition: QuickUseDefinition,
  enabled: boolean,
): QuickUseDefinition {
  const current = definition.finalVideo || createDefaultFinalVideoDefinition();
  return { ...definition, finalVideo: { ...current, enabled } };
}

/**
 * Drops step ids that no longer exist or no longer produce video. Called after
 * the workflow draft changes so a stale membership can never reach a published
 * version.
 */
export function pruneFinalVideoDefinition(
  definition: QuickUseDefinition,
  workflow: FinalVideoWorkflowLike,
): QuickUseDefinition {
  if (!definition.finalVideo) return definition;
  const eligibleIds = listFinalVideoEligibleSteps(workflow).map((step) => step.id);
  const stepIds = eligibleIds.filter((id) => definition.finalVideo!.stepIds.includes(id));
  if (
    stepIds.length === definition.finalVideo.stepIds.length
    && stepIds.every((id, index) => definition.finalVideo!.stepIds[index] === id)
  ) {
    return definition;
  }
  return { ...definition, finalVideo: { ...definition.finalVideo, stepIds } };
}

/**
 * The authoritative run-time selection: included, still eligible, in workflow
 * order. Returns an empty list when assembly must not happen, so callers only
 * need to check `length`.
 */
export function selectFinalVideoStepIds(
  workflow: FinalVideoWorkflowLike,
  definition: QuickUseDefinition,
): string[] {
  if (!definition.finalVideo?.enabled) return [];
  const included = new Set(definition.finalVideo.stepIds);
  const selected = listFinalVideoEligibleSteps(workflow)
    .filter((step) => included.has(step.id))
    .map((step) => step.id);
  if (selected.length < QUICK_USE_FINAL_VIDEO_MIN_CLIPS) return [];
  return selected.slice(0, QUICK_USE_FINAL_VIDEO_MAX_CLIPS);
}

export function shouldAssembleFinalVideo(
  workflow: FinalVideoWorkflowLike,
  definition: QuickUseDefinition,
): boolean {
  return selectFinalVideoStepIds(workflow, definition).length
    >= QUICK_USE_FINAL_VIDEO_MIN_CLIPS;
}
