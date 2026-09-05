import { supabase } from './supabase';

export type TemplateRunStatus = 'started' | 'completed' | 'failed' | 'cancelled';
export type TemplateRunStepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

/**
 * generated               = a provider call was made and credits were charged.
 * reused_template_result  = the template's own demo result was served because
 *                           the user changed nothing bound to that step.
 */
export type TemplateRunStepExecutionMode = 'generated' | 'reused_template_result';

/**
 * workflow  = the hand-driven Workflow Dock flow started from a template page.
 * quick_use = a one-shot Template run. The dock must never adopt one of these:
 *             a Template is not a Workflow, and showing its steps as a
 *             resumable dock let users cancel a run that had already finished.
 */
export type TemplateRunMode = 'workflow' | 'quick_use';

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
  /** Absent on runs created before the final-video release. */
  executionMode?: TemplateRunStepExecutionMode;
  resultUrl?: string | null;
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
  assetKey: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  isReusable: boolean;
}

export interface TemplateRunFinalVideo {
  finalVideoUrl: string | null;
  finalThumbnailUrl: string | null;
  finalMediaType: 'image' | 'video' | null;
  stepIds: string[];
  assembledAt: string | null;
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

export async function startTemplateRun(
  templateId: string,
  idempotencyKey: string,
  runMode: TemplateRunMode = 'workflow',
): Promise<StartedTemplateRun> {
  // Starting and tagging must be one database operation. When Quick Use first
  // created a default Workflow run and tagged it in a second request, the
  // global restore listener could adopt it in between those requests and flash
  // the Workflow Dock over a Template.
  const atomic = await supabase.rpc('start_template_run_in_mode', {
    p_template_id: templateId,
    p_idempotency_key: idempotencyKey,
    p_run_mode: runMode,
  });
  if (!atomic.error) return normalizeRun(atomic.data);

  // Deployment-order fallback for a frontend released just before the new
  // migration. Quick Use still applies the legacy tag immediately below.
  const { data, error } = await supabase.rpc('start_template_run', {
    p_template_id: templateId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(`Could not start this workflow: ${error.message}`);
  const run = normalizeRun(data);
  if (runMode !== 'workflow') await setTemplateRunMode(run.id, runMode);
  return run;
}

/**
 * Tags a run as Quick Use so the Workflow Dock ignores it.
 *
 * Best-effort by design: it is called immediately after the run starts, and a
 * deployment where the migration has not been applied yet must still be able
 * to generate. The caller logs and continues.
 */
export async function setTemplateRunMode(
  runId: string,
  mode: TemplateRunMode,
): Promise<void> {
  const { error } = await supabase.rpc('set_template_run_mode', {
    p_run_id: runId,
    p_mode: mode,
  });
  if (error) throw new Error(`Could not tag this workflow run: ${error.message}`);
}

/**
 * Returns null when the mode cannot be verified. Callers must not guess that
 * an unknown run is a Workflow, because doing so can attach the Workflow Dock
 * to a one-shot Template run.
 */
export async function fetchTemplateRunMode(runId: string): Promise<TemplateRunMode | null> {
  const { data, error } = await supabase.rpc('get_template_run_mode', { p_run_id: runId });
  if (error) return null;
  if (data === 'quick_use') return 'quick_use';
  if (data === 'workflow') return 'workflow';
  return null;
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
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Could not restore template materials: ${error.message}`);

  const rows = (data || []) as Array<{
    id: string;
    asset_key: string;
    asset_type: 'image' | 'video' | 'audio';
    storage_bucket: string | null;
    storage_path: string | null;
    public_url: string | null;
    is_reusable: boolean;
  }>;
  const usefulRows = rows.filter(
    (row) => row.is_reusable || /^step-\d+-result$/.test(row.asset_key),
  );
  const materials = await Promise.all(usefulRows.map(async (row): Promise<TemplateRunMaterial | null> => {
    let url = row.public_url || '';
    if (!url && row.storage_bucket && row.storage_path) {
      const { data: signed, error: signError } = await supabase.storage
        .from(row.storage_bucket)
        .createSignedUrl(row.storage_path, 5 * 60);
      if (!signError) url = signed?.signedUrl || '';
    }
    if (!url) return null;
    return {
      id: row.id,
      assetKey: row.asset_key,
      name: row.asset_key || 'Template material',
      type: row.asset_type,
      url,
      isReusable: Boolean(row.is_reusable),
    };
  }));
  return materials.filter((item): item is TemplateRunMaterial => Boolean(item));
}

/**
 * Loads the template's own per-step demo results for one locked version,
 * keyed by `step-N-result`. These are the clips a Quick Use run may serve
 * back when the user changed nothing bound to that step.
 *
 * Signed for an hour rather than five minutes: the URL is handed to the merge
 * provider, which downloads it after the run finishes.
 */
export async function fetchTemplateStepResultAssets(
  templateId: string,
  versionId: string,
): Promise<Record<string, { url: string; type: 'image' | 'video' | 'audio' }>> {
  const { data, error } = await supabase
    .from('template_assets')
    .select('id,asset_key,asset_type,storage_bucket,storage_path,public_url')
    .eq('template_id', templateId)
    .eq('version_id', versionId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Could not load the template step results: ${error.message}`);

  const rows = ((data || []) as Array<{
    asset_key: string;
    asset_type: 'image' | 'video' | 'audio';
    storage_bucket: string | null;
    storage_path: string | null;
    public_url: string | null;
  }>).filter((row) => /^step-.+-result(?:-.+)?$/.test(row.asset_key) && !row.asset_key.endsWith('-thumbnail'));

  const entries = await Promise.all(rows.map(async (row) => {
    let url = row.public_url || '';
    if (!url && row.storage_bucket && row.storage_path) {
      const { data: signed, error: signError } = await supabase.storage
        .from(row.storage_bucket)
        .createSignedUrl(row.storage_path, 60 * 60);
      if (!signError) url = signed?.signedUrl || '';
    }
    if (!url) return null;
    return [row.asset_key, { url, type: row.asset_type }] as const;
  }));

  return Object.fromEntries(
    entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
  );
}

export async function setTemplateRunCurrentStep(runId: string, stepId: string): Promise<StartedTemplateRun> {
  const { data, error } = await supabase.rpc('set_template_run_current_step', {
    p_run_id: runId,
    p_step_id: stepId,
  });
  if (error) throw new Error(`Could not open this workflow step: ${error.message}`);
  return normalizeRun(data);
}

export async function beginTemplateRunStep(runId: string, stepId: string): Promise<void> {
  const { error } = await supabase.rpc('begin_template_run_step', {
    p_run_id: runId,
    p_step_id: stepId,
  });
  if (error) throw new Error(`Could not start this workflow step: ${error.message}`);
}

export async function engageTemplateRunStep(
  runId: string,
  stepId: string,
  action: 'all' | 'materials' | 'prompt',
): Promise<void> {
  const { error } = await supabase.rpc('engage_template_run_step', {
    p_run_id: runId,
    p_step_id: stepId,
    p_action: action,
  });
  if (error) throw new Error(`Could not activate this template step: ${error.message}`);
}

export async function completeTemplateRunStep(
  runId: string,
  stepId: string,
  generationId: string,
): Promise<void> {
  const { error } = await supabase.rpc('complete_template_run_step', {
    p_run_id: runId,
    p_step_id: stepId,
    p_generation_id: generationId,
  });
  if (error) throw new Error(`Could not complete this workflow step: ${error.message}`);
}

/**
 * Closes a step that was served from the template's own demo result.
 * No generation row is written and no credits are charged; the step is marked
 * `reused_template_result` so review and analytics can tell the two apart.
 */
export async function reuseTemplateRunStep(
  runId: string,
  stepId: string,
  resultUrl: string,
): Promise<void> {
  const { error } = await supabase.rpc('reuse_template_run_step', {
    p_run_id: runId,
    p_step_id: stepId,
    p_result_url: resultUrl,
  });
  if (error) throw new Error(`Could not reuse this template step: ${error.message}`);
}

export async function failTemplateRunStep(
  runId: string,
  stepId: string,
  errorCode: string,
): Promise<void> {
  const { error } = await supabase.rpc('fail_template_run_step', {
    p_run_id: runId,
    p_step_id: stepId,
    p_error_code: errorCode,
  });
  if (error) throw new Error(`Could not record this workflow step failure: ${error.message}`);
}

export async function fetchTemplateRunFinalVideo(
  runId: string,
): Promise<TemplateRunFinalVideo | null> {
  const { data, error } = await supabase
    .from('template_runs')
    .select('final_video_url,final_thumbnail_url,final_media_type,final_video_step_ids,assembled_at')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(`Could not read this workflow result: ${error.message}`);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    finalVideoUrl: typeof row.final_video_url === 'string' ? row.final_video_url : null,
    finalThumbnailUrl: typeof row.final_thumbnail_url === 'string' ? row.final_thumbnail_url : null,
    finalMediaType: row.final_media_type === 'video' || row.final_media_type === 'image'
      ? row.final_media_type
      : null,
    stepIds: Array.isArray(row.final_video_step_ids)
      ? row.final_video_step_ids.filter((id): id is string => typeof id === 'string')
      : [],
    assembledAt: typeof row.assembled_at === 'string' ? row.assembled_at : null,
  };
}

export async function cancelTemplateRun(runId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_template_run', { p_run_id: runId });
  if (error) throw new Error(`Could not cancel this workflow: ${error.message}`);
}
