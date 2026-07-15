export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type WorkflowCapabilityKey =
  | 'image.text_to_image'
  | 'image.replace_product'
  | 'image.modify'
  | 'image.change_ratio'
  | 'image.enhance'
  | 'image.upscale'
  | 'video.image_to_video'
  | 'video.motion_control'
  | 'video.lip_sync_image'
  | 'video.lip_sync_video';

export type WorkflowAssetType = 'image' | 'video' | 'audio';

export type WorkflowInputSource =
  | 'user_upload'
  | 'previous_step'
  | 'template_asset';

export interface WorkflowInputBinding {
  slot: string;
  assetType: WorkflowAssetType;
  source: WorkflowInputSource;
  required: boolean;
  fromStepId?: string;
  outputKey?: string;
  templateAssetId?: string;
}

export interface WorkflowOutputDefinition {
  key: string;
  assetType: 'image' | 'video';
  allowUserSelection?: boolean;
}

export interface WorkflowStep {
  id: string;
  order: number;
  capability: WorkflowCapabilityKey;
  capabilityVersion: number;
  title: string;
  instruction: string;
  inputs: WorkflowInputBinding[];
  parameters: JsonObject;
  output: WorkflowOutputDefinition;
}

export interface WorkflowDefinition {
  schemaVersion: number;
  steps: WorkflowStep[];
}

export interface CapabilityInputSlot {
  key: string;
  label: string;
  assetType: WorkflowAssetType;
  required: boolean;
  maxCount: number;
  acceptedMimeTypes: string[];
  allowedSources: WorkflowInputSource[];
}

export type CapabilityParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum';

export interface CapabilityParameterDefinition {
  key: string;
  label: string;
  type: CapabilityParameterType;
  required: boolean;
  editable: boolean;
  defaultValue?: JsonPrimitive;
  enumValues?: JsonPrimitive[];
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
}

export interface CapabilityEditorTarget {
  route: '/modify' | '/video';
  editor: 'modify' | 'video';
  featureKey: string;
  submode?: string;
}

export interface WorkflowCapabilityDefinition {
  key: WorkflowCapabilityKey;
  version: number;
  displayName: string;
  description: string;
  editorTarget: CapabilityEditorTarget;
  inputs: CapabilityInputSlot[];
  parameters: CapabilityParameterDefinition[];
  output: WorkflowOutputDefinition;
  enabledForTemplates: boolean;
}

export interface WorkflowValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
}

