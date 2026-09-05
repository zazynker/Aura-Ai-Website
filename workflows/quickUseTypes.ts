import type {
  CapabilityParameterType,
  JsonPrimitive,
  WorkflowAssetType,
  WorkflowCapabilityKey,
} from './types';

export const QUICK_USE_SCHEMA_VERSION = 1 as const;

/**
 * Candidate ids are derived from workflow bindings. They are stable across
 * step reordering and never depend on a React render, array index, or random
 * value.
 */
export type QuickUseCandidateId =
  | `quick-use:input:${string}:${string}`
  | `quick-use:setting:${string}:${string}`
  | `quick-use:prompt:${string}:${string}:${string}`;

export interface QuickUseWorkflowInputBinding {
  kind: 'workflow_input';
  stepId: string;
  slot: string;
}

export interface QuickUseWorkflowParameterBinding {
  kind: 'workflow_parameter';
  stepId: string;
  parameterKey: string;
}

export interface QuickUsePromptVariableBinding {
  kind: 'prompt_variable';
  stepId: string;
  parameterKey: string;
  variableKey: string;
}

export type QuickUseCandidateBinding =
  | QuickUseWorkflowInputBinding
  | QuickUseWorkflowParameterBinding
  | QuickUsePromptVariableBinding;

/**
 * Marks a concrete workflow input slot as replaceable by a user upload.
 * The slot, rather than a builder material card id, is the durable identity.
 */
export interface UserReplaceableMaterialDefinition {
  binding: QuickUseWorkflowInputBinding;
}

export type QuickUsePromptInputKind = 'text' | 'textarea' | 'dialogue';

export interface QuickUseDialogueCharacterDefinition {
  /** Stable authoring identity. The visible name may change without breaking turns. */
  id: string;
  defaultName: string;
}

export interface QuickUseDialogueTurnDefinition {
  /** Stable authoring identity. It is preserved when turns are reordered. */
  id: string;
  characterId: string;
  text: string;
}

/**
 * Serializable Dialogue contract owned by one template version. Character
 * membership is fixed by Admin; Quick Use may only edit the allowed values.
 */
export interface QuickUseDialogueDefinition {
  characters: QuickUseDialogueCharacterDefinition[];
  turns: QuickUseDialogueTurnDefinition[];
  allowUserRenameCharacters: boolean;
}

export interface QuickUseDialogueValue {
  characterNames: Record<string, string>;
  turns: QuickUseDialogueTurnDefinition[];
}

export interface QuickUsePromptVariableDefinition {
  key: string;
  label: string;
  defaultValue: string;
  inputKind: QuickUsePromptInputKind;
  required: boolean;
  dialogue?: QuickUseDialogueDefinition;
}

/**
 * Keeps a tokenized prompt outside WorkflowDefinition. Rendering all variable
 * defaults must reproduce the workflow parameter value, so legacy workflows
 * remain executable without Quick Use metadata.
 */
export interface QuickUsePromptTemplateDefinition {
  stepId: string;
  parameterKey: string;
  template: string;
  variables: QuickUsePromptVariableDefinition[];
}

export interface QuickUseCandidateBase {
  id: QuickUseCandidateId;
  stepId: string;
  stepTitle: string;
  capability: WorkflowCapabilityKey;
  capabilityVersion: number;
  label: string;
  required: boolean;
}

export interface QuickUseMaterialCandidate extends QuickUseCandidateBase {
  kind: 'material';
  binding: QuickUseWorkflowInputBinding;
  assetType: WorkflowAssetType;
  acceptedMimeTypes: string[];
  maxCount: number;
  defaultTemplateAssetId?: string;
}

export interface QuickUsePromptVariableCandidate extends QuickUseCandidateBase {
  kind: 'prompt_variable';
  binding: QuickUsePromptVariableBinding;
  defaultValue: string;
  inputKind: QuickUsePromptInputKind;
  dialogue?: QuickUseDialogueDefinition;
}

export interface QuickUseSettingCandidate extends QuickUseCandidateBase {
  kind: 'setting';
  binding: QuickUseWorkflowParameterBinding;
  parameterType: CapabilityParameterType;
  defaultValue?: JsonPrimitive;
  enumValues?: JsonPrimitive[];
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
}

export type QuickUseCandidate =
  | QuickUseMaterialCandidate
  | QuickUsePromptVariableCandidate
  | QuickUseSettingCandidate;

/**
 * Serializable presentation semantics. These values describe the product
 * contract only; they do not reference React components or browser objects.
 */
export type QuickUseControlType =
  | 'image_upload'
  | 'video_upload'
  | 'audio_upload'
  | 'text'
  | 'textarea'
  | 'dialogue'
  | 'number'
  | 'select'
  | 'toggle';

export type QuickUseExampleDefinition =
  | {
      kind: 'text';
      value: string;
    }
  | {
      kind: 'media';
      assetType: WorkflowAssetType;
      assetKey: string;
    };

/**
 * A block exposes exactly one derived candidate. candidateId is also its
 * durable identity, so definitions cannot duplicate an underlying binding.
 */
