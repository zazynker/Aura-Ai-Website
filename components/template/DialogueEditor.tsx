import React from 'react';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import {
  appendDialoguePromptLine,
  parseDialoguePrompt,
  removeDialoguePromptLine,
  replaceDialoguePromptLine,
  replaceDialoguePromptSpeaker,
} from '../../workflows/dialoguePrompt';

interface DialogueEditorProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  compact?: boolean;
}

export const DialogueEditor = ({
  compact = false,
  onChange,
  placeholder,
  readOnly = false,
  value,
}: DialogueEditorProps) => {
  const lines = parseDialoguePrompt(value);
  const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 disabled:cursor-default disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-950';

  if (lines.length === 0) {
    return (
      <div className="space-y-2">
        <textarea
          className={`${inputClass} ${compact ? 'min-h-20' : 'min-h-28'} resize-y`}
          value={value}
          placeholder={placeholder || 'Reporter says, “Enter dialogue…”'}
          readOnly={readOnly}
          onChange={(event) => onChange?.(event.target.value)}
        />
        <p className="text-[11px] leading-4 text-amber-600 dark:text-amber-300">
          No speaker lines were detected. Use a format such as: Reporter says, “Hello.”
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {lines.map((line) => (
        <div key={line.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-950/60">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300">
              <MessageSquare className="h-3.5 w-3.5" />
            </span>
            {readOnly ? (
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{line.speaker}</span>
            ) : (
              <input
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-semibold text-slate-700 outline-none focus:text-purple-700 dark:text-slate-200 dark:focus:text-purple-300"
                value={line.speaker}
                maxLength={80}
                aria-label="Character name"
                onChange={(event) => onChange?.(replaceDialoguePromptSpeaker(value, line, event.target.value))}
              />
            )}
            <span className="text-[11px] text-slate-400">{line.cue}</span>
            {!readOnly && lines.length > 1 && (
              <button
                type="button"
                onClick={() => onChange?.(removeDialoguePromptLine(value, line))}
                className="ml-auto rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                aria-label={`Remove ${line.speaker} dialogue turn`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <input
            className={inputClass}
            value={line.text}
            maxLength={240}
            placeholder={placeholder || `${line.speaker}'s dialogue`}
            readOnly={readOnly}
            onChange={(event) => onChange?.(replaceDialoguePromptLine(value, line, event.target.value))}
          />
        </div>
      ))}
      {!readOnly && lines.length < 12 && (
        <button
          type="button"
          onClick={() => onChange?.(appendDialoguePromptLine(value))}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-purple-200 px-3 py-2 text-xs font-semibold text-purple-600 hover:border-purple-400 hover:bg-purple-50 dark:border-purple-500/25 dark:text-purple-300 dark:hover:bg-purple-500/10"
        >
          <Plus className="h-3.5 w-3.5" />Add dialogue turn
        </button>
      )}
      <p className="text-[11px] leading-4 text-slate-400">
        Character names and spoken lines are editable. Camera directions outside this Dialogue group stay locked.
      </p>
    </div>
  );
};
