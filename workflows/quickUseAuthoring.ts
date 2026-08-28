import {
  getQuickUsePromptVariableToken,
  renderQuickUsePromptTemplateDefaults,
} from './quickUseCandidates';
import { createDefaultFinalVideoDefinition } from './quickUseFinalVideo';
import { createDefaultTimelineDefinition } from './quickUseTimeline';
import {
  QUICK_USE_SCHEMA_VERSION,
  type QuickUseDefinition,
  type QuickUseDialogueDefinition,
  type QuickUsePromptInputKind,
  type QuickUsePromptTemplateDefinition,
  type UserReplaceableMaterialDefinition,
} from './quickUseTypes';

const PROMPT_VARIABLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const PROMPT_TOKEN_PATTERN = /\{\{quick_use\.([a-z][a-z0-9_]{0,63})\}\}/g;

export interface AddQuickUsePromptVariableInput {
  stepId: string;
  parameterKey: string;
  workflowPrompt: string;
  selectionStart: number;
  selectionEnd: number;
  key: string;
  label: string;
  inputKind: QuickUsePromptInputKind;
  required: boolean;
  dialogue?: QuickUseDialogueDefinition;
}

interface PromptSegment {
  kind: 'literal' | 'variable';
  templateStart: number;
  templateEnd: number;
  renderedStart: number;
  renderedEnd: number;
}

export function createEmptyQuickUseDefinition(
  title: string,
  subtitle?: string,
): QuickUseDefinition {
  const definition: QuickUseDefinition = {
    schemaVersion: QUICK_USE_SCHEMA_VERSION,
    title: title.trim() || 'Use this template',
    replaceableMaterials: [],
    promptTemplates: [],
    blocks: [],
    finalVideo: createDefaultFinalVideoDefinition(),
    timeline: createDefaultTimelineDefinition(),
    stepReuse: { enabled: true },
  };
  if (subtitle?.trim()) definition.subtitle = subtitle.trim();
  return definition;
}

/**
 * Backfills the fields introduced with the final-video release onto a
 * definition loaded from an older draft, without changing anything the
 * administrator already authored.
 */
export function withQuickUseDefaults(
  definition: QuickUseDefinition,
): QuickUseDefinition {
  if (definition.finalVideo && definition.timeline && definition.stepReuse) return definition;
  return {
    ...definition,
    finalVideo: definition.finalVideo || createDefaultFinalVideoDefinition(),
    timeline: definition.timeline || createDefaultTimelineDefinition(),
    stepReuse: definition.stepReuse || { enabled: true },
  };
}

export function setQuickUseStepReuseEnabled(
  definition: QuickUseDefinition,
  enabled: boolean,
): QuickUseDefinition {
  return { ...definition, stepReuse: { enabled } };
}

export function setQuickUseMaterialReplaceable(
  definition: QuickUseDefinition,
  binding: UserReplaceableMaterialDefinition['binding'],
  replaceable: boolean,
): QuickUseDefinition {
  const matches = (item: UserReplaceableMaterialDefinition): boolean =>
    item.binding.stepId === binding.stepId && item.binding.slot === binding.slot;
  const existing = definition.replaceableMaterials.some(matches);
  if (existing === replaceable) return definition;
  return {
    ...definition,
    replaceableMaterials: replaceable
      ? [...definition.replaceableMaterials, { binding }]
      : definition.replaceableMaterials.filter((item) => !matches(item)),
  };
}

