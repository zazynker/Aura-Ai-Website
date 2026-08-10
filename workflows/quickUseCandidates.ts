import { getWorkflowCapability } from './registry';
import type {
  JsonPrimitive,
  WorkflowDefinition,
  WorkflowStep,
} from './types';
import { validateWorkflowDefinition } from './validators';
import type {
  QuickUseCandidate,
  QuickUseCandidateBinding,
  QuickUseCandidateId,
  QuickUseCandidateDerivationResult,
  QuickUseControlType,
  QuickUseDefinition,
  QuickUseMaterialCandidate,
  QuickUsePromptTemplateDefinition,
  QuickUsePromptVariableCandidate,
  QuickUseSettingCandidate,
  QuickUseValidationIssue,
} from './quickUseTypes';

const PROMPT_VARIABLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

type QuickUseCandidateSource = Pick<
  QuickUseDefinition,
  'replaceableMaterials' | 'promptTemplates'
>;

const encodeBindingPart = (value: string): string => encodeURIComponent(value);

export function createQuickUseCandidateId(
  binding: QuickUseCandidateBinding,
): QuickUseCandidateId {
  const stepId = encodeBindingPart(binding.stepId);
  if (binding.kind === 'workflow_input') {
    return `quick-use:input:${stepId}:${encodeBindingPart(binding.slot)}`;
  }
  if (binding.kind === 'workflow_parameter') {
    return `quick-use:setting:${stepId}:${encodeBindingPart(binding.parameterKey)}`;
  }
  return `quick-use:prompt:${stepId}:${encodeBindingPart(binding.parameterKey)}:${encodeBindingPart(binding.variableKey)}`;
}

export function getQuickUsePromptVariableToken(variableKey: string): string {
  return `{{quick_use.${variableKey}}}`;
}

export function renderQuickUsePromptTemplateDefaults(
  definition: QuickUsePromptTemplateDefinition,
): string {
  return definition.variables.reduce(
    (prompt, variable) => prompt.replaceAll(
      getQuickUsePromptVariableToken(variable.key),
      variable.defaultValue,
    ),
    definition.template,
  );
}

export function getSuggestedQuickUseControl(
  candidate: QuickUseCandidate,
): QuickUseControlType {
  if (candidate.kind === 'material') {
    if (candidate.assetType === 'video') return 'video_upload';
    if (candidate.assetType === 'audio') return 'audio_upload';
    return 'image_upload';
  }
  if (candidate.kind === 'prompt_variable') return candidate.inputKind;
  if (candidate.parameterType === 'boolean') return 'toggle';
  if (candidate.parameterType === 'number') return 'number';
  if (candidate.parameterType === 'enum') return 'select';
  return candidate.maxLength && candidate.maxLength > 160 ? 'textarea' : 'text';
}

export function deriveQuickUseCandidates(
  workflowValue: unknown,
  source: QuickUseCandidateSource,
): QuickUseCandidateDerivationResult {
  const workflowValidation = validateWorkflowDefinition(workflowValue);
  if (!workflowValidation.valid) {
    return {
      valid: false,
      candidates: [],
      issues: workflowValidation.issues.map((issue) => ({
        ...issue,
        path: `$.workflow${issue.path === '$' ? '' : issue.path.slice(1)}`,
      })),
    };
  }

  const workflow = workflowValue as WorkflowDefinition;
  const issues: QuickUseValidationIssue[] = [];
  const candidates: QuickUseCandidate[] = [];
  const stepsById = new Map(workflow.steps.map((step) => [step.id, step]));

  const replaceableIds = validateReplaceableMaterialDefinitions(
    source,
    stepsById,
    issues,
  );
  deriveMaterialCandidates(workflow, replaceableIds, candidates);

  const promptTemplatesByStep = validatePromptTemplateDefinitions(
    source.promptTemplates,
    stepsById,
    issues,
  );
  derivePromptVariableCandidates(workflow, promptTemplatesByStep, candidates);
  deriveSettingCandidates(workflow, candidates);

  const seenCandidateIds = new Set<string>();
  candidates.forEach((candidate) => {
    if (seenCandidateIds.has(candidate.id)) {
      issues.push({
        path: '$.candidates',
        code: 'duplicate_candidate_id',
        message: `Candidate id is duplicated: ${candidate.id}.`,
      });
    }
    seenCandidateIds.add(candidate.id);
  });

  return {
    valid: issues.length === 0,
    candidates,
    issues,
  };
}

