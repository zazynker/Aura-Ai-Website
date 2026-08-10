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

export interface QuickUsePromptVariableDefinition {
  key: string;
  label: string;
  defaultValue: string;
  inputKind: QuickUsePromptInputKind;
  required: boolean;
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

export interface QuickUseDefinition {
  schemaVersion: typeof QUICK_USE_SCHEMA_VERSION;
  title: string;
  subtitle?: string;
  replaceableMaterials: UserReplaceableMaterialDefinition[];
  promptTemplates: QuickUsePromptTemplateDefinition[];
  blocks: QuickUseBlockDefinition[];
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
>>;

export type QuickUsePresentationDefinition = Pick<
  QuickUseDefinition,
  'schemaVersion' | 'title' | 'subtitle' | 'blocks'
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
