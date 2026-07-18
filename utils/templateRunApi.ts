import { supabase } from './supabase';

export type TemplateRunStatus = 'started' | 'completed' | 'failed' | 'cancelled';
export type TemplateRunStepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

export interface TemplateRunWorkflowStep {
  id: string;
  order: number;
  title?: string;
  capability: string;
  capabilityVersion?: number;
  instruction?: string;
  parameters?: Record<string, unknown>;
  inputs?: Array<Record<string, unknown>>;
  output?: Record<string, unknown>;
}

export interface TemplateRunWorkflow {
  schemaVersion: number;
  steps: TemplateRunWorkflowStep[];
}

export interface TemplateRunStepRecord {
  id: string;
  stepId: string;
  stepOrder: number;
  capability: string;
  status: TemplateRunStepStatus;
  generationId: string | null;
  creditsUsed: number;
  creditsRefunded: number;
  errorCode: string | null;
}

export interface StartedTemplateRun {
  id: string;
  templateId: string;
  templateVersionId: string;
  userId: string;
  status: TemplateRunStatus;
  currentStep: number;
  idempotencyKey: string;
  startedAt: string;
  workflow: TemplateRunWorkflow;
  steps: TemplateRunStepRecord[];
}

const normalizeRun = (value: unknown): StartedTemplateRun => {
  if (!value || typeof value !== 'object') {
    throw new Error('The workflow run response was empty.');
  }
  const run = value as Partial<StartedTemplateRun>;
  if (!run.id || !run.templateId || !run.templateVersionId || !Array.isArray(run.steps)) {
    throw new Error('The workflow run response was incomplete.');
  }
  return run as StartedTemplateRun;
};

export const createRunIdempotencyKey = (templateId: string): string => {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `template:${templateId}:${randomPart}`;
};

export async function startTemplateRun(
  templateId: string,
  idempotencyKey: string,
): Promise<StartedTemplateRun> {
  const { data, error } = await supabase.rpc('start_template_run', {
    p_template_id: templateId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(`Could not start this workflow: ${error.message}`);
  return normalizeRun(data);
}

export async function fetchTemplateRun(runId: string): Promise<StartedTemplateRun> {
  const { data, error } = await supabase.rpc('get_template_run', {
    p_run_id: runId,
  });
  if (error) throw new Error(`Could not restore this workflow: ${error.message}`);
  return normalizeRun(data);
}

export async function cancelTemplateRun(runId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_template_run', { p_run_id: runId });
  if (error) throw new Error(`Could not cancel this workflow: ${error.message}`);
}