export function addQuickUsePromptVariable(
  definition: QuickUseDefinition,
  input: AddQuickUsePromptVariableInput,
): QuickUseDefinition {
  const key = input.key.trim();
  const label = input.label.trim();
  if (!PROMPT_VARIABLE_KEY_PATTERN.test(key)) {
    throw new Error('Variable key must start with a lowercase letter and use only lowercase letters, numbers, or underscores.');
  }
  if (!label) throw new Error('Variable label is required.');
  if (
    input.selectionStart < 0
    || input.selectionEnd <= input.selectionStart
    || input.selectionEnd > input.workflowPrompt.length
  ) {
    throw new Error('Select prompt text before making it editable.');
  }

  const selectedText = input.workflowPrompt.slice(
    input.selectionStart,
    input.selectionEnd,
  );
  if (!selectedText.trim()) throw new Error('The selected prompt text cannot be empty.');

  const existingIndex = definition.promptTemplates.findIndex(
    (template) =>
      template.stepId === input.stepId
      && template.parameterKey === input.parameterKey,
  );
  const existing = existingIndex >= 0
    ? definition.promptTemplates[existingIndex]
    : undefined;
  const promptTemplate: QuickUsePromptTemplateDefinition = existing
    ? {
        ...existing,
        variables: existing.variables.map((variable) => ({ ...variable })),
      }
    : {
        stepId: input.stepId,
        parameterKey: input.parameterKey,
        template: input.workflowPrompt,
        variables: [],
      };

  if (promptTemplate.variables.some((variable) => variable.key === key)) {
    throw new Error(`Prompt variable key already exists on this step: ${key}.`);
  }
  if (renderQuickUsePromptTemplateDefaults(promptTemplate) !== input.workflowPrompt) {
    throw new Error('The prompt changed after variables were configured. Remove or recreate its variables first.');
  }

  const segments = buildPromptSegments(promptTemplate);
  if (segments.some(
    (segment) => segment.kind === 'variable'
      && input.selectionStart < segment.renderedEnd
      && input.selectionEnd > segment.renderedStart,
  )) {
    throw new Error('Prompt variables cannot overlap. Select text outside an existing variable.');
  }

  const templateStart = mapRenderedBoundaryToTemplate(
    segments,
    input.selectionStart,
  );
  const templateEnd = mapRenderedBoundaryToTemplate(
    segments,
    input.selectionEnd,
  );
  if (templateStart === null || templateEnd === null || templateEnd <= templateStart) {
    throw new Error('The selected prompt range crosses an existing variable.');
  }

  const token = getQuickUsePromptVariableToken(key);
  promptTemplate.template = `${promptTemplate.template.slice(0, templateStart)}${token}${promptTemplate.template.slice(templateEnd)}`;
  promptTemplate.variables.push({
    key,
    label,
    defaultValue: selectedText,
    inputKind: input.inputKind,
    required: input.required,
    ...(input.dialogue ? {
      dialogue: {
        characters: input.dialogue.characters.map((character) => ({ ...character })),
        turns: input.dialogue.turns.map((turn) => ({ ...turn })),
        allowUserRenameCharacters: input.dialogue.allowUserRenameCharacters,
      },
    } : {}),
  });

  const promptTemplates = [...definition.promptTemplates];
  if (existingIndex >= 0) promptTemplates[existingIndex] = promptTemplate;
  else promptTemplates.push(promptTemplate);
  return { ...definition, promptTemplates };
}

export function updateQuickUsePromptVariable(
  definition: QuickUseDefinition,
  stepId: string,
  parameterKey: string,
  variableKey: string,
  updates: Pick<AddQuickUsePromptVariableInput, 'label' | 'inputKind' | 'required' | 'dialogue'> & { defaultValue: string },
): { definition: QuickUseDefinition; workflowPrompt: string } {
  let found = false;
  const promptTemplates = definition.promptTemplates.map((template) => {
    if (template.stepId !== stepId || template.parameterKey !== parameterKey) return template;
    const variables = template.variables.map((variable) => {
      if (variable.key !== variableKey) return variable;
      found = true;
      return {
        ...variable,
        label: updates.label.trim() || variable.label,
        defaultValue: updates.defaultValue,
        inputKind: updates.inputKind,
        required: updates.required,
        dialogue: updates.dialogue ? {
          characters: updates.dialogue.characters.map((character) => ({ ...character })),
          turns: updates.dialogue.turns.map((turn) => ({ ...turn })),
          allowUserRenameCharacters: updates.dialogue.allowUserRenameCharacters,
        } : undefined,
      };
    });
    return { ...template, variables };
  });
  if (!found) throw new Error(`Prompt variable was not found: ${variableKey}.`);
  const nextDefinition = { ...definition, promptTemplates };
  const template = promptTemplates.find((item) => item.stepId === stepId && item.parameterKey === parameterKey);
  if (!template) throw new Error('Prompt template was not found.');
  return {
    definition: nextDefinition,
    workflowPrompt: renderQuickUsePromptTemplateDefaults(template),
  };
}

