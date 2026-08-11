export interface DialoguePromptLine {
  /** Stable for the lifetime of an unchanged prompt line; never random. */
  id: `dialogue-line:${number}:${string}`;
  speaker: string;
  cue: string;
  text: string;
  textStart: number;
  textEnd: number;
}

export interface DialoguePromptRange {
  start: number;
  end: number;
  lineCount: number;
}

const SPEECH_CUE_PATTERN = '(asks?|replies?|answers?|says?|responds?|shouts?|whispers?|follows\\s+up)';

const stableTextHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const normalizeSpeaker = (value: string): string => {
  const normalized = value.trim().replace(/^the\s+/i, '');
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : 'Character';
};

const parseSpeakerAndCue = (
  prefix: string,
): { speaker: string; cue: string } | null => {
  const normalized = prefix.trim().replace(/,\s*$/, '');
  const narrativeMatch = normalized.match(new RegExp(`^(?:the\\s+)?(.+?)\\s+(${SPEECH_CUE_PATTERN})$`, 'i'));
  if (narrativeMatch) {
    return {
      speaker: normalizeSpeaker(narrativeMatch[1]),
      cue: narrativeMatch[2].toLowerCase().replace(/\s+/g, ' '),
    };
  }
  const scriptMatch = normalized.match(/^(.+?):$/);
  if (scriptMatch) {
    return { speaker: normalizeSpeaker(scriptMatch[1]), cue: 'says' };
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
    const textStart = lineMatch.index + quoteMatch.index + 1;
    const textEnd = textStart + quoteMatch[1].length;
    lines.push({
      id: `dialogue-line:${lineMatch.index}:${stableTextHash(rawLine.slice(0, quoteMatch.index))}`,
      speaker: metadata.speaker,
      cue: metadata.cue,
      text: quoteMatch[1],
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
  const normalized = nextText.replace(/[\r\n]+/g, ' ');
  return `${value.slice(0, line.textStart)}${normalized}${value.slice(line.textEnd)}`;
}
