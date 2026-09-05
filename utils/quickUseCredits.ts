import {
  estimateCredits,
  estimateFalImageCredits,
  estimateMjImageCredits,
  estimateVideoCredits,
  type Resolution,
} from '../context/StoreContext';
import type { QuickUseInputValues } from '../components/template/TemplateExperienceModal';
import type { TemplateQuickUseCreditStep } from './templateDetailApi';
import type { QuickUseBlockDefinition } from '../workflows/quickUseTypes';

const asNumber = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);
const asString = (value: unknown, fallback = ''): string => (
  typeof value === 'string' ? value : fallback
);
const asBoolean = (value: unknown, fallback: boolean): boolean => (
  typeof value === 'boolean' ? value : fallback
);

const applyQuickUseSettings = (
  step: TemplateQuickUseCreditStep,
  values: QuickUseInputValues,
): Record<string, unknown> => {
  const parameters = { ...step.parameters };
  const prefix = `quick-use:setting:${encodeURIComponent(step.id)}:`;
  Object.entries(values).forEach(([candidateId, value]) => {
    if (!candidateId.startsWith(prefix) || value instanceof File || value == null) return;
    parameters[decodeURIComponent(candidateId.slice(prefix.length))] = value;
  });
  return parameters;
};

const countImageInputs = (step: TemplateQuickUseCreditStep, values: QuickUseInputValues): number => (
  step.imageInputs.filter((input) => {
    if (input.hasDefault) return true;
    const candidateId = `quick-use:input:${encodeURIComponent(step.id)}:${encodeURIComponent(input.slot)}`;
    return values[candidateId] instanceof File;
  }).length
);

const estimateStepCredits = (step: TemplateQuickUseCreditStep, values: QuickUseInputValues): number => {
  const parameters = applyQuickUseSettings(step, values);
  const outputCount = Math.max(1, Math.floor(asNumber(parameters.outputCount, 1)));
  const inputImageCount = countImageInputs(step, values);
  if (step.capability === 'image.text_to_image') {
    if (asString(parameters.model, 'gpt-image-2') === 'mj-v8.1') {
      return estimateMjImageCredits(asString(parameters.quality) === 'hd' ? 'hd' : 'standard');
    }
    return estimateFalImageCredits({ mode: inputImageCount > 0 ? 'edit' : 'text', resolution: asString(parameters.resolution, '1K') as Resolution, aspectRatio: asString(parameters.ratio, '1:1'), imageCount: outputCount, quality: 'medium', inputImageCount: Math.min(2, inputImageCount) });
  }
  if (step.capability === 'image.replace_product' || step.capability === 'image.modify') {
    return estimateFalImageCredits({ mode: 'edit', resolution: '1K', aspectRatio: 'auto', imageCount: outputCount, quality: 'medium', inputImageCount: Math.min(2, Math.max(1, inputImageCount)) });
  }
  if (step.capability === 'image.change_ratio' || step.capability === 'image.enhance') return estimateCredits('1K', outputCount);
  if (step.capability === 'image.upscale') return estimateCredits(asString(parameters.resolution, '2K') as Resolution, 1);
  if (step.capability === 'video.image_to_video') return estimateVideoCredits({ mode: 'image_to_video', duration: asNumber(parameters.duration, 3), resolution: asString(parameters.resolution, '720p') === '1080p' ? '1080p' : '720p', generateAudio: asBoolean(parameters.generateAudio, true) });
  if (step.capability === 'video.motion_control') return estimateVideoCredits({ mode: 'motion_control', duration: asNumber(parameters.duration, 5), resolution: asString(parameters.resolution, '720p') === '1080p' ? '1080p' : '720p' });
  if (step.capability === 'video.lip_sync_image' || step.capability === 'video.lip_sync_video') return estimateVideoCredits({ mode: 'lip_sync', duration: asNumber(parameters.duration, 5), lipSyncInput: step.capability === 'video.lip_sync_image' ? 'image' : 'video' });
  if (step.capability === 'audio.text_to_speech') {
    return Math.max(1, Math.ceil((asString(parameters.text).length / 1000) * 0.1 * 195));
  }
  return 0;
};

// ---------------------------------------------------------------------------
// Reuse-aware estimation
// ---------------------------------------------------------------------------

