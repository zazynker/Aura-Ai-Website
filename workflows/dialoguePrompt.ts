export interface DialoguePromptLine {
  /** Stable for the lifetime of an unchanged prompt line; never random. */
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

const SPEECH_CUE_PATTERN = '(asks?|replies?|answers?|says?|responds?|shouts?|whispers?|follows\\s+up)';

const normalizeSpeaker = (value: string): string => {
  const normalized = value.trim().replace(/^the\s+/i, '');
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : 'Character';
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
  if (scriptMatch) {
    return {
      speaker: normalizeSpeaker(scriptMatch[2]),
      cue: 'says',
      speakerOffset: scriptMatch[1].length,
      speakerLength: scriptMatch[2].length,
    };
  }
  return null;
};

/**
 * Reads narrative dialogue such as `The reporter asks, “Hello?”` without
 * changing the saved prompt. Offsets point only to the spoken text, so an edit
 * preserves speaker names, speech cues, punctuation, and surrounding prompt.
 */
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
    const textEnd = textStart + quoteMatch[1].length;
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
      textEnd,
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
  const end = nextLineBreak < 0 ? value.length : nextLineBreak;
  return { start, end, lineCount: lines.length };
}

export function replaceDialoguePromptLine(
  value: string,
  line: Pick<DialoguePromptLine, 'textStart' | 'textEnd'>,
  nextText: string,
): string {
  const normalized = nextText.replace(/[\r\n"“”]+/g, "'");
  return `${value.slice(0, line.textStart)}${normalized}${value.slice(line.textEnd)}`;
}

export function replaceDialoguePromptSpeaker(
  value: string,
  line: Pick<DialoguePromptLine, 'speakerStart' | 'speakerEnd'>,
  nextSpeaker: string,
): string {
  const normalized = nextSpeaker.replace(/[\r\n:"“”]+/g, ' ').trim() || 'Character';
  return `${value.slice(0, line.speakerStart)}${normalized}${value.slice(line.speakerEnd)}`;
}

export function appendDialoguePromptLine(
  value: string,
  speaker = 'New character',
  text = 'Enter dialogue.',
): string {
  const separator = value.length > 0 && !value.endsWith('\n') ? '\n' : '';
  return `${value}${separator}${speaker}: “${text}”`;
}

export function removeDialoguePromptLine(
  value: string,
  line: Pick<DialoguePromptLine, 'lineStart' | 'lineEnd'>,
): string {
  if (value[line.lineEnd] === '\r' && value[line.lineEnd + 1] === '\n') {
    return `${value.slice(0, line.lineStart)}${value.slice(line.lineEnd + 2)}`;
  }
  if (value[line.lineEnd] === '\n') {
    return `${value.slice(0, line.lineStart)}${value.slice(line.lineEnd + 1)}`;
  }
  const previousLineBreak = line.lineStart > 0 && value[line.lineStart - 1] === '\n'
    ? line.lineStart - 1
    : line.lineStart;
  return `${value.slice(0, previousLineBreak)}${value.slice(line.lineEnd)}`;
}
