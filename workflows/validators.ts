import { WORKFLOW_CAPABILITIES } from './registry';
import {
  WORKFLOW_MAX_INSTRUCTION_LENGTH,
  WORKFLOW_MAX_STEP_ID_LENGTH,
  WORKFLOW_MAX_STEPS,
  WORKFLOW_MAX_TITLE_LENGTH,
  WORKFLOW_MIN_STEPS,
  WORKFLOW_SCHEMA_VERSION,
} from './schema';
import {
  CapabilityParameterDefinition,
  JsonObject,
  JsonPrimitive,
  WorkflowDefinition,
  WorkflowStep,
  WorkflowValidationIssue,
  WorkflowValidationResult,
} from './types';

const STEP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function validateWorkflowDefinition(
  workflow: unknown,
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];

  if (!isRecord(workflow)) {
    return invalid('$', 'invalid_type', 'Workflow must be an object.');
  }

  if (workflow.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    issues.push({
      path: '$.schemaVersion',
      code: 'unsupported_schema_version',
      message: `Schema version must be ${WORKFLOW_SCHEMA_VERSION}.`,
    });
  }

  if (!Array.isArray(workflow.steps)) {
    issues.push({
      path: '$.steps',
      code: 'invalid_type',
      message: 'Steps must be an array.',
    });
    return { valid: false, issues };
  }

  // Keep the array narrowing stable inside callbacks.
  const steps = workflow.steps;

  if (
    steps.length < WORKFLOW_MIN_STEPS ||
    steps.length > WORKFLOW_MAX_STEPS
  ) {
    issues.push({
      path: '$.steps',
      code: 'invalid_step_count',
      message: `Workflow must contain ${WORKFLOW_MIN_STEPS}-${WORKFLOW_MAX_STEPS} steps.`,
    });
  }

  const seenStepIds = new Set<string>();
  const stepsById = new Map<string, WorkflowStep>();

  steps.forEach((step, index) => {
    const path = `$.steps[${index}]`;
    if (!isRecord(step)) {
      issues.push({
        path,
        code: 'invalid_type',
        message: 'Step must be an object.',
      });
      return;
    }

    validateStepShape(step, index, issues);

    if (typeof step.id === 'string') {
      if (seenStepIds.has(step.id)) {
        issues.push({
          path: `${path}.id`,
          code: 'duplicate_step_id',
          message: `Duplicate step id: ${step.id}.`,
        });
      } else {
        seenStepIds.add(step.id);
        stepsById.set(step.id, step as unknown as WorkflowStep);
      }
    }
  });

  steps.forEach((step, index) => {
    if (!isRecord(step)) return;
    validateStepAgainstCapability(
      step,
      index,
      steps,
      stepsById,
      issues,
    );
  });

  return { valid: issues.length === 0, issues };
}

