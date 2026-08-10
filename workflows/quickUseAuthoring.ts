import {
  getQuickUsePromptVariableToken,
  renderQuickUsePromptTemplateDefaults,
} from './quickUseCandidates';
import {
  QUICK_USE_SCHEMA_VERSION,
  type QuickUseDefinition,
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
  };
  if (subtitle?.trim()) definition.subtitle = subtitle.trim();
  return definition;
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
  });

  const promptTemplates = [...definition.promptTemplates];
  if (existingIndex >= 0) promptTemplates[existingIndex] = promptTemplate;
  else promptTemplates.push(promptTemplate);
  return { ...definition, promptTemplates };
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
