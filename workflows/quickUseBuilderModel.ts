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
      createQuickUseBlock(
        candidate,
        definition.blocks.length + 1,
        candidate.kind === 'material' && !definition.blocks.some((block) => block.primary),
      ),
    ],
  };
}

export function removeQuickUseBlock(
  definition: QuickUseDefinition,
  candidateId: QuickUseCandidateId,
): QuickUseDefinition {
  const remaining = definition.blocks.filter((block) => block.candidateId !== candidateId);
  return {
    ...definition,
    blocks: remaining.map((block, index) => ({
      ...block,
      order: index + 1,
    })),
  };
}

export function reorderQuickUseBlock(
  definition: QuickUseDefinition,
  candidateId: QuickUseCandidateId,
  targetCandidateId: QuickUseCandidateId,
): QuickUseDefinition {
  const sourceIndex = definition.blocks.findIndex((block) => block.candidateId === candidateId);
  const targetIndex = definition.blocks.findIndex((block) => block.candidateId === targetCandidateId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return definition;
  const blocks = [...definition.blocks];
  const [source] = blocks.splice(sourceIndex, 1);
  blocks.splice(targetIndex, 0, source);
  return {
    ...definition,
    blocks: blocks.map((block, index) => ({ ...block, order: index + 1 })),
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
