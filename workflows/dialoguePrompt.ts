import type {
  QuickUseDialogueCharacterDefinition,
  QuickUseDialogueDefinition,
  QuickUseDialogueTurnDefinition,
  QuickUseDialogueValue,
} from './quickUseTypes';

export interface DialoguePromptLine {
  id: `dialogue-line:${number}`;
  speaker: string;
  cue: string;
  text: string;
  lineStart: number;
  lineEnd: number;
  speakerStart: number;
  speakerEnd: number;
  textStart: number;
  textEnd: number;
}

export interface DialoguePromptRange {
  start: number;
  end: number;
  lineCount: number;
}

const DIALOGUE_VALUE_PREFIX = 'lazora-dialogue-v1:';
const SPEECH_CUE_PATTERN = '(asks?|replies?|answers?|says?|responds?|shouts?|whispers?|follows\\s+up)';

const cleanName = (value: string): string => value.replace(/[\r\n:“”"]/g, ' ').trim().slice(0, 80);
const cleanText = (value: string): string => value.replace(/[\r\n“”"]/g, "'").trim().slice(0, 240);

const normalizeSpeaker = (value: string): string => {
  const normalized = cleanName(value).replace(/^the\s+/i, '');
  return normalized || 'Character';
};

const parseSpeakerAndCue = (
  prefix: string,
): { speaker: string; cue: string; speakerOffset: number; speakerLength: number } | null => {
  const normalized = prefix.trim().replace(/,\s*$/, '');
  const narrativeMatch = normalized.match(new RegExp(`^(?:the\\s+)?(.+?)\\s+(${SPEECH_CUE_PATTERN})$`, 'i'));
  if (narrativeMatch) {
    const speakerOffset = prefix.toLowerCase().indexOf(narrativeMatch[1].toLowerCase());
    return {
      speaker: normalizeSpeaker(narrativeMatch[1]),
      cue: narrativeMatch[2].toLowerCase().replace(/\s+/g, ' '),
      speakerOffset: Math.max(0, speakerOffset),
      speakerLength: narrativeMatch[1].length,
    };
  }
  const scriptMatch = prefix.match(/^(\s*)(.+?)(\s*:\s*)$/);
  if (!scriptMatch) return null;
  return {
    speaker: normalizeSpeaker(scriptMatch[2]),
    cue: 'says',
    speakerOffset: scriptMatch[1].length,
    speakerLength: scriptMatch[2].length,
  };
};

/** Backward-compatible parser for older free-form dialogue prompt variables. */
export function parseDialoguePrompt(value: string): DialoguePromptLine[] {
  const lines: DialoguePromptLine[] = [];
  const linePattern = /[^\r\n]*(?:\r?\n|$)/g;
  let lineMatch: RegExpExecArray | null;
  while ((lineMatch = linePattern.exec(value)) !== null) {
    const rawLine = lineMatch[0].replace(/\r?\n$/, '');
    if (!rawLine && lineMatch.index >= value.length) break;
    const quoteMatch = /[“"]([^”"\r\n]+)[”"]/.exec(rawLine);
    if (!quoteMatch || quoteMatch.index === undefined) continue;
    const metadata = parseSpeakerAndCue(rawLine.slice(0, quoteMatch.index));
    if (!metadata) continue;
    const speakerStart = lineMatch.index + metadata.speakerOffset;
    const textStart = lineMatch.index + quoteMatch.index + 1;
    lines.push({
      id: `dialogue-line:${lineMatch.index}`,
      speaker: metadata.speaker,
      cue: metadata.cue,
      text: quoteMatch[1],
      lineStart: lineMatch.index,
      lineEnd: lineMatch.index + rawLine.length,
      speakerStart,
      speakerEnd: speakerStart + metadata.speakerLength,
      textStart,
      textEnd: textStart + quoteMatch[1].length,
    });
  }
  return lines;
}

export function findDialoguePromptRange(value: string): DialoguePromptRange | null {
  const lines = parseDialoguePrompt(value);
  if (lines.length === 0) return null;
  const first = lines[0];
  const last = lines[lines.length - 1];
  const start = value.lastIndexOf('\n', Math.max(0, first.textStart - 1)) + 1;
  const nextLineBreak = value.indexOf('\n', last.textEnd);
  return { start, end: nextLineBreak < 0 ? value.length : nextLineBreak, lineCount: lines.length };
}

export function nextDialogueCharacterId(
  characters: ReadonlyArray<Pick<QuickUseDialogueCharacterDefinition, 'id'>>,
): string {
  const used = new Set(characters.map((character) => character.id));
  let ordinal = 1;
  while (used.has(`character_${ordinal}`)) ordinal += 1;
  return `character_${ordinal}`;
}

export function nextDialogueTurnId(
  turns: ReadonlyArray<Pick<QuickUseDialogueTurnDefinition, 'id'>>,
): string {
  const used = new Set(turns.map((turn) => turn.id));
  let ordinal = 1;
  while (used.has(`turn_${ordinal}`)) ordinal += 1;
  return `turn_${ordinal}`;
}

export function createDefaultDialogueDefinition(): QuickUseDialogueDefinition {
  return {
    characters: [
      { id: 'character_1', defaultName: 'Character 1' },
      { id: 'character_2', defaultName: 'Character 2' },
    ],
    turns: [
      { id: 'turn_1', characterId: 'character_1', text: 'Enter dialogue.' },
      { id: 'turn_2', characterId: 'character_2', text: 'Enter reply.' },
    ],
    allowUserRenameCharacters: false,
  };
}

export function createDialogueDefinitionFromPrompt(prompt: string): QuickUseDialogueDefinition {
  const parsed = parseDialoguePrompt(prompt);
  if (parsed.length === 0) return createDefaultDialogueDefinition();
  const characters: QuickUseDialogueCharacterDefinition[] = [];
  const characterIdByName = new Map<string, string>();
  parsed.forEach((line) => {
    const key = line.speaker.toLocaleLowerCase();
    if (characterIdByName.has(key)) return;
    const id = nextDialogueCharacterId(characters);
    characterIdByName.set(key, id);
    characters.push({ id, defaultName: line.speaker });
  });
  const turns: QuickUseDialogueTurnDefinition[] = parsed.map((line, index) => ({
    id: `turn_${index + 1}`,
    characterId: characterIdByName.get(line.speaker.toLocaleLowerCase()) || characters[0].id,
    text: line.text,
  }));
  return { characters, turns, allowUserRenameCharacters: false };
}

export function createDefaultDialogueValue(definition: QuickUseDialogueDefinition): QuickUseDialogueValue {
  return {
    characterNames: Object.fromEntries(
      definition.characters.map((character) => [character.id, character.defaultName]),
    ),
    turns: definition.turns.map((turn) => ({ ...turn })),
  };
}

export function serializeDialogueValue(value: QuickUseDialogueValue): string {
  return `${DIALOGUE_VALUE_PREFIX}${JSON.stringify(value)}`;
}

export function normalizeDialogueValue(
  definition: QuickUseDialogueDefinition,
  serialized?: string,
): QuickUseDialogueValue {
  const fallback = createDefaultDialogueValue(definition);
  if (!serialized?.startsWith(DIALOGUE_VALUE_PREFIX)) return fallback;
  try {
    const parsed = JSON.parse(serialized.slice(DIALOGUE_VALUE_PREFIX.length)) as Partial<QuickUseDialogueValue>;
    const validCharacterIds = new Set(definition.characters.map((character) => character.id));
    const characterNames = Object.fromEntries(definition.characters.map((character) => {
      const supplied = parsed.characterNames?.[character.id];
      const name = definition.allowUserRenameCharacters && typeof supplied === 'string'
        ? cleanName(supplied)
        : character.defaultName;
      return [character.id, name || character.defaultName];
    }));
    const seenTurnIds = new Set<string>();
    const turns = Array.isArray(parsed.turns)
      ? parsed.turns.flatMap((turn) => {
          if (!turn || typeof turn.id !== 'string' || seenTurnIds.has(turn.id)) return [];
          if (typeof turn.characterId !== 'string' || !validCharacterIds.has(turn.characterId)) return [];
          if (typeof turn.text !== 'string') return [];
          seenTurnIds.add(turn.id);
          return [{ id: turn.id, characterId: turn.characterId, text: cleanText(turn.text) }];
        }).slice(0, 12)
      : [];
    return { characterNames, turns: turns.length > 0 ? turns : fallback.turns };
  } catch {
    return fallback;
  }
}

export function compileDialoguePrompt(
  definition: QuickUseDialogueDefinition,
  serialized?: string,
): string {
  const value = normalizeDialogueValue(definition, serialized);
  const characterNames = definition.characters.map((character) => (
    `- ${character.id}: ${value.characterNames[character.id] || character.defaultName}`
  ));
  const turns = value.turns.map((turn) => (
    `${value.characterNames[turn.characterId] || turn.characterId}: “${cleanText(turn.text)}”`
  ));
  return `Characters:\n${characterNames.join('\n')}\nDialogue:\n${turns.join('\n')}`;
}

/**
 * Renders structured dialogue for a generation provider. Stable character IDs
 * remain in the versioned domain value but are intentionally not sent to the
 * model; the spoken lines already carry the resolved character names.
 */
export function compileDialogueProviderPrompt(
  definition: QuickUseDialogueDefinition,
  serialized?: string,
): string {
  const value = normalizeDialogueValue(definition, serialized);
  const turns = value.turns.map((turn) => (
    `${value.characterNames[turn.characterId] || turn.characterId}: “${cleanText(turn.text)}”`
  ));
  return `Dialogue:\n${turns.join('\n')}`;
}

export function replaceDialoguePromptLine(value: string, line: Pick<DialoguePromptLine, 'textStart' | 'textEnd'>, nextText: string): string {
  return `${value.slice(0, line.textStart)}${cleanText(nextText)}${value.slice(line.textEnd)}`;
}

export function replaceDialoguePromptSpeaker(value: string, line: Pick<DialoguePromptLine, 'speakerStart' | 'speakerEnd'>, nextSpeaker: string): string {
  return `${value.slice(0, line.speakerStart)}${cleanName(nextSpeaker) || 'Character'}${value.slice(line.speakerEnd)}`;
}

export function appendDialoguePromptLine(value: string, speaker = 'New character', text = 'Enter dialogue.'): string {
  const separator = value.length > 0 && !value.endsWith('\n') ? '\n' : '';
  return `${value}${separator}${cleanName(speaker)}: “${cleanText(text)}”`;
}

export function removeDialoguePromptLine(value: string, line: Pick<DialoguePromptLine, 'lineStart' | 'lineEnd'>): string {
  if (value[line.lineEnd] === '\r' && value[line.lineEnd + 1] === '\n') return `${value.slice(0, line.lineStart)}${value.slice(line.lineEnd + 2)}`;
  if (value[line.lineEnd] === '\n') return `${value.slice(0, line.lineStart)}${value.slice(line.lineEnd + 1)}`;
  const previousLineBreak = line.lineStart > 0 && value[line.lineStart - 1] === '\n' ? line.lineStart - 1 : line.lineStart;
  return `${value.slice(0, previousLineBreak)}${value.slice(line.lineEnd)}`;
}
