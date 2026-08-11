import React from 'react';
import { ChevronDown, ChevronUp, MessageSquare, Plus, Trash2 } from 'lucide-react';
import {
  appendDialoguePromptLine,
  nextDialogueTurnId,
  normalizeDialogueValue,
  parseDialoguePrompt,
  removeDialoguePromptLine,
  replaceDialoguePromptLine,
  replaceDialoguePromptSpeaker,
  serializeDialogueValue,
} from '../../workflows/dialoguePrompt';
import type { QuickUseDialogueDefinition, QuickUseDialogueValue } from '../../workflows/quickUseTypes';

interface DialogueEditorProps {
  value: string;
  definition?: QuickUseDialogueDefinition;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  compact?: boolean;
}

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 disabled:cursor-default disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-950';

const StructuredDialogueEditor = ({
  compact,
  definition,
  onChange,
  readOnly,
  value,
}: Required<Pick<DialogueEditorProps, 'compact' | 'readOnly'>> & Pick<DialogueEditorProps, 'onChange' | 'value'> & { definition: QuickUseDialogueDefinition }) => {
  const runtimeValue = normalizeDialogueValue(definition, value);
  const emit = (next: QuickUseDialogueValue) => onChange?.(serializeDialogueValue(next));
  const canRename = !readOnly && definition.allowUserRenameCharacters;

  const updateTurn = (turnId: string, updates: Partial<QuickUseDialogueValue['turns'][number]>) => {
    emit({ ...runtimeValue, turns: runtimeValue.turns.map((turn) => turn.id === turnId ? { ...turn, ...updates } : turn) });
  };
  const moveTurn = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= runtimeValue.turns.length) return;
    const turns = [...runtimeValue.turns];
    [turns[index], turns[target]] = [turns[target], turns[index]];
    emit({ ...runtimeValue, turns });
  };

  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${compact ? '' : 'sm:grid-cols-2'}`}>
        {definition.characters.map((character) => (
          <label key={character.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{character.id.replace('_', ' ')}</span>
            {canRename ? (
              <input
                className={inputClass}
                value={runtimeValue.characterNames[character.id] || character.defaultName}
                maxLength={80}
                onChange={(event) => emit({
                  ...runtimeValue,
                  characterNames: { ...runtimeValue.characterNames, [character.id]: event.target.value },
                })}
              />
            ) : (
              <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                {runtimeValue.characterNames[character.id] || character.defaultName}
              </span>
            )}
          </label>
        ))}
      </div>

      <div className="space-y-2.5">
        {runtimeValue.turns.map((turn, index) => (
          <div key={turn.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-950/60">
            <div className="mb-2 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 shrink-0 text-purple-500" />
              <select
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                value={turn.characterId}
                disabled={readOnly}
                onChange={(event) => updateTurn(turn.id, { characterId: event.target.value })}
              >
                {definition.characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {runtimeValue.characterNames[character.id] || character.defaultName}
                  </option>
                ))}
              </select>
              {!readOnly && (
                <div className="flex shrink-0 items-center">
                  <button type="button" disabled={index === 0} onClick={() => moveTurn(index, -1)} className="rounded p-1 text-slate-400 hover:text-purple-600 disabled:opacity-25" aria-label="Move turn up"><ChevronUp className="h-3.5 w-3.5" /></button>
                  <button type="button" disabled={index === runtimeValue.turns.length - 1} onClick={() => moveTurn(index, 1)} className="rounded p-1 text-slate-400 hover:text-purple-600 disabled:opacity-25" aria-label="Move turn down"><ChevronDown className="h-3.5 w-3.5" /></button>
                  {runtimeValue.turns.length > 1 && <button type="button" onClick={() => emit({ ...runtimeValue, turns: runtimeValue.turns.filter((candidate) => candidate.id !== turn.id) })} className="rounded p-1 text-slate-400 hover:text-red-500" aria-label="Remove dialogue turn"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              )}
            </div>
            <input className={inputClass} value={turn.text} maxLength={240} readOnly={readOnly} onChange={(event) => updateTurn(turn.id, { text: event.target.value })} />
          </div>
        ))}
      </div>

      {!readOnly && runtimeValue.turns.length < 12 && (
        <button
          type="button"
          onClick={() => emit({
            ...runtimeValue,
            turns: [...runtimeValue.turns, {
              id: nextDialogueTurnId(runtimeValue.turns),
              characterId: definition.characters[0].id,
              text: 'Enter dialogue.',
            }],
          })}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-purple-200 px-3 py-2 text-xs font-semibold text-purple-600 hover:border-purple-400 hover:bg-purple-50 dark:border-purple-500/25 dark:text-purple-300 dark:hover:bg-purple-500/10"
        >
          <Plus className="h-3.5 w-3.5" /> Add dialogue turn
        </button>
      )}
      <p className="text-[11px] leading-4 text-slate-400">
        {definition.allowUserRenameCharacters
          ? 'Character count is fixed. Users may rename characters and edit, add, remove, or reorder dialogue turns.'
          : 'Character count and names are locked by the template. Users may edit, add, remove, or reorder dialogue turns.'}
      </p>
    </div>
  );
};

export const DialogueEditor = ({ compact = false, definition, onChange, placeholder, readOnly = false, value }: DialogueEditorProps) => {
  if (definition) return <StructuredDialogueEditor compact={compact} definition={definition} onChange={onChange} readOnly={readOnly} value={value} />;

  const lines = parseDialoguePrompt(value);
  if (lines.length === 0) {
    return (
      <div className="space-y-2">
        <textarea className={`${inputClass} ${compact ? 'min-h-20' : 'min-h-28'} resize-y`} value={value} placeholder={placeholder || 'Reporter says, “Enter dialogue.”'} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} />
        <p className="text-[11px] leading-4 text-amber-600 dark:text-amber-300">Legacy dialogue: use a line such as Reporter says, “Hello.”</p>
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {lines.map((line) => (
        <div key={line.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-950/60">
          <div className="mb-2 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-purple-500" />
            <input className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-semibold" value={line.speaker} readOnly={readOnly} onChange={(event) => onChange?.(replaceDialoguePromptSpeaker(value, line, event.target.value))} />
            {!readOnly && lines.length > 1 && <button type="button" onClick={() => onChange?.(removeDialoguePromptLine(value, line))}><Trash2 className="h-3.5 w-3.5 text-slate-400" /></button>}
          </div>
          <input className={inputClass} value={line.text} readOnly={readOnly} onChange={(event) => onChange?.(replaceDialoguePromptLine(value, line, event.target.value))} />
        </div>
      ))}
      {!readOnly && lines.length < 12 && <button type="button" onClick={() => onChange?.(appendDialoguePromptLine(value))} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-purple-200 px-3 py-2 text-xs font-semibold text-purple-600"><Plus className="h-3.5 w-3.5" /> Add dialogue turn</button>}
    </div>
  );
};
