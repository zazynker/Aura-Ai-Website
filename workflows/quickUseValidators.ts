import {
  createQuickUseExampleAssetKey,
  deriveQuickUseCandidates,
  getSuggestedQuickUseControl,
} from './quickUseCandidates';
import {
  QUICK_USE_SCHEMA_VERSION,
  type QuickUseBlockDefinition,
  type QuickUseCandidate,
  type QuickUseControlType,
  type QuickUseDefinition,
  type QuickUseValidationIssue,
  type QuickUseValidationResult,
} from './quickUseTypes';

const PROMPT_INPUT_KINDS = new Set(['text', 'textarea', 'dialogue']);
const CONTROL_TYPES = new Set<QuickUseControlType>([
  'image_upload',
  'video_upload',
  'audio_upload',
  'text',
  'textarea',
  'dialogue',
  'number',
  'select',
  'toggle',
]);

export function validateQuickUseDefinition(
  workflow: unknown,
  definitionValue: unknown,
): QuickUseValidationResult {
  const issues: QuickUseValidationIssue[] = [];
  if (!isRecord(definitionValue)) {
    return invalid('$', 'invalid_type', 'Quick Use definition must be an object.');
  }
  if (!isJsonSerializable(definitionValue)) {
    return invalid('$', 'not_serializable', 'Quick Use definition must contain only JSON-serializable data.');
  }

  validateDefinitionShape(definitionValue, issues);
  if (issues.length > 0) return { valid: false, issues };

  const definition = definitionValue as unknown as QuickUseDefinition;
  const derivation = deriveQuickUseCandidates(workflow, definition);
  issues.push(...derivation.issues);
  if (!derivation.valid) return { valid: false, issues };

  validateBlocks(definition.blocks, derivation.candidates, issues);
  return { valid: issues.length === 0, issues };
}