function validateReplaceableMaterialDefinitions(
  source: QuickUseCandidateSource,
  stepsById: Map<string, WorkflowStep>,
  issues: QuickUseValidationIssue[],
): Set<string> {
  const validIds = new Set<string>();
  const seenIds = new Set<string>();

  source.replaceableMaterials.forEach((definition, index) => {
    const path = `$.replaceableMaterials[${index}]`;
    const { binding } = definition;
    const candidateId = createQuickUseCandidateId(binding);
    if (seenIds.has(candidateId)) {
      issues.push({
        path,
        code: 'duplicate_replaceable_material',
        message: `Replaceable workflow input is duplicated: ${candidateId}.`,
      });
      return;
    }
    seenIds.add(candidateId);

    const step = stepsById.get(binding.stepId);
    if (!step) {
      issues.push({
        path: `${path}.binding.stepId`,
        code: 'unknown_step',
        message: `Workflow step does not exist: ${binding.stepId}.`,
      });
      return;
    }

    const input = step.inputs.find((candidate) => candidate.slot === binding.slot);
    if (!input) {
      issues.push({
        path: `${path}.binding.slot`,
        code: 'unknown_input_slot',
        message: `Workflow input slot does not exist on ${step.id}: ${binding.slot}.`,
      });
      return;
    }

    const capability = getWorkflowCapability(step.capability);
    const slot = capability.inputs.find((candidate) => candidate.key === binding.slot);
    if (!slot?.allowedSources.includes('user_upload')) {
      issues.push({
        path: `${path}.binding.slot`,
        code: 'user_upload_not_supported',
        message: `Workflow input does not support user uploads: ${binding.slot}.`,
      });
      return;
    }

    if (input.source === 'previous_step') {
      issues.push({
        path: `${path}.binding.slot`,
        code: 'previous_step_input_not_replaceable',
        message: `A previous-step binding cannot be marked as a replaceable material: ${binding.slot}.`,
      });
      return;
    }

    validIds.add(candidateId);
  });
  return validIds;
}

function deriveMaterialCandidates(
  workflow: WorkflowDefinition,
  replaceableIds: Set<string>,
  candidates: QuickUseCandidate[],
): void {
  workflow.steps.forEach((step) => {
    const capability = getWorkflowCapability(step.capability);
    step.inputs.forEach((input) => {
      const binding = {
        kind: 'workflow_input' as const,
        stepId: step.id,
        slot: input.slot,
      };
      const id = createQuickUseCandidateId(binding);
      if (!replaceableIds.has(id)) return;
      const slot = capability.inputs.find((candidate) => candidate.key === input.slot);
      if (!slot) return;

      const candidate: QuickUseMaterialCandidate = {
        id,
        kind: 'material',
        binding,
        stepId: step.id,
        stepTitle: step.title,
        capability: step.capability,
        capabilityVersion: step.capabilityVersion,
        label: slot.label,
        required: input.required || slot.required,
        assetType: slot.assetType,
        acceptedMimeTypes: [...slot.acceptedMimeTypes],
        maxCount: slot.maxCount,
      };
      if (input.source === 'template_asset' && input.templateAssetId) {
        candidate.defaultTemplateAssetId = input.templateAssetId;
      }
      candidates.push(candidate);
    });
  });
}

