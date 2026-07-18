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

export interface TemplateRunMaterial {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  url: string;
}

const normalizeRun = (value: unknown): StartedTemplateRun => {
  if (!value || typeof value !== 'object') throw new Error('The workflow run response was empty.');
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

export async function startTemplateRun(templateId: string, idempotencyKey: string): Promise<StartedTemplateRun> {
  const { data, error } = await supabase.rpc('start_template_run', {
    p_template_id: templateId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(`Could not start this workflow: ${error.message}`);
  return normalizeRun(data);
}

export async function fetchTemplateRun(runId: string): Promise<StartedTemplateRun> {
  const { data, error } = await supabase.rpc('get_template_run', { p_run_id: runId });
  if (error) throw new Error(`Could not restore this workflow: ${error.message}`);
  return normalizeRun(data);
}

export async function fetchActiveTemplateRun(): Promise<StartedTemplateRun | null> {
  const { data, error } = await supabase.rpc('resume_active_template_run');
  if (error) throw new Error(`Could not restore your active workflow: ${error.message}`);
  if (!data) return null;
  return normalizeRun(data);
}

export async function fetchReusableTemplateAssets(
  templateId: string,
  versionId: string,
): Promise<TemplateRunMaterial[]> {
  const { data, error } = await supabase
    .from('template_assets')
    .select('id,asset_key,asset_type,storage_bucket,storage_path,public_url,is_reusable')
    .eq('template_id', templateId)
    .eq('version_id', versionId)
    .eq('is_reusable', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Could not restore template materials: ${error.message}`);

  const rows = (data || []) as Array<{
    id: string;
    asset_key: string;
    asset_type: 'image' | 'video' | 'audio';
    storage_bucket: string | null;
    storage_path: string | null;
    public_url: string | null;
  }>;
  const materials = await Promise.all(rows.map(async (row): Promise<TemplateRunMaterial | null> => {
    let url = row.public_url || '';
    if (!url && row.storage_bucket && row.storage_path) {
      const { data: signed, error: signError } = await supabase.storage
        .from(row.storage_bucket)
        .createSignedUrl(row.storage_path, 60 * 60);
      if (!signError) url = signed?.signedUrl || '';
    }
    if (!url) return null;
    return {
      id: row.id,
      name: row.asset_key || 'Template material',
      type: row.asset_type,
      url,
    };
  }));
  return materials.filter((item): item is TemplateRunMaterial => Boolean(item));
}

export async function setTemplateRunCurrentStep(runId: string, stepId: string): Promise<StartedTemplateRun> {
  const { data, error } = await supabase.rpc('set_template_run_current_step', {
    p_run_id: runId,
    p_step_id: stepId,
  });
  if (error) throw new Error(`Could not open this workflow step: ${error.message}`);
  return normalizeRun(data);
}

export async function cancelTemplateRun(runId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_template_run', { p_run_id: runId });
  if (error) throw new Error(`Could not cancel this workflow: ${error.message}`);
}
