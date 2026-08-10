import { deriveQuickUseCandidates, getQuickUsePromptVariableToken } from './quickUseCandidates';
import type {
  QuickUseCandidateId,
  QuickUseDefinition,
} from './quickUseTypes';
import { assertValidQuickUseDefinition } from './quickUseValidators';
import type {
  JsonObject,
  JsonPrimitive,
  WorkflowAssetType,
  WorkflowCapabilityKey,
  WorkflowDefinition,
} from './types';

export interface QuickUseExecutionAsset {
  kind: 'asset';
  assetType: WorkflowAssetType;
  url: string;
}

export type QuickUseExecutionValue = JsonPrimitive | QuickUseExecutionAsset;
export type QuickUseExecutionValues = Partial<Record<QuickUseCandidateId, QuickUseExecutionValue>>;

export interface QuickUseExecutionInput {
  slot: string;
  assetType: WorkflowAssetType;
  source: 'user_upload' | 'previous_step' | 'template_asset';
  url?: string;
  fromStepId?: string;
  outputKey?: string;
  templateAssetId?: string;
}

export interface QuickUseExecutionStep {
  id: string;
  order: number;
  capability: WorkflowCapabilityKey;
  capabilityVersion: number;
  title: string;
  instruction: string;
  parameters: JsonObject;
  inputs: QuickUseExecutionInput[];
  output: {
    key: string;
    assetType: 'image' | 'video';
  };
}

export interface QuickUseExecutionPlan {
  schemaVersion: number;
  steps: QuickUseExecutionStep[];
}

const isExecutionAsset = (value: QuickUseExecutionValue | undefined): value is QuickUseExecutionAsset => (
  Boolean(value)
  && typeof value === 'object'
  && (value as QuickUseExecutionAsset).kind === 'asset'
  && typeof (value as QuickUseExecutionAsset).url === 'string'
);

const getPrimitiveValue = (
  candidateId: QuickUseCandidateId,
  definition: QuickUseDefinition,
  values: QuickUseExecutionValues,
  fallback: JsonPrimitive | undefined,
): JsonPrimitive | undefined => {
  const supplied = values[candidateId];
  if (supplied === null) return null;
  if (typeof supplied === 'string') return supplied;
  if (typeof supplied === 'number') return supplied;
  if (typeof supplied === 'boolean') return supplied;
  const blockDefault = definition.blocks.find((block) => block.candidateId === candidateId)?.defaultValue;
  return blockDefault !== undefined ? blockDefault : fallback;
};

/**
 * Compiles one immutable published workflow version with Quick Use values.
 * The returned plan is serializable and contains no React or browser types.
 */
export function compileQuickUseExecutionPlan(
  workflow: WorkflowDefinition,
  definition: QuickUseDefinition,
  values: QuickUseExecutionValues,
  templateAssetUrls: Readonly<Record<string, string>>,
): QuickUseExecutionPlan {
  assertValidQuickUseDefinition(workflow, definition);
  const derivation = deriveQuickUseCandidates(workflow, definition);
  if (!derivation.valid) throw new Error('Quick Use candidates could not be derived from this workflow.');

  const exposedIds = new Set(definition.blocks.map((block) => block.candidateId));
  const candidateById = new Map(derivation.candidates.map((candidate) => [candidate.id, candidate]));

  for (const suppliedId of Object.keys(values) as QuickUseCandidateId[]) {
    if (!exposedIds.has(suppliedId) || !candidateById.has(suppliedId)) {
      throw new Error(`Quick Use value is not exposed by this version: ${suppliedId}.`);
    }
  }

  return {
    schemaVersion: workflow.schemaVersion,
    steps: workflow.steps.map((step) => {
      const parameters: JsonObject = { ...step.parameters };
      let instruction = step.instruction;

      definition.promptTemplates
        .filter((template) => template.stepId === step.id)
        .forEach((template) => {
          const rendered = template.variables.reduce((prompt, variable) => {
            const candidateId = derivation.candidates.find((candidate) => (
              candidate.kind === 'prompt_variable'
              && candidate.binding.stepId === step.id
              && candidate.binding.parameterKey === template.parameterKey
              && candidate.binding.variableKey === variable.key
            ))?.id;
            if (!candidateId) throw new Error(`Prompt variable binding is missing: ${variable.key}.`);
            const value = getPrimitiveValue(candidateId, definition, values, variable.defaultValue);
            return prompt.replaceAll(getQuickUsePromptVariableToken(variable.key), String(value ?? ''));
          }, template.template);
          parameters[template.parameterKey] = rendered;
          if (template.parameterKey === 'prompt') instruction = rendered;
        });

      derivation.candidates.forEach((candidate) => {
        if (candidate.kind !== 'setting' || candidate.stepId !== step.id || !exposedIds.has(candidate.id)) return;
        const value = getPrimitiveValue(candidate.id, definition, values, candidate.defaultValue);
        if (value !== undefined) parameters[candidate.binding.parameterKey] = value;
      });

      const inputs = step.inputs.map((input): QuickUseExecutionInput => {
        const materialCandidate = derivation.candidates.find((candidate) => (
          candidate.kind === 'material'
          && candidate.binding.stepId === step.id
          && candidate.binding.slot === input.slot
        ));
        const replacement = materialCandidate && exposedIds.has(materialCandidate.id)
          ? values[materialCandidate.id]
          : undefined;
        if (materialCandidate && isExecutionAsset(replacement)) {
          if (replacement.assetType !== input.assetType) {
            throw new Error(`Quick Use upload type does not match ${step.id}.${input.slot}.`);
          }
          return {
            slot: input.slot,
            assetType: input.assetType,
            source: 'user_upload',
            url: replacement.url,
          };
        }
        if (input.source === 'previous_step') {
          return {
            slot: input.slot,
            assetType: input.assetType,
            source: input.source,
            fromStepId: input.fromStepId,
            outputKey: input.outputKey,
          };
        }
        if (input.source === 'template_asset' && input.templateAssetId) {
          const url = templateAssetUrls[input.templateAssetId];
          if (!url) throw new Error(`Template asset URL is unavailable for ${step.id}.${input.slot}.`);
          return {
            slot: input.slot,
            assetType: input.assetType,
            source: input.source,
            templateAssetId: input.templateAssetId,
            url,
          };
        }
        if (input.required) {
          throw new Error(`Required Quick Use input is missing: ${step.id}.${input.slot}.`);
        }
        return {
          slot: input.slot,
          assetType: input.assetType,
          source: input.source,
        };
      });

      return {
        id: step.id,
        order: step.order,
        capability: step.capability,
        capabilityVersion: step.capabilityVersion,
        title: step.title,
        instruction,
        parameters,
        inputs,
        output: {
          key: step.output.key,
          assetType: step.output.assetType,
        },
      };
    }),
  };
}
