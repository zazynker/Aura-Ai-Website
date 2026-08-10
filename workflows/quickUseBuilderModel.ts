import { getSuggestedQuickUseControl } from './quickUseCandidates';
import type {
  QuickUseBlockDefinition,
  QuickUseCandidate,
  QuickUseCandidateId,
  QuickUseDefinition,
} from './quickUseTypes';

export function createQuickUseBlock(
  candidate: QuickUseCandidate,
  order: number,
  primary: boolean,
): QuickUseBlockDefinition {
  const block: QuickUseBlockDefinition = {
    candidateId: candidate.id,
    order,
    control: getSuggestedQuickUseControl(candidate),
    title: candidate.label,
    subtitle: candidate.stepTitle,
    primary,
    required: candidate.required,
    openByDefault: primary,
  };
  if (candidate.kind !== 'material' && candidate.defaultValue !== undefined) {
    block.defaultValue = candidate.defaultValue;
  }
  return block;
}

export function addQuickUseBlock(
  definition: QuickUseDefinition,
  candidate: QuickUseCandidate,
): QuickUseDefinition {
  if (definition.blocks.some((block) => block.candidateId === candidate.id)) {
    return definition;
  }
  return {
    ...definition,
    blocks: [
      ...definition.blocks,
      createQuickUseBlock(candidate, definition.blocks.length + 1, definition.blocks.length === 0),
    ],
  };
}

export function removeQuickUseBlock(
  definition: QuickUseDefinition,
  candidateId: QuickUseCandidateId,
): QuickUseDefinition {
  const removed = definition.blocks.find((block) => block.candidateId === candidateId);
  const remaining = definition.blocks.filter((block) => block.candidateId !== candidateId);
  const shouldPromote = Boolean(removed?.primary && remaining.length > 0);
  return {
    ...definition,
    blocks: remaining.map((block, index) => ({
      ...block,
      order: index + 1,
      primary: shouldPromote && index === 0 ? true : block.primary,
    })),
  };
}

export function moveQuickUseBlock(
  definition: QuickUseDefinition,
  candidateId: QuickUseCandidateId,
  direction: -1 | 1,
): QuickUseDefinition {
  const index = definition.blocks.findIndex((block) => block.candidateId === candidateId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= definition.blocks.length) return definition;
  const blocks = [...definition.blocks];
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  return {
    ...definition,
    blocks: blocks.map((block, blockIndex) => ({ ...block, order: blockIndex + 1 })),
  };
}

export function updateQuickUseBlock(
  definition: QuickUseDefinition,
  candidateId: QuickUseCandidateId,
  updates: Partial<QuickUseBlockDefinition>,
): QuickUseDefinition {
  return {
    ...definition,
    blocks: definition.blocks.map((block) => {
      if (block.candidateId !== candidateId) {
        return updates.primary ? { ...block, primary: false } : block;
      }
      return {
        ...block,
        ...updates,
        candidateId: block.candidateId,
        order: block.order,
      };
    }),
  };
}