export function assertValidWorkflowDefinition(
  workflow: unknown,
): asserts workflow is WorkflowDefinition {
  const result = validateWorkflowDefinition(workflow);
  if (!result.valid) {
    const summary = result.issues
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid workflow definition. ${summary}`);
  }
}

function validateStepShape(
  step: Record<string, unknown>,
  index: number,
  issues: WorkflowValidationIssue[],
): void {
  const path = `$.steps[${index}]`;

  if (
    typeof step.id !== 'string' ||
    step.id.length < 1 ||
    step.id.length > WORKFLOW_MAX_STEP_ID_LENGTH ||
    !STEP_ID_PATTERN.test(step.id)
  ) {
    issues.push({
      path: `${path}.id`,
      code: 'invalid_step_id',
      message: 'Step id must use only letters, numbers, underscores, and hyphens.',
    });
  }

  if (!Number.isInteger(step.order) || step.order !== index + 1) {
    issues.push({
      path: `${path}.order`,
      code: 'invalid_step_order',
      message: `Step order must be ${index + 1}.`,
    });
  }

  if (
    typeof step.title !== 'string' ||
    step.title.trim().length < 1 ||
    step.title.length > WORKFLOW_MAX_TITLE_LENGTH
  ) {
    issues.push({
      path: `${path}.title`,
      code: 'invalid_title',
      message: `Step title is required and must be at most ${WORKFLOW_MAX_TITLE_LENGTH} characters.`,
    });
  }

  if (
    typeof step.instruction !== 'string' ||
    step.instruction.length > WORKFLOW_MAX_INSTRUCTION_LENGTH
  ) {
    issues.push({
      path: `${path}.instruction`,
      code: 'invalid_instruction',
      message: `Instruction must be at most ${WORKFLOW_MAX_INSTRUCTION_LENGTH} characters.`,
    });
  }

  if (!Array.isArray(step.inputs)) {
    issues.push({
      path: `${path}.inputs`,
      code: 'invalid_type',
      message: 'Inputs must be an array.',
    });
  }

  if (!isRecord(step.parameters)) {
    issues.push({
      path: `${path}.parameters`,
      code: 'invalid_type',
      message: 'Parameters must be an object.',
    });
  }

  if (!isRecord(step.output)) {
    issues.push({
      path: `${path}.output`,
      code: 'invalid_type',
      message: 'Output must be an object.',
    });
  }
}

function validateStepAgainstCapability(
  step: Record<string, unknown>,
  index: number,
  allSteps: unknown[],
  stepsById: Map<string, WorkflowStep>,
  issues: WorkflowValidationIssue[],
): void {
  const path = `$.steps[${index}]`;
  if (typeof step.capability !== 'string') {
    issues.push({
      path: `${path}.capability`,
      code: 'invalid_capability',
      message: 'Capability is required.',
    });
    return;
  }

  const capability = WORKFLOW_CAPABILITIES[
    step.capability as keyof typeof WORKFLOW_CAPABILITIES
  ];

  if (!capability || !capability.enabledForTemplates) {
    issues.push({
      path: `${path}.capability`,
      code: 'unknown_capability',
      message: `Capability is not available for templates: ${step.capability}.`,
    });
    return;
  }

  if (step.capabilityVersion !== capability.version) {
    issues.push({
      path: `${path}.capabilityVersion`,
      code: 'unsupported_capability_version',
      message: `Capability version must be ${capability.version}.`,
    });
  }

  validateInputs(step, index, allSteps, stepsById, capability, issues);
  validateParameters(step.parameters, path, capability.parameters, issues);

  if (isRecord(step.output)) {
    if (step.output.key !== capability.output.key) {
      issues.push({
        path: `${path}.output.key`,
        code: 'invalid_output_key',
        message: `Output key must be ${capability.output.key}.`,
      });
    }
    if (step.output.assetType !== capability.output.assetType) {
      issues.push({
        path: `${path}.output.assetType`,
        code: 'invalid_output_type',
        message: `Output asset type must be ${capability.output.assetType}.`,
      });
    }
  }
}

function validateInputs(
  step: Record<string, unknown>,
  index: number,
  allSteps: unknown[],
  stepsById: Map<string, WorkflowStep>,
  capability: (typeof WORKFLOW_CAPABILITIES)[keyof typeof WORKFLOW_CAPABILITIES],
  issues: WorkflowValidationIssue[],
): void {
  if (!Array.isArray(step.inputs)) return;
  const path = `$.steps[${index}].inputs`;
  const slotMap = new Map(capability.inputs.map((slot) => [slot.key, slot]));
  const seenSlots = new Set<string>();

  step.inputs.forEach((input, inputIndex) => {
    const inputPath = `${path}[${inputIndex}]`;
    if (!isRecord(input) || typeof input.slot !== 'string') {
      issues.push({
        path: inputPath,
        code: 'invalid_input',
        message: 'Input must contain a slot.',
      });
      return;
    }

    const slot = slotMap.get(input.slot);
    if (!slot) {
      issues.push({
        path: `${inputPath}.slot`,
        code: 'unknown_input_slot',
        message: `Unknown input slot: ${input.slot}.`,
      });
      return;
    }

    if (seenSlots.has(input.slot)) {
      issues.push({
        path: `${inputPath}.slot`,
        code: 'duplicate_input_slot',
        message: `Input slot is duplicated: ${input.slot}.`,
      });
    }
    seenSlots.add(input.slot);

    if (input.assetType !== slot.assetType) {
      issues.push({
        path: `${inputPath}.assetType`,
        code: 'invalid_input_type',
        message: `Input asset type must be ${slot.assetType}.`,
      });
    }

    if (
      typeof input.source !== 'string' ||
      !slot.allowedSources.includes(input.source as never)
    ) {
      issues.push({
        path: `${inputPath}.source`,
        code: 'invalid_input_source',
        message: `Input source is not allowed for ${input.slot}.`,
      });
      return;
    }

    if (input.source === 'previous_step') {
      if (typeof input.fromStepId !== 'string') {
        issues.push({
          path: `${inputPath}.fromStepId`,
          code: 'missing_previous_step',
          message: 'Previous-step input requires fromStepId.',
        });
        return;
      }

      const previousStep = stepsById.get(input.fromStepId);
      const previousIndex = allSteps.findIndex(
        (candidate) => isRecord(candidate) && candidate.id === input.fromStepId,
      );
      if (!previousStep || previousIndex < 0 || previousIndex >= index) {
        issues.push({
          path: `${inputPath}.fromStepId`,
          code: 'invalid_previous_step',
          message: 'Input must reference an earlier step.',
        });
      } else if (previousStep.output.assetType !== slot.assetType) {
        issues.push({
          path: `${inputPath}.fromStepId`,
          code: 'previous_step_type_mismatch',
          message: `Previous step does not output ${slot.assetType}.`,
        });
      }
    }

    if (
      input.source === 'template_asset' &&
      (typeof input.templateAssetId !== 'string' || !input.templateAssetId)
    ) {
      issues.push({
        path: `${inputPath}.templateAssetId`,
        code: 'missing_template_asset',
        message: 'Template-asset input requires templateAssetId.',
      });
    }
  });

  capability.inputs
    .filter((slot) => slot.required)
    .forEach((slot) => {
      if (!seenSlots.has(slot.key)) {
        issues.push({
          path,
          code: 'missing_required_input',
          message: `Required input is missing: ${slot.key}.`,
        });
      }
    });
}

function validateParameters(
  value: unknown,
  stepPath: string,
  definitions: CapabilityParameterDefinition[],
  issues: WorkflowValidationIssue[],
): void {
  if (!isRecord(value)) return;
  const parameters = value as JsonObject;
  const definitionMap = new Map(
    definitions.map((definition) => [definition.key, definition]),
  );

  Object.keys(parameters).forEach((key) => {
    if (!definitionMap.has(key)) {
      issues.push({
        path: `${stepPath}.parameters.${key}`,
        code: 'unknown_parameter',
        message: `Unknown capability parameter: ${key}.`,
      });
    }
  });

  definitions.forEach((definition) => {
    const parameter = parameters[definition.key];
    const parameterPath = `${stepPath}.parameters.${definition.key}`;
    if (parameter === undefined || parameter === null) {
      if (definition.required) {
        issues.push({
          path: parameterPath,
          code: 'missing_required_parameter',
          message: `Required parameter is missing: ${definition.key}.`,
        });
      }
      return;
    }

    validateParameterValue(parameter, parameterPath, definition, issues);
  });
}

function validateParameterValue(
  value: unknown,
  path: string,
  definition: CapabilityParameterDefinition,
  issues: WorkflowValidationIssue[],
): void {
  const expectedType = definition.type === 'enum' ? null : definition.type;
  if (expectedType && typeof value !== expectedType) {
    issues.push({
      path,
      code: 'invalid_parameter_type',
      message: `${definition.key} must be a ${expectedType}.`,
    });
    return;
  }

  if (
    definition.type === 'enum' &&
    !definition.enumValues?.includes(value as JsonPrimitive)
  ) {
    issues.push({
      path,
      code: 'invalid_parameter_value',
      message: `${definition.key} is not an allowed value.`,
    });
    return;
  }

  if (typeof value === 'string' && definition.maxLength) {
    if (value.length > definition.maxLength) {
      issues.push({
        path,
        code: 'parameter_too_long',
        message: `${definition.key} must be at most ${definition.maxLength} characters.`,
      });
    }
    if (definition.required && !value.trim()) {
      issues.push({
        path,
        code: 'empty_required_parameter',
        message: `${definition.key} cannot be empty.`,
      });
    }
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      issues.push({
        path,
        code: 'invalid_number',
        message: `${definition.key} must be finite.`,
      });
      return;
    }
    if (definition.min !== undefined && value < definition.min) {
      issues.push({
        path,
        code: 'number_too_small',
        message: `${definition.key} must be at least ${definition.min}.`,
      });
    }
    if (definition.max !== undefined && value > definition.max) {
      issues.push({
        path,
        code: 'number_too_large',
        message: `${definition.key} must be at most ${definition.max}.`,
      });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(
  path: string,
  code: string,
  message: string,
): WorkflowValidationResult {
  return { valid: false, issues: [{ path, code, message }] };
}
