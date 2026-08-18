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
  | 'Image Generation'
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
  /** Stable capability input slot this material supplies (for example source_image). */
  inputSlot?: string;
  referenceRole?: 'image' | 'style' | 'omni';
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
  resultThumbnailUrl?: string;
  materials: BuilderMaterial[];
  prompt: string;
  resultGenerationId?: string;
  videoParams?: {
    duration: string;
    resolution: string;
    generateAudio?: boolean;
  };
  imageParams?: {
    model: 'gpt-image-2' | 'mj-v8.1';
    ratio: string;
    resolution: string;
    quality: 'standard' | 'hd';
    stylize: number;
    chaos: number;
    experimental: number;
    raw: boolean;
    seed: string;
    referenceMode: 'image' | 'style' | 'omni';
    imageWeight: number;
    styleWeight: number;
    omniWeight: number;
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
  'Image Generation': 'image.text_to_image',
  'Replace Product': 'image.replace_product',
  'Modify Image': 'image.modify',
  'Image to Video': 'video.image_to_video',
  'Motion Control': 'video.motion_control',
  'Image Lip Sync': 'video.lip_sync_image',
  'Video Lip Sync': 'video.lip_sync_video',
};

const materialAssetType = (
  material: Pick<BuilderMaterial, 'type'>,
): 'image' | 'video' | 'audio' => material.type.toLowerCase() as 'image' | 'video' | 'audio';

const mjRoleSlot = (
  role: BuilderMaterial['referenceRole'],
): string | undefined => role === 'image'
  ? 'image_reference'
  : role === 'style'
    ? 'style_reference'
    : role === 'omni'
      ? 'omni_reference'
      : undefined;

export function getBuilderMaterialInputSlots(
  feature: BuilderFeatureType,
  type?: BuilderMaterial['type'],
) {
  const capability = getWorkflowCapability(BUILDER_FEATURE_TO_CAPABILITY[feature]);
  return capability.inputs.filter((slot) => (
    slot.key !== 'reference_images'
    && (!type || slot.assetType === type.toLowerCase())
  ));
}

/**
 * Assigns each material to a capability input without relying on its array
 * index at execution time. Existing valid bindings win; unbound legacy cards
 * are deterministically assigned to the first compatible free slot.
 */
export function assignBuilderMaterialInputSlots(
  feature: BuilderFeatureType,
  materials: BuilderMaterial[],
): BuilderMaterial[] {
  const slots = getBuilderMaterialInputSlots(feature);
  const slotByKey = new Map(slots.map((slot) => [slot.key, slot]));
  const used = new Set<string>();

  const preserved = materials.map((material) => {
    const preferredSlot = material.inputSlot || mjRoleSlot(material.referenceRole);
    const slot = preferredSlot ? slotByKey.get(preferredSlot) : undefined;
    if (
      slot
      && slot.assetType === materialAssetType(material)
      && !used.has(slot.key)
    ) {
      used.add(slot.key);
      return { ...material, inputSlot: slot.key };
    }
    return { ...material, inputSlot: undefined };
  });

  return preserved.map((material) => {
    if (material.inputSlot) return material;
    const slot = slots.find((candidate) => (
      candidate.assetType === materialAssetType(material)
      && !used.has(candidate.key)
    ));
    if (!slot) return material;
    used.add(slot.key);
    return { ...material, inputSlot: slot.key };
  });
}

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
    // Keep the authored value byte-for-byte. Quick Use prompt templates retain
    // their original whitespace, and their defaults are validated against this
    // workflow parameter before a draft can be saved.
    parameters.prompt = step.prompt;
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
    const imageParams = step.imageParams;
    const model = imageParams?.model || 'gpt-image-2';
    parameters.model = model;
    parameters.ratio = imageParams?.ratio || '1:1';
    parameters.outputCount = model === 'mj-v8.1' ? 4 : 1;

    if (model === 'mj-v8.1') {
      delete parameters.resolution;
      parameters.quality = imageParams?.quality || 'standard';
      parameters.stylize = imageParams?.stylize ?? 100;
      parameters.chaos = imageParams?.chaos ?? 0;
      parameters.experimental = imageParams?.experimental ?? 0;
      parameters.raw = imageParams?.raw ?? false;
      parameters.imageWeight = imageParams?.imageWeight ?? 1;
      parameters.styleWeight = imageParams?.styleWeight ?? 100;
      parameters.omniWeight = imageParams?.omniWeight ?? 100;
      if (imageParams?.seed.trim()) parameters.seed = Number(imageParams.seed);
    } else {
      parameters.resolution = imageParams?.resolution || '1K';
    }
  }

  return parameters;
}

function findPreviousCompatibleStep(
  steps: BuilderDraftStep[],
  currentIndex: number,
  assetType: 'image' | 'video' | 'audio',
  excludedStepIds = new Set<string>(),
): BuilderDraftStep | undefined {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const previous = steps[index];
    if (excludedStepIds.has(previous.id)) continue;
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
  const hasExplicitMaterialSlots = step.materials.some((material) => Boolean(material.inputSlot));
  if (step.inputBindings && !hasExplicitMaterialSlots) {
    return step.inputBindings.map((input) => ({ ...input }));
  }

  const capability = getWorkflowCapability(capabilityKey);
  const autoRoutedPreviousStepIds = new Set<string>();
  const usedMaterialIds = new Set<string>();

  const capabilityInputs = capabilityKey === 'image.text_to_image'
    ? capability.inputs.filter((slot) => slot.key !== 'reference_images')
    : capability.inputs;

  const existingInputBySlot = new Map(
    (step.inputBindings || []).map((input) => [input.slot, input]),
  );

  return capabilityInputs
    .filter(
      (slot) => slot.required
        || existingInputBySlot.has(slot.key)
        || step.materials.some((material) => (
          material.inputSlot === slot.key
          && materialAssetType(material) === slot.assetType
        )),
    )
    .map((slot): WorkflowInputBinding => {
      const existing = existingInputBySlot.get(slot.key);
      if (existing?.source === 'previous_step') {
        return { ...existing };
      }
      const roleForSlot = capabilityKey === 'image.text_to_image'
        ? slot.key === 'image_reference' ? 'image'
          : slot.key === 'style_reference' ? 'style'
            : slot.key === 'omni_reference' ? 'omni'
              : undefined
        : undefined;
      const material = step.materials.find(
        (candidate) =>
          !usedMaterialIds.has(candidate.id) &&
          Boolean(candidate.url) &&
          materialAssetType(candidate) === slot.assetType &&
          (
            candidate.inputSlot === slot.key
            || (!hasExplicitMaterialSlots && (
              !roleForSlot
              || !candidate.referenceRole
              || candidate.referenceRole === roleForSlot
            ))
          ),
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

      if (material) {
        usedMaterialIds.add(material.id);
        return {
          slot: slot.key,
          assetType: slot.assetType,
          source: 'user_upload',
          required: slot.required,
        };
      }

      if (existing) return { ...existing };

      const previous = slot.required
        ? findPreviousCompatibleStep(
            allSteps,
            stepIndex,
            slot.assetType,
            autoRoutedPreviousStepIds,
          )
        : undefined;

      if (previous && slot.allowedSources.includes('previous_step')) {
        autoRoutedPreviousStepIds.add(previous.id);
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
