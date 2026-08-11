import type { CapabilityInputSlot } from './types';

const PROMPT_INPUT_TOKEN_PATTERN = /\{\{input\.([a-z][a-z0-9_]*)\}\}/g;

export const getWorkflowInputPromptToken = (slot: string): string =>
  `{{input.${slot}}}`;

export const getWorkflowInputPromptTokenSlots = (prompt: string): string[] =>
  Array.from(prompt.matchAll(PROMPT_INPUT_TOKEN_PATTERN), (match) => match[1]);

/** Converts stable slot tokens into provider-facing positional asset names. */
export const resolveWorkflowInputPromptTokens = (
  prompt: string,
  inputs: ReadonlyArray<Pick<CapabilityInputSlot, 'key' | 'assetType'>>,
): string => {
  const assetCounts = { image: 0, video: 0, audio: 0 };
  const nameBySlot = new Map(inputs.map((input) => {
    assetCounts[input.assetType] += 1;
    return [input.key, `${input.assetType}${assetCounts[input.assetType]}`] as const;
  }));
  return prompt.replace(PROMPT_INPUT_TOKEN_PATTERN, (token, slot: string) => {
    return nameBySlot.get(slot) || token;
  });
};