export interface QuickUseCreditEstimateInput {
  steps: TemplateQuickUseCreditStep[];
  /** Exposed blocks from the published Quick Use definition. */
  blocks: QuickUseBlockDefinition[];
  values: QuickUseInputValues;
  /** False when the template's admin turned step reuse off. */
  reuseEnabled: boolean;
}

export interface QuickUseCreditEstimate {
  total: number;
  /** Steps that will call a provider and be charged. */
  generatedStepIds: string[];
  /** Steps that will serve the template's own result for free. */
  reusedStepIds: string[];
}

/**
 * Every candidate id carries its step id in the third segment
 * (`quick-use:<kind>:<stepId>:...`), so a block can be attributed to a step
 * without shipping a second lookup table to the browser.
 */
const stepIdFromCandidateId = (candidateId: string): string | null => {
  const parts = candidateId.split(':');
  if (parts.length < 3 || parts[0] !== 'quick-use') return null;
  try {
    return decodeURIComponent(parts[2]) || null;
  } catch {
    return parts[2] || null;
  }
};

/** Mirrors the modal's own initial value, so an untouched form reads as unchanged. */
const blockDefaultValue = (block: QuickUseBlockDefinition): unknown =>
  block.defaultValue ?? (block.control === 'toggle' ? false : null);

const isBlockModified = (
  block: QuickUseBlockDefinition,
  value: unknown,
): boolean => {
  if (value instanceof File) return true;
  if (value === undefined) return false;
  return value !== blockDefaultValue(block);
};

/**
 * Prices a Quick Use run the way it will actually be charged.
 *
 * A step is quoted only when it will really run. That means the default form
 * costs nothing on a template whose shots can all be reused, and each edit adds
 * its own step plus everything downstream of it — because breaking the material
 * chain forces the later shots to be regenerated too.
 *
 * A step carrying a required block is always quoted: the user cannot submit
 * without filling it in, so that step is going to run whatever else happens.
 * That is what keeps the button from reading 0 on a template that will
 * certainly charge.
 *
 * The quote can only ever be equal to or higher than the real charge, never
 * lower.
 */
export const estimateQuickUseCreditsDetailed = (
  input: QuickUseCreditEstimateInput,
): QuickUseCreditEstimate => {
  const { blocks, reuseEnabled, steps, values } = input;

  const blocksByStepId = new Map<string, QuickUseBlockDefinition[]>();
  blocks.forEach((block) => {
    const stepId = stepIdFromCandidateId(block.candidateId);
    if (!stepId) return;
    const bucket = blocksByStepId.get(stepId);
    if (bucket) bucket.push(block);
    else blocksByStepId.set(stepId, [block]);
  });

  const generating = new Set<string>();
  // Workflow order matters: a step can only inherit "must regenerate" from a
  // step decided before it.
  steps.forEach((step) => {
    const stepBlocks = blocksByStepId.get(step.id) || [];
    const generationBlocks = stepBlocks.filter((block) => !block.candidateId.startsWith('timeline-choice:'));
    const hasRequiredBlock = generationBlocks.some((block) => block.required);
    const wasEdited = generationBlocks.some((block) => isBlockModified(block, values[block.candidateId]));
    const upstreamRegenerates = (step.dependsOnStepIds || []).some((id) => generating.has(id));
    // hasTemplateResult is undefined on a server that predates this feature.
    // Treating that as "no demo result" quotes the full price, which is the
    // safe direction.
    // Older published detail payloads did not include hasTemplateResult. A
    // missing flag must not turn a no-op form into a paid quote; the executor
    // still verifies the actual saved asset before it can reuse anything.
    const canReuse = reuseEnabled && step.hasTemplateResult !== false;

    if (!canReuse || hasRequiredBlock || wasEdited || upstreamRegenerates) {
      generating.add(step.id);
    }
  });

  const total = steps.reduce(
    (sum, step) => sum + (generating.has(step.id) ? estimateStepCredits(step, values) : 0),
    0,
  );

  return {
    total,
    generatedStepIds: steps.filter((step) => generating.has(step.id)).map((step) => step.id),
    reusedStepIds: steps.filter((step) => !generating.has(step.id)).map((step) => step.id),
  };
};

export const estimateQuickUseCredits = (
  input: QuickUseCreditEstimateInput,
): number => estimateQuickUseCreditsDetailed(input).total;