function validatePromptTemplateDefinitions(
  definitions: QuickUsePromptTemplateDefinition[],
  stepsById: Map<string, WorkflowStep>,
  issues: QuickUseValidationIssue[],
): Map<string, QuickUsePromptTemplateDefinition[]> {
  const byStep = new Map<string, QuickUsePromptTemplateDefinition[]>();
  const seenBindings = new Set<string>();

  definitions.forEach((definition, templateIndex) => {
    const path = `$.promptTemplates[${templateIndex}]`;
    const step = stepsById.get(definition.stepId);
    if (!step) {
      issues.push({
        path: `${path}.stepId`,
        code: 'unknown_step',
        message: `Workflow step does not exist: ${definition.stepId}.`,
      });
      return;
    }

    const parameterBindingId = createQuickUseCandidateId({
      kind: 'workflow_parameter',
      stepId: step.id,
      parameterKey: definition.parameterKey,
    });
    if (seenBindings.has(parameterBindingId)) {
      issues.push({
        path,
        code: 'duplicate_prompt_template',
        message: `Prompt template is duplicated for ${step.id}.${definition.parameterKey}.`,
      });
      return;
    }
    seenBindings.add(parameterBindingId);

    const capability = getWorkflowCapability(step.capability);
    const parameter = capability.parameters.find(
      (candidate) => candidate.key === definition.parameterKey,
    );
    if (!parameter || parameter.type !== 'string' || !parameter.editable) {
      issues.push({
        path: `${path}.parameterKey`,
        code: 'invalid_prompt_parameter',
        message: `Parameter is not an editable string: ${definition.parameterKey}.`,
      });
      return;
    }

    if (definition.variables.length === 0) {
      issues.push({
        path: `${path}.variables`,
        code: 'empty_prompt_variables',
        message: 'A prompt template must contain at least one variable.',
      });
      return;
    }

    const seenVariableKeys = new Set<string>();
    let templateValid = true;
    definition.variables.forEach((variable, variableIndex) => {
      const variablePath = `${path}.variables[${variableIndex}]`;
      if (!PROMPT_VARIABLE_KEY_PATTERN.test(variable.key)) {
        templateValid = false;
        issues.push({
          path: `${variablePath}.key`,
          code: 'invalid_prompt_variable_key',
          message: 'Variable key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.',
        });
      }
      if (seenVariableKeys.has(variable.key)) {
        templateValid = false;
        issues.push({
          path: `${variablePath}.key`,
          code: 'duplicate_prompt_variable_key',
          message: `Prompt variable key is duplicated: ${variable.key}.`,
        });
      }
      seenVariableKeys.add(variable.key);
      if (!variable.label.trim()) {
        templateValid = false;
        issues.push({
          path: `${variablePath}.label`,
          code: 'empty_prompt_variable_label',
          message: 'Prompt variable label is required.',
        });
      }
      const token = getQuickUsePromptVariableToken(variable.key);
      const occurrences = definition.template.split(token).length - 1;
      if (occurrences !== 1) {
        templateValid = false;
        issues.push({
          path: `${variablePath}.key`,
          code: 'invalid_prompt_variable_token_count',
          message: `Prompt template must contain the token ${token} exactly once.`,
        });
      }
    });

    const workflowDefault = step.parameters[definition.parameterKey]
      ?? (definition.parameterKey === 'prompt' ? step.instruction : undefined);
    if (typeof workflowDefault !== 'string') {
      templateValid = false;
      issues.push({
        path: `${path}.parameterKey`,
        code: 'missing_prompt_default',
        message: `Workflow parameter has no string default: ${definition.parameterKey}.`,
      });
    } else if (
      templateValid
      && renderQuickUsePromptTemplateDefaults(definition) !== workflowDefault
    ) {
      templateValid = false;
      issues.push({
        path: `${path}.template`,
        code: 'prompt_default_mismatch',
        message: 'Rendering prompt variable defaults must reproduce the saved workflow parameter.',
      });
    }

    if (!templateValid) return;
    const stepDefinitions = byStep.get(step.id) || [];
    stepDefinitions.push(definition);
    byStep.set(step.id, stepDefinitions);
  });

  return byStep;
}

function derivePromptVariableCandidates(
  workflow: WorkflowDefinition,
  templatesByStep: Map<string, QuickUsePromptTemplateDefinition[]>,
  candidates: QuickUseCandidate[],
): void {
  workflow.steps.forEach((step) => {
    (templatesByStep.get(step.id) || []).forEach((template) => {
      template.variables.forEach((variable) => {
        const binding = {
          kind: 'prompt_variable' as const,
          stepId: step.id,
          parameterKey: template.parameterKey,
          variableKey: variable.key,
        };
        const candidate: QuickUsePromptVariableCandidate = {
          id: createQuickUseCandidateId(binding),
          kind: 'prompt_variable',
          binding,
          stepId: step.id,
          stepTitle: step.title,
          capability: step.capability,
          capabilityVersion: step.capabilityVersion,
          label: variable.label,
          required: variable.required,
          defaultValue: variable.defaultValue,
          inputKind: variable.inputKind,
        };
        candidates.push(candidate);
      });
    });
  });
}

function deriveSettingCandidates(
  workflow: WorkflowDefinition,
  candidates: QuickUseCandidate[],
): void {
  workflow.steps.forEach((step) => {
    const capability = getWorkflowCapability(step.capability);
    capability.parameters
      .filter((parameter) => parameter.editable && parameter.key !== 'prompt')
      .forEach((parameter) => {
        const binding = {
          kind: 'workflow_parameter' as const,
          stepId: step.id,
          parameterKey: parameter.key,
        };
        const workflowValue = step.parameters[parameter.key];
        const defaultValue = isJsonPrimitive(workflowValue)
          ? workflowValue
          : parameter.defaultValue;
        const candidate: QuickUseSettingCandidate = {
          id: createQuickUseCandidateId(binding),
          kind: 'setting',
          binding,
          stepId: step.id,
          stepTitle: step.title,
          capability: step.capability,
          capabilityVersion: step.capabilityVersion,
          label: parameter.label,
          required: parameter.required,
          parameterType: parameter.type,
        };
        if (defaultValue !== undefined) candidate.defaultValue = defaultValue;
        if (parameter.enumValues) candidate.enumValues = [...parameter.enumValues];
        if (parameter.min !== undefined) candidate.min = parameter.min;
        if (parameter.max !== undefined) candidate.max = parameter.max;
        if (parameter.step !== undefined) candidate.step = parameter.step;
        if (parameter.maxLength !== undefined) candidate.maxLength = parameter.maxLength;
        candidates.push(candidate);
      });
  });
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean';
}
