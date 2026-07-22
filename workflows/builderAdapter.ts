import { getWorkflowCapability } from './registry';
import { WORKFLOW_SCHEMA_VERSION } from './schema';
import type {
  JsonObject,
  WorkflowCapabilityKey,
  WorkflowDefinition,
  WorkflowInputBinding,
  WorkflowInputSource,
  WorkflowValidationResult,
} from './types';
import { validateWorkflowDefinition } from './validators';

export type BuilderFeatureType =
  | 'Text to Image'
  | 'Replace Product'
  | 'Modify Image'
  | 'Image to Video'
  | 'Motion Control'
  | 'Image Lip Sync'
  | 'Video Lip Sync';

export interface BuilderMaterial {
  id: string;
  type: 'Image' | 'Video' | 'Audio';
  url: string | null;
  allowDownload: boolean;
  templateAssetId?: string;
  sourceGenerationId?: string;
}

export interface BuilderInputSelection {
  slot: string;
  assetType: 'image' | 'video' | 'audio';
  source: WorkflowInputSource;
  required: boolean;
  fromStepId?: string;
  outputKey?: string;
  templateAssetId?: string;
}

export interface BuilderDraftStep {
  id: string;
  feature: BuilderFeatureType;
  resultUrl: string | null;
  resultType?: 'image' | 'video';
  materials: BuilderMaterial[];
  prompt: string;
  resultGenerationId?: string;
  videoParams?: {
    duration: string;
    resolution: string;
    generateAudio?: boolean;
  };
  imageParams?: {
    ratio: string;
    resolution: string;
  };
  inputBindings?: BuilderInputSelection[];
}

export interface BuilderWorkflowConversionResult {
  workflow: WorkflowDefinition;
  validation: WorkflowValidationResult;
}

export const BUILDER_FEATURE_TO_CAPABILITY: Record<
  BuilderFeatureType,
  WorkflowCapabilityKey
> = {
  'Text to Image': 'image.text_to_image',
  'Replace Product': 'image.replace_product',
  'Modify Image': 'image.modify',
  'Image to Video': 'video.image_to_video',
  'Motion Control': 'video.motion_control',
  'Image Lip Sync': 'video.lip_sync_image',
  'Video Lip Sync': 'video.lip_sync_video',
};

function buildDefaultParameters(
  capabilityKey: WorkflowCapabilityKey,
): JsonObject {
  const capability = getWorkflowCapability(capabilityKey);
  return capability.parameters.reduce<JsonObject>((parameters, definition) => {
    if (definition.defaultValue !== undefined) {
      parameters[definition.key] = definition.defaultValue;
    }
    return parameters;
  }, {});
}

function parseDuration(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildParameters(
  step: BuilderDraftStep,
  capabilityKey: WorkflowCapabilityKey,
): JsonObject {
  const parameters = buildDefaultParameters(capabilityKey);

  if ('prompt' in parameters) {
    parameters.prompt = step.prompt.trim();
  }

  if (capabilityKey === 'video.image_to_video') {
    parameters.duration = Math.min(15, Math.max(3, parseDuration(
      step.videoParams?.duration,
      Number(parameters.duration ?? 3),
    )));
    parameters.resolution = step.videoParams?.resolution || '720p';
    parameters.generateAudio = step.videoParams?.generateAudio ?? true;
    parameters.outputCount = 1;
  }

  if (capabilityKey === 'image.text_to_image') {
    parameters.ratio = step.imageParams?.ratio || '1:1';
    parameters.resolution = step.imageParams?.resolution || '1K';
    parameters.outputCount = 1;
  }

  return parameters;
}

function findPreviousCompatibleStep(
  steps: BuilderDraftStep[],
  currentIndex: number,
  assetType: 'image' | 'video' | 'audio',
): BuilderDraftStep | undefined {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const previous = steps[index];
    const previousCapability = getWorkflowCapability(
      BUILDER_FEATURE_TO_CAPABILITY[previous.feature],
    );
    if (previousCapability.output.assetType === assetType) return previous;
  }
  return undefined;
}

function buildInputBindings(
  step: BuilderDraftStep,
  stepIndex: number,
  allSteps: BuilderDraftStep[],
  capabilityKey: WorkflowCapabilityKey,
): WorkflowInputBinding[] {
  if (step.inputBindings) {
    return step.inputBindings.map((input) => ({ ...input }));
  }

  const capability = getWorkflowCapability(capabilityKey);
  let previousStepUsed = false;
  const usedMaterialIds = new Set<string>();

  return capability.inputs
    .filter(
      (slot) =>
        slot.required ||
        step.materials.some(
          (material) =>
            Boolean(material.url) &&
            material.type.toLowerCase() === slot.assetType,
        ),
    )
    .map((slot): WorkflowInputBinding => {
      const material = step.materials.find(
        (candidate) =>
          !usedMaterialIds.has(candidate.id) &&
          Boolean(candidate.url) &&
          candidate.type.toLowerCase() === slot.assetType,
      );
      if (
        material?.templateAssetId &&
        slot.allowedSources.includes('template_asset')
      ) {
        usedMaterialIds.add(material.id);
        return {
          slot: slot.key,
          assetType: slot.assetType,
          source: 'template_asset',
          required: slot.required,
          templateAssetId: material.templateAssetId,
        };
      }

      const previous = previousStepUsed
        ? undefined
        : findPreviousCompatibleStep(allSteps, stepIndex, slot.assetType);

      if (previous && slot.allowedSources.includes('previous_step')) {
        previousStepUsed = true;
        const previousCapability = getWorkflowCapability(
          BUILDER_FEATURE_TO_CAPABILITY[previous.feature],
        );
        return {
          slot: slot.key,
          assetType: slot.assetType,
          source: 'previous_step',
          required: slot.required,
          fromStepId: previous.id,
          outputKey: previousCapability.output.key,
        };
      }

      if (material) usedMaterialIds.add(material.id);

      return {
        slot: slot.key,
        assetType: slot.assetType,
        source: 'user_upload',
        required: slot.required,
      };
    });
}

export function builderStepsToWorkflowDefinition(
  steps: BuilderDraftStep[],
): WorkflowDefinition {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    steps: steps.map((step, index) => {
      const capabilityKey = BUILDER_FEATURE_TO_CAPABILITY[step.feature];
      const capability = getWorkflowCapability(capabilityKey);

      return {
        id: step.id,
        order: index + 1,
        capability: capabilityKey,
        capabilityVersion: capability.version,
        title: capability.displayName,
        instruction: step.prompt.trim().slice(0, 500),
        inputs: buildInputBindings(step, index, steps, capabilityKey),
        parameters: buildParameters(step, capabilityKey),
        output: { ...capability.output },
      };
    }),
  };
}

export function convertAndValidateBuilderWorkflow(
  steps: BuilderDraftStep[],
): BuilderWorkflowConversionResult {
  const workflow = builderStepsToWorkflowDefinition(steps);
  return {
    workflow,
    validation: validateWorkflowDefinition(workflow),
  };
}

export function formatWorkflowValidationIssues(
  validation: WorkflowValidationResult,
): string[] {
  return validation.issues.map((issue) => `${issue.path}: ${issue.message}`);
}
