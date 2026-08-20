import { deriveQuickUseCandidates } from './quickUseCandidates';
import type {
  QuickUseExecutionStep,
  QuickUseExecutionValue,
  QuickUseExecutionValues,
} from './quickUseExecution';
import type {
  QuickUseBlockDefinition,
  QuickUseCandidate,
  QuickUseDefinition,
} from './quickUseTypes';
import type { JsonPrimitive } from './types';

export type QuickUseStepExecutionMode = 'generate' | 'reuse';

export type QuickUseStepExecutionReason =
  | 'reuse_disabled'
  | 'user_modified'
  | 'upstream_regenerated'
  | 'no_template_result'
  | 'result_type_mismatch'
  | 'unchanged';

export interface QuickUseStepExecutionDecision {
  stepId: string;
  order: number;
  mode: QuickUseStepExecutionMode;
  reason: QuickUseStepExecutionReason;
  /** Present only when mode is 'reuse'. */
  reusableUrl?: string;
  reusableType?: 'image' | 'video';
}

export interface QuickUseTemplateStepResult {
  url: string;
  type: 'image' | 'video';
}

export interface ResolveQuickUseStepExecutionParams {
  /** The immutable published workflow the run was locked to. */
  workflow: unknown;
  definition: QuickUseDefinition;
  /** Compiled plan steps. Their `inputs` carry the previous_step wiring. */
  steps: QuickUseExecutionStep[];
  values: QuickUseExecutionValues;
  /** Template demo results keyed by authored step id (`step-N-result` assets). */
  templateStepResults: Readonly<Record<string, QuickUseTemplateStepResult>>;
}

const isExecutionAsset = (value: QuickUseExecutionValue | undefined): boolean => (
  Boolean(value)
  && typeof value === 'object'
  && (value as { kind?: unknown }).kind === 'asset'
);

const candidateFallbackValue = (
  candidate: QuickUseCandidate,
): JsonPrimitive | undefined => {
  if (candidate.kind === 'prompt_variable') return candidate.defaultValue;
  if (candidate.kind === 'setting') return candidate.defaultValue;
  return undefined;
};

/**
 * Decides whether the user actually changed this exposed input.
 *
 * A supplied media file always counts as a change (design decision A):
 * swapping the subject is the product's core promise, so a template clip built
 * around a different person must never be served back as the user's result,
 * even when the prompt is untouched.
 */
export function isQuickUseValueModified(
  block: QuickUseBlockDefinition,
  candidate: QuickUseCandidate,
  value: QuickUseExecutionValue | undefined,
): boolean {
  if (value === undefined) return false;
  if (isExecutionAsset(value)) return true;
  const effectiveDefault = block.defaultValue !== undefined
    ? block.defaultValue
    : candidateFallbackValue(candidate);
  if (value === null) return effectiveDefault !== null && effectiveDefault !== undefined;
  if (effectiveDefault === undefined) return true;
  if (typeof value === 'string' && typeof effectiveDefault === 'string') {
    return value !== effectiveDefault;
  }
  return value !== effectiveDefault;
}

/**
 * Returns the authored step ids the user touched through the Quick Use form.
 */
export function collectModifiedStepIds(
  workflow: unknown,
  definition: QuickUseDefinition,
  values: QuickUseExecutionValues,
): Set<string> {
  const derivation = deriveQuickUseCandidates(workflow, definition);
  const candidates = derivation.candidates as QuickUseCandidate[];
  const candidateById = new Map<string, QuickUseCandidate>(
    candidates.map((candidate) => [candidate.id, candidate] as [string, QuickUseCandidate]),
  );
  const modified = new Set<string>();
  for (const block of definition.blocks) {
    const candidate = candidateById.get(block.candidateId);
    if (!candidate) {
      // A block without a live candidate cannot be proven unchanged, so no
      // step is treated as reusable. Failing closed costs credits; failing
      // open would deliver the template's demo as the user's own result.
      modified.clear();
      candidates.forEach((item) => modified.add(item.stepId));
      return modified;
    }
    if (isQuickUseValueModified(block, candidate, values[block.candidateId])) {
      modified.add(candidate.stepId);
    }
  }
  return modified;
}

/**
 * Resolves, per step and in workflow order, whether the run must call a
 * provider or may serve the template's own demo result.
 *
 * A step is reusable only when all three hold:
 *   1. reuse is enabled for this published version,
 *   2. the user changed nothing bound to that step, and
 *   3. every upstream step it consumes was itself reused.
 *
 * Rule 3 is what keeps the material chain honest: as soon as one step is
 * regenerated, everything downstream of it must be regenerated too, otherwise
 * the delivered clips would not belong to the same take.
 */
export function resolveQuickUseStepExecution(
  params: ResolveQuickUseStepExecutionParams,
): Map<string, QuickUseStepExecutionDecision> {
  const { definition, steps, templateStepResults, values, workflow } = params;
  const decisions = new Map<string, QuickUseStepExecutionDecision>();
  const ordered = [...steps].sort((left, right) => left.order - right.order);
  const reuseEnabled = definition.stepReuse?.enabled !== false;

  if (!reuseEnabled) {
    ordered.forEach((step) => decisions.set(step.id, {
      stepId: step.id,
      order: step.order,
      mode: 'generate',
      reason: 'reuse_disabled',
    }));
    return decisions;
  }

  const modifiedStepIds = collectModifiedStepIds(workflow, definition, values);

  for (const step of ordered) {
    const upstreamRegenerated = step.inputs.some((input) => (
      input.source === 'previous_step'
      && Boolean(input.fromStepId)
      && decisions.get(input.fromStepId!)?.mode !== 'reuse'
    ));
    const templateResult = templateStepResults[step.id];

    let reason: QuickUseStepExecutionReason = 'unchanged';
    if (modifiedStepIds.has(step.id)) reason = 'user_modified';
    else if (upstreamRegenerated) reason = 'upstream_regenerated';
    else if (!templateResult?.url) reason = 'no_template_result';
    else if (templateResult.type !== step.output.assetType) reason = 'result_type_mismatch';

    decisions.set(step.id, reason === 'unchanged'
      ? {
          stepId: step.id,
          order: step.order,
          mode: 'reuse',
          reason,
          reusableUrl: templateResult!.url,
          reusableType: templateResult!.type,
        }
      : {
          stepId: step.id,
          order: step.order,
          mode: 'generate',
          reason,
        });
  }

  return decisions;
}

export function countGeneratedSteps(
  decisions: ReadonlyMap<string, QuickUseStepExecutionDecision>,
): number {
  let count = 0;
  decisions.forEach((decision) => {
    if (decision.mode === 'generate') count += 1;
  });
  return count;
}
