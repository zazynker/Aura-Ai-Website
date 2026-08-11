import type { CapabilityInputSlot } from './types';

const PROMPT_INPUT_TOKEN_PATTERN = /\{\{input\.([a-z][a-z0-9_]*)\}\}/g;

export const getWorkflowInputPromptToken = (slot: string): string =>
  `{{input.${slot}}}`;

export const getWorkflowInputPromptTokenSlots = (prompt: string): string[] =>
  Array.from(prompt.matchAll(PROMPT_INPUT_TOKEN_PATTERN), (match) => match[1]);

/** Converts stable, serializable slot tokens into provider-facing role names. */
export const resolveWorkflowInputPromptTokens = (
  prompt: string,
  inputs: ReadonlyArray<Pick<CapabilityInputSlot, 'key' | 'label'>>,
): string => {
  const labelBySlot = new Map(inputs.map((input) => [input.key, input.label]));
  return prompt.replace(PROMPT_INPUT_TOKEN_PATTERN, (token, slot: string) => {
    const label = labelBySlot.get(slot);
    return label ? label.toUpperCase() : token;
  });
};