export function removeQuickUsePromptVariable(
  definition: QuickUseDefinition,
  stepId: string,
  parameterKey: string,
  variableKey: string,
): QuickUseDefinition {
  const promptTemplates = definition.promptTemplates.flatMap((template) => {
    if (template.stepId !== stepId || template.parameterKey !== parameterKey) {
      return [template];
    }
    const variable = template.variables.find((item) => item.key === variableKey);
    if (!variable) return [template];
    const variables = template.variables.filter((item) => item.key !== variableKey);
    if (variables.length === 0) return [];
    return [{
      ...template,
      template: template.template.replace(
        getQuickUsePromptVariableToken(variableKey),
        variable.defaultValue,
      ),
      variables,
    }];
  });
  return { ...definition, promptTemplates };
}

function buildPromptSegments(
  definition: QuickUsePromptTemplateDefinition,
): PromptSegment[] {
  const variables = new Map(
    definition.variables.map((variable) => [variable.key, variable]),
  );
  const segments: PromptSegment[] = [];
  let templateCursor = 0;
  let renderedCursor = 0;
  PROMPT_TOKEN_PATTERN.lastIndex = 0;
  let match = PROMPT_TOKEN_PATTERN.exec(definition.template);
  while (match) {
    if (match.index > templateCursor) {
      const length = match.index - templateCursor;
      segments.push({
        kind: 'literal',
        templateStart: templateCursor,
        templateEnd: match.index,
        renderedStart: renderedCursor,
        renderedEnd: renderedCursor + length,
      });
      renderedCursor += length;
    }
    const variable = variables.get(match[1]);
    if (!variable) throw new Error(`Prompt template references an unknown variable: ${match[1]}.`);
    segments.push({
      kind: 'variable',
      templateStart: match.index,
      templateEnd: match.index + match[0].length,
      renderedStart: renderedCursor,
      renderedEnd: renderedCursor + variable.defaultValue.length,
    });
    renderedCursor += variable.defaultValue.length;
    templateCursor = match.index + match[0].length;
    match = PROMPT_TOKEN_PATTERN.exec(definition.template);
  }
  if (templateCursor < definition.template.length) {
    const length = definition.template.length - templateCursor;
    segments.push({
      kind: 'literal',
      templateStart: templateCursor,
      templateEnd: definition.template.length,
      renderedStart: renderedCursor,
      renderedEnd: renderedCursor + length,
    });
  }
  if (segments.length === 0) {
    segments.push({
      kind: 'literal',
      templateStart: 0,
      templateEnd: 0,
      renderedStart: 0,
      renderedEnd: 0,
    });
  }
  return segments;
}

function mapRenderedBoundaryToTemplate(
  segments: PromptSegment[],
  position: number,
): number | null {
  for (const segment of segments) {
    if (segment.kind === 'literal'
      && position >= segment.renderedStart
      && position <= segment.renderedEnd) {
      return segment.templateStart + position - segment.renderedStart;
    }
    if (segment.kind === 'variable') {
      if (position === segment.renderedStart) return segment.templateStart;
      if (position === segment.renderedEnd) return segment.templateEnd;
      if (position > segment.renderedStart && position < segment.renderedEnd) {
        return null;
      }
    }
  }
  return null;
}