export interface QuickUseBlockDefinition {
  candidateId: QuickUseCandidateId;
  order: number;
  control: QuickUseControlType;
  title: string;
  subtitle?: string;
  placeholder?: string;
  defaultValue?: JsonPrimitive;
  primary: boolean;
  required: boolean;
  openByDefault: boolean;
  example?: QuickUseExampleDefinition;
}

/**
 * MVP joins clips back-to-back with no transition. The field exists so a
 * later transition mode can be added without a schema version bump.
 */
export type QuickUseFinalVideoTransition = 'none';

/**
 * Version-scoped final cut contract.
 *
 * `stepIds` lists the authored workflow step ids whose video result is part of
 * the deliverable, in workflow order. Only steps whose capability output is a
 * video may appear here; an image step is never auto-converted to a clip.
 * A run with fewer than two included clips delivers the last step result
 * directly, exactly as before this feature existed.
 */
export interface QuickUseFinalVideoDefinition {
  enabled: boolean;
  stepIds: string[];
  transition: QuickUseFinalVideoTransition;
}

/**
 * Controls whether a Quick Use run may serve the template's own demo result
 * for a step the user did not change. Reuse costs no credits and calls no
 * provider. Defaults to enabled when the field is absent, so published legacy
 * versions keep working and immediately benefit.
 */
export interface QuickUseStepReuseDefinition {
  enabled: boolean;
}

export type QuickUseTimelineClipSource =
  | { kind: 'template_asset'; assetKey: string }
  | { kind: 'step_result'; stepId: string; resultId?: string };

export interface QuickUseTimelineVideoClipDefinition {
  id: string;
  source: QuickUseTimelineClipSource;
  /**
   * Final-assembly duration divided by the source duration. A value of 1.2
   * plays the clip at 1 / 1.2 speed and makes it 20% longer. The source step
   * result is never replaced; retiming only creates an assembly-time copy.
   */
  durationScale?: number;
}

export interface QuickUseTimelineAudioClipDefinition {
  id: string;
  source: QuickUseTimelineClipSource;
  /** Milliseconds from the beginning of the final video. */
  startMs: number;
}

/**
 * Version-owned assembly contract. Video clips are concatenated in array
 * order. Their embedded sound remains enabled; every audio clip is mixed on
 * top at startMs. Sources can be switched without changing placement.
 */
export interface QuickUseTimelineDefinition {
  enabled: boolean;
  preserveVideoAudio: true;
  videoClips: QuickUseTimelineVideoClipDefinition[];
  audioClips: QuickUseTimelineAudioClipDefinition[];
  /** User-facing choices for authored alternatives of a step result. */
  resultChoices?: QuickUseTimelineResultChoiceGroup[];
}

export interface QuickUseTimelineResultChoiceOption {
  id: string;
  label: string;
  assetKey: string;
  assetType: 'image' | 'video' | 'audio';
}

export interface QuickUseTimelineResultChoiceGroup {
  id: string;
  label: string;
  stepId: string;
  options: QuickUseTimelineResultChoiceOption[];
  defaultOptionId: string;
}

export interface QuickUseDefinition {
  schemaVersion: typeof QUICK_USE_SCHEMA_VERSION;
  title: string;
  subtitle?: string;
  replaceableMaterials: UserReplaceableMaterialDefinition[];
  /**
   * Registry settings the Admin explicitly permits the Quick Use author to
   * place on the end-user form. An absent field means "all" only for legacy
   * definitions created before this allow-list existed; new definitions start
   * with an empty list.
   */
  editableSettings?: QuickUseWorkflowParameterBinding[];
  promptTemplates: QuickUsePromptTemplateDefinition[];
  blocks: QuickUseBlockDefinition[];
  finalVideo?: QuickUseFinalVideoDefinition;
  timeline?: QuickUseTimelineDefinition;
  stepReuse?: QuickUseStepReuseDefinition;
}

export type QuickUsePresentationCandidate = Pick<
  QuickUseCandidate,
  'id' | 'kind' | 'label' | 'required'
> & Partial<Pick<
  QuickUseMaterialCandidate,
  'assetType' | 'acceptedMimeTypes' | 'maxCount'
>> & Partial<Pick<
  QuickUseSettingCandidate,
  'parameterType' | 'enumValues' | 'min' | 'max' | 'step' | 'maxLength'
>> & Partial<Pick<
  QuickUsePromptVariableCandidate,
  'dialogue'
>>;

export type QuickUsePresentationDefinition = Pick<
  QuickUseDefinition,
  'schemaVersion' | 'title' | 'subtitle' | 'blocks' | 'timeline'
> & {
  candidates: QuickUsePresentationCandidate[];
};

export interface QuickUseValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface QuickUseValidationResult {
  valid: boolean;
  issues: QuickUseValidationIssue[];
}

export interface QuickUseCandidateDerivationResult
  extends QuickUseValidationResult {
  candidates: QuickUseCandidate[];
}
