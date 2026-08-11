import React from 'react';
import { MessageSquare } from 'lucide-react';
import {
  parseDialoguePrompt,
  replaceDialoguePromptLine,
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
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{line.speaker}</span>
            <span className="text-[11px] text-slate-400">{line.cue}</span>
          </div>
          <input
            className={inputClass}
            value={line.text}
            placeholder={placeholder || `${line.speaker}'s dialogue`}
            readOnly={readOnly}
            onChange={(event) => onChange?.(replaceDialoguePromptLine(value, line, event.target.value))}
          />
        </div>
      ))}
      <p className="text-[11px] leading-4 text-slate-400">
        Speaker roles and prompt directions stay locked; only the spoken lines are replaced.
      </p>
    </div>
  );
};