export function assertValidQuickUseDefinition(
  workflow: unknown,
  definition: unknown,
): asserts definition is QuickUseDefinition {
  const result = validateQuickUseDefinition(workflow, definition);
  if (!result.valid) {
    const summary = result.issues
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Quick Use definition. ${summary}`);
  }
}

function validateDefinitionShape(
  value: Record<string, unknown>,
  issues: QuickUseValidationIssue[],
): void {
  if (value.schemaVersion !== QUICK_USE_SCHEMA_VERSION) {
    issues.push({
      path: '$.schemaVersion',
      code: 'unsupported_schema_version',
      message: `Quick Use schema version must be ${QUICK_USE_SCHEMA_VERSION}.`,
    });
  }
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) {
    issues.push({
      path: '$.title',
      code: 'invalid_title',
      message: 'Quick Use title is required and must be at most 120 characters.',
    });
  }
  if (value.subtitle !== undefined && (
    typeof value.subtitle !== 'string' || value.subtitle.length > 300
  )) {
    issues.push({
      path: '$.subtitle',
      code: 'invalid_subtitle',
      message: 'Quick Use subtitle must be at most 300 characters.',
    });
  }
  if (!Array.isArray(value.replaceableMaterials)) {
    issues.push({
      path: '$.replaceableMaterials',
      code: 'invalid_type',
      message: 'Replaceable materials must be an array.',
    });
  } else {
    value.replaceableMaterials.forEach((item, index) => {
      const path = `$.replaceableMaterials[${index}]`;
      if (!isRecord(item) || !isWorkflowInputBinding(item.binding)) {
        issues.push({
          path: `${path}.binding`,
          code: 'invalid_input_binding',
          message: 'Replaceable material must bind to a workflow step and input slot.',
        });
      }
    });
  }
  if (!Array.isArray(value.promptTemplates)) {
    issues.push({
      path: '$.promptTemplates',
      code: 'invalid_type',
      message: 'Prompt templates must be an array.',
    });
  } else {
    value.promptTemplates.forEach((item, index) => {
      validatePromptTemplateShape(item, index, issues);
    });
  }
  if (!Array.isArray(value.blocks)) {
    issues.push({
      path: '$.blocks',
      code: 'invalid_type',
      message: 'Quick Use blocks must be an array.',
    });
  } else {
    value.blocks.forEach((item, index) => {
      validateBlockShape(item, index, issues);
    });
  }
}

function validatePromptTemplateShape(
  value: unknown,
  index: number,
  issues: QuickUseValidationIssue[],
): void {
  const path = `$.promptTemplates[${index}]`;
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid_type', message: 'Prompt template must be an object.' });
    return;
  }
  if (typeof value.stepId !== 'string' || !value.stepId) {
    issues.push({ path: `${path}.stepId`, code: 'invalid_step_id', message: 'Prompt template step id is required.' });
  }
  if (typeof value.parameterKey !== 'string' || !value.parameterKey) {
    issues.push({ path: `${path}.parameterKey`, code: 'invalid_parameter_key', message: 'Prompt parameter key is required.' });
  }
  if (typeof value.template !== 'string') {
    issues.push({ path: `${path}.template`, code: 'invalid_type', message: 'Prompt template must be a string.' });
  }
  if (!Array.isArray(value.variables)) {
    issues.push({ path: `${path}.variables`, code: 'invalid_type', message: 'Prompt variables must be an array.' });
    return;
  }
  value.variables.forEach((variable, variableIndex) => {
    const variablePath = `${path}.variables[${variableIndex}]`;
    if (!isRecord(variable)) {
      issues.push({ path: variablePath, code: 'invalid_type', message: 'Prompt variable must be an object.' });
      return;
    }
    if (typeof variable.key !== 'string') {
      issues.push({ path: `${variablePath}.key`, code: 'invalid_type', message: 'Prompt variable key must be a string.' });
    }
    if (typeof variable.label !== 'string') {
      issues.push({ path: `${variablePath}.label`, code: 'invalid_type', message: 'Prompt variable label must be a string.' });
    }
    if (typeof variable.defaultValue !== 'string') {
      issues.push({ path: `${variablePath}.defaultValue`, code: 'invalid_type', message: 'Prompt variable default must be a string.' });
    }
    if (typeof variable.inputKind !== 'string' || !PROMPT_INPUT_KINDS.has(variable.inputKind)) {
      issues.push({ path: `${variablePath}.inputKind`, code: 'invalid_input_kind', message: 'Prompt variable input kind is invalid.' });
    }
    if (typeof variable.required !== 'boolean') {
      issues.push({ path: `${variablePath}.required`, code: 'invalid_type', message: 'Prompt variable required flag must be boolean.' });
    }
  });
}

function validateBlockShape(
  value: unknown,
  index: number,
  issues: QuickUseValidationIssue[],
): void {
  const path = `$.blocks[${index}]`;
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid_type', message: 'Quick Use block must be an object.' });
    return;
  }
  if (typeof value.candidateId !== 'string' || !value.candidateId) {
    issues.push({ path: `${path}.candidateId`, code: 'invalid_candidate_id', message: 'Block candidate id is required.' });
  }
  if (!Number.isInteger(value.order) || value.order !== index + 1) {
    issues.push({ path: `${path}.order`, code: 'invalid_block_order', message: `Block order must be ${index + 1}.` });
  }
  if (typeof value.control !== 'string' || !CONTROL_TYPES.has(value.control as QuickUseControlType)) {
    issues.push({ path: `${path}.control`, code: 'invalid_control', message: 'Block control type is invalid.' });
  }
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) {
    issues.push({ path: `${path}.title`, code: 'invalid_block_title', message: 'Block title is required and must be at most 120 characters.' });
  }
  if (value.subtitle !== undefined && (typeof value.subtitle !== 'string' || value.subtitle.length > 300)) {
    issues.push({ path: `${path}.subtitle`, code: 'invalid_block_subtitle', message: 'Block subtitle must be at most 300 characters.' });
  }
  if (value.placeholder !== undefined && (typeof value.placeholder !== 'string' || value.placeholder.length > 200)) {
    issues.push({ path: `${path}.placeholder`, code: 'invalid_placeholder', message: 'Block placeholder must be at most 200 characters.' });
  }
  ['primary', 'required', 'openByDefault'].forEach((key) => {
    if (typeof value[key] !== 'boolean') {
      issues.push({ path: `${path}.${key}`, code: 'invalid_type', message: `${key} must be boolean.` });
    }
  });
  if (value.defaultValue !== undefined && !isJsonPrimitive(value.defaultValue)) {
    issues.push({ path: `${path}.defaultValue`, code: 'invalid_default_value', message: 'Block default must be a JSON primitive.' });
  }
  if (value.example !== undefined) validateExampleShape(value.example, `${path}.example`, issues);
}

function validateExampleShape(
  value: unknown,
  path: string,
  issues: QuickUseValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid_type', message: 'Block example must be an object.' });
    return;
  }
  if (value.kind === 'text') {
    if (typeof value.value !== 'string') {
      issues.push({ path: `${path}.value`, code: 'invalid_type', message: 'Text example value must be a string.' });
    }
    return;
  }
  if (value.kind === 'media') {
    if (!['image', 'video', 'audio'].includes(String(value.assetType))) {
      issues.push({ path: `${path}.assetType`, code: 'invalid_asset_type', message: 'Media example asset type is invalid.' });
    }
    if (typeof value.assetKey !== 'string' || !value.assetKey) {
      issues.push({ path: `${path}.assetKey`, code: 'invalid_asset_key', message: 'Media example asset key is required.' });
    }
    return;
  }
  issues.push({ path: `${path}.kind`, code: 'invalid_example_kind', message: 'Block example kind is invalid.' });
}

function validateBlocks(
  blocks: QuickUseBlockDefinition[],
  candidates: QuickUseCandidate[],
  issues: QuickUseValidationIssue[],
): void {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seenCandidateIds = new Set<string>();
  let primaryCount = 0;

  blocks.forEach((block, index) => {
    const path = `$.blocks[${index}]`;
    if (seenCandidateIds.has(block.candidateId)) {
      issues.push({
        path: `${path}.candidateId`,
        code: 'duplicate_exposed_candidate',
        message: `Candidate is exposed more than once: ${block.candidateId}.`,
      });
      return;
    }
    seenCandidateIds.add(block.candidateId);
    const candidate = candidatesById.get(block.candidateId);
    if (!candidate) {
      issues.push({
        path: `${path}.candidateId`,
        code: 'unknown_candidate',
        message: `Block references a candidate that is not available: ${block.candidateId}.`,
      });
      return;
    }

    if (!isControlCompatible(block.control, candidate)) {
      issues.push({
        path: `${path}.control`,
        code: 'incompatible_control',
        message: `Control ${block.control} is incompatible with ${candidate.kind} candidate ${candidate.id}.`,
      });
    }
    if (candidate.required && !block.required) {
      issues.push({
        path: `${path}.required`,
        code: 'required_candidate_made_optional',
        message: 'A required workflow candidate cannot be made optional.',
      });
    }
    if (block.primary) primaryCount += 1;
    if (
      block.example?.kind === 'media'
      && block.example.assetKey !== createQuickUseExampleAssetKey(block.candidateId)
    ) {
      issues.push({
        path: `${path}.example.assetKey`,
        code: 'unstable_example_asset_key',
        message: 'Media example asset key must be derived from the block candidate id.',
      });
    }
    validateBlockDefault(block, candidate, path, issues);
  });

  if (primaryCount > 1) {
    issues.push({
      path: '$.blocks',
      code: 'multiple_primary_blocks',
      message: 'Quick Use definition can contain at most one primary block.',
    });
  }
}

function isControlCompatible(
  control: QuickUseControlType,
  candidate: QuickUseCandidate,
): boolean {
  const suggested = getSuggestedQuickUseControl(candidate);
  if (control === suggested) return true;
  if (candidate.kind === 'prompt_variable') {
    return ['text', 'textarea', 'dialogue'].includes(control);
  }
  if (candidate.kind === 'setting' && candidate.parameterType === 'string') {
    return control === 'text' || control === 'textarea';
  }
  return false;
}

function validateBlockDefault(
  block: QuickUseBlockDefinition,
  candidate: QuickUseCandidate,
  path: string,
  issues: QuickUseValidationIssue[],
): void {
  if (block.defaultValue === undefined) return;
  if (candidate.kind === 'material') {
    issues.push({
      path: `${path}.defaultValue`,
      code: 'media_default_not_supported',
      message: 'Media upload blocks use the workflow asset as their default and cannot store a primitive default.',
    });
    return;
  }
  if (candidate.kind === 'prompt_variable') {
    if (typeof block.defaultValue !== 'string') {
      issues.push({ path: `${path}.defaultValue`, code: 'invalid_default_type', message: 'Prompt variable default must be a string.' });
    }
    return;
  }

  const value = block.defaultValue;
  const expectedType = candidate.parameterType === 'enum' ? null : candidate.parameterType;
  if (expectedType && typeof value !== expectedType) {
    issues.push({
      path: `${path}.defaultValue`,
      code: 'invalid_default_type',
      message: `Setting default must be a ${expectedType}.`,
    });
    return;
  }
  if (candidate.parameterType === 'enum' && !candidate.enumValues?.includes(value)) {
    issues.push({
      path: `${path}.defaultValue`,
      code: 'invalid_default_value',
      message: 'Setting default is not an allowed enum value.',
    });
  }
  if (typeof value === 'number') {
    if (candidate.min !== undefined && value < candidate.min) {
      issues.push({ path: `${path}.defaultValue`, code: 'default_too_small', message: `Setting default must be at least ${candidate.min}.` });
    }
    if (candidate.max !== undefined && value > candidate.max) {
      issues.push({ path: `${path}.defaultValue`, code: 'default_too_large', message: `Setting default must be at most ${candidate.max}.` });
    }
  }
  if (typeof value === 'string' && candidate.maxLength !== undefined && value.length > candidate.maxLength) {
    issues.push({ path: `${path}.defaultValue`, code: 'default_too_long', message: `Setting default must be at most ${candidate.maxLength} characters.` });
  }
}

function isWorkflowInputBinding(value: unknown): boolean {
  return isRecord(value)
    && value.kind === 'workflow_input'
    && typeof value.stepId === 'string'
    && Boolean(value.stepId)
    && typeof value.slot === 'string'
    && Boolean(value.slot);
}

function isJsonSerializable(value: unknown, seen = new Set<object>()): boolean {
  if (isJsonPrimitive(value)) return true;
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = value.every((item) => isJsonSerializable(item, seen));
    seen.delete(value);
    return valid;
  }
  if (!isRecord(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Object.values(value).every((item) => isJsonSerializable(item, seen));
  seen.delete(value);
  return valid;
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null
    || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(path: string, code: string, message: string): QuickUseValidationResult {
  return { valid: false, issues: [{ path, code, message }] };
}
