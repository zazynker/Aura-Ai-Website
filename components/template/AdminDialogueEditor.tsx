import React from 'react';
import { ChevronDown, ChevronUp, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  nextDialogueCharacterId,
  nextDialogueTurnId,
} from '../../workflows/dialoguePrompt';
import type { QuickUseDialogueDefinition } from '../../workflows/quickUseTypes';

interface AdminDialogueEditorProps {
  value: QuickUseDialogueDefinition;
  onChange: (value: QuickUseDialogueDefinition) => void;
  onCancel: () => void;
  onSave: () => void;
}

const fieldClass = 'h-10 w-full rounded-lg border border-purple-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 dark:border-purple-500/25 dark:bg-slate-900 dark:text-white';

export const AdminDialogueEditor = ({ value, onCancel, onChange, onSave }: AdminDialogueEditorProps) => {
  const addCharacter = () => {
    if (value.characters.length >= 8) return;
    const id = nextDialogueCharacterId(value.characters);
    onChange({ ...value, characters: [...value.characters, { id, defaultName: `Character ${value.characters.length + 1}` }] });
  };
  const removeCharacter = (characterId: string) => {
    if (value.characters.length <= 1) return;
    const fallbackId = value.characters.find((character) => character.id !== characterId)?.id;
    if (!fallbackId) return;
    onChange({
      ...value,
      characters: value.characters.filter((character) => character.id !== characterId),
      turns: value.turns.map((turn) => turn.characterId === characterId ? { ...turn, characterId: fallbackId } : turn),
    });
  };
  const addTurn = () => {
    if (value.turns.length >= 12) return;
    onChange({ ...value, turns: [...value.turns, { id: nextDialogueTurnId(value.turns), characterId: value.characters[0].id, text: 'Enter dialogue.' }] });
  };
  const moveTurn = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.turns.length) return;
    const turns = [...value.turns];
    [turns[index], turns[target]] = [turns[target], turns[index]];
    onChange({ ...value, turns });
  };
  const canSave = value.characters.every((character) => character.defaultName.trim())
    && value.turns.length > 0
    && value.turns.every((turn) => turn.text.trim());

  return (
    <div className="rounded-2xl border border-purple-200 bg-purple-50/70 p-4 dark:border-purple-500/25 dark:bg-purple-500/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold text-purple-950 dark:text-purple-100"><MessageSquare className="h-4 w-4" /> Character dialogue</h4>
          <p className="mt-1 text-xs leading-5 text-purple-700 dark:text-purple-300">Define the fixed cast and default conversation. This becomes one Dialogue block in Quick Use.</p>
        </div>
        <button type="button" onClick={addCharacter} disabled={value.characters.length >= 8} className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs font-semibold text-purple-700 disabled:opacity-40 dark:border-purple-500/30 dark:bg-slate-900 dark:text-purple-200"><Plus className="h-3.5 w-3.5" /> Add character</button>
      </div>

      <div className="mt-4 space-y-2">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Characters ({value.characters.length})</div>
        {value.characters.map((character) => (
          <div key={character.id} className="grid items-center gap-2 rounded-xl border border-purple-100 bg-white p-3 sm:grid-cols-[110px_1fr_auto] dark:border-purple-500/15 dark:bg-slate-900/80">
            <span className="font-mono text-[11px] text-slate-400">{character.id}</span>
            <input className={fieldClass} value={character.defaultName} maxLength={80} placeholder="e.g. 受采访的女人" onChange={(event) => onChange({ ...value, characters: value.characters.map((item) => item.id === character.id ? { ...item, defaultName: event.target.value } : item) })} />
            <button type="button" disabled={value.characters.length <= 1} onClick={() => removeCharacter(character.id)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-25 dark:hover:bg-red-500/10" aria-label={`Remove ${character.defaultName}`}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-purple-100 bg-white px-3 py-3 dark:border-purple-500/15 dark:bg-slate-900/80">
        <span><span className="block text-sm font-medium text-slate-800 dark:text-slate-200">Allow users to rename characters</span><span className="mt-0.5 block text-[11px] text-slate-500">Off by default. Character count always remains locked.</span></span>
        <input type="checkbox" checked={value.allowUserRenameCharacters} onChange={(event) => onChange({ ...value, allowUserRenameCharacters: event.target.checked })} className="h-4 w-4 accent-purple-600" />
      </label>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Default dialogue turns ({value.turns.length})</span><button type="button" onClick={addTurn} disabled={value.turns.length >= 12} className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add turn</button></div>
        {value.turns.map((turn, index) => (
          <div key={turn.id} className="grid items-center gap-2 rounded-xl border border-purple-100 bg-white p-3 sm:grid-cols-[150px_1fr_auto] dark:border-purple-500/15 dark:bg-slate-900/80">
            <select className={fieldClass} value={turn.characterId} onChange={(event) => onChange({ ...value, turns: value.turns.map((item) => item.id === turn.id ? { ...item, characterId: event.target.value } : item) })}>{value.characters.map((character) => <option key={character.id} value={character.id}>{character.defaultName || character.id}</option>)}</select>
            <input className={fieldClass} value={turn.text} maxLength={240} placeholder="Spoken line" onChange={(event) => onChange({ ...value, turns: value.turns.map((item) => item.id === turn.id ? { ...item, text: event.target.value } : item) })} />
            <div className="flex items-center">
              <button type="button" disabled={index === 0} onClick={() => moveTurn(index, -1)} className="rounded p-1 text-slate-400 hover:text-purple-600 disabled:opacity-25"><ChevronUp className="h-4 w-4" /></button>
              <button type="button" disabled={index === value.turns.length - 1} onClick={() => moveTurn(index, 1)} className="rounded p-1 text-slate-400 hover:text-purple-600 disabled:opacity-25"><ChevronDown className="h-4 w-4" /></button>
              <button type="button" disabled={value.turns.length <= 1} onClick={() => onChange({ ...value, turns: value.turns.filter((item) => item.id !== turn.id) })} className="rounded p-1 text-slate-400 hover:text-red-500 disabled:opacity-25"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button><Button size="sm" disabled={!canSave} onClick={onSave}>Save dialogue</Button></div>
    </div>
  );
};
