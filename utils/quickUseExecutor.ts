import type { Plan, GenerationInputAssetSnapshot } from '../types';
import type { JsonPrimitive, WorkflowAssetType, WorkflowDefinition } from '../workflows/types';
import { getWorkflowCapability } from '../workflows/registry';
import { resolveWorkflowInputPromptTokens } from '../workflows/promptInputTokens';
import type { QuickUseCandidateId, QuickUseDefinition } from '../workflows/quickUseTypes';
import {
  compileQuickUseExecutionPlan,
  type QuickUseExecutionAsset,
  type QuickUseExecutionInput,
  type QuickUseExecutionStep,
  type QuickUseExecutionValues,
} from '../workflows/quickUseExecution';
import {
  resolveQuickUseStepExecution,
  type QuickUseStepExecutionDecision,
  type QuickUseTemplateStepResult,
} from '../workflows/quickUseReuse';
import { selectFinalVideoStepIds } from '../workflows/quickUseFinalVideo';
import { generateImages, generateVideo } from './generateService';
import { saveGenerationsToDb } from './api';
import { supabase } from './supabase';
import {
  cancelTemplateRun,
  completeTemplateRunStep,
  createRunIdempotencyKey,
  engageTemplateRunStep,
  fetchTemplateRunFinalVideo,
  fetchTemplateStepResultAssets,
  reuseTemplateRunStep,
  setTemplateRunMode,
  startTemplateRun,
} from './templateRunApi';
import { finalizeWorkflowVideo } from './workflowFinalizer';
import type { TemplateGenerationContext } from './templateRunGeneration';

export type QuickUseBrowserValue = JsonPrimitive | File;
export type QuickUseBrowserValues = Partial<Record<QuickUseCandidateId, QuickUseBrowserValue>>;

export type QuickUseStepExecutionMode = 'generated' | 'reused_template_result';

export interface QuickUseStepOutcome {
  stepId: string;
  stepTitle: string;
  order: number;
  type: 'image' | 'video';
  url: string;
  executionMode: QuickUseStepExecutionMode;
}

export interface QuickUseFinalVideoOutcome {
  url: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  stepIds: string[];
}

export interface QuickUseExecutionProgress {
  runId: string;
  /**
   * `assembling` covers the window after the last step finished and before the
   * merged deliverable exists. It only occurs on templates whose published
   * version asks for a final video.
   */
  status: 'preparing' | 'running' | 'assembling' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  totalSteps: number;
  stepId?: string;
  stepTitle?: string;
  error?: string;
  result?: {
    type: 'image' | 'video';
    url: string;
  };
  /** Every step result in workflow order, generated or reused. */
  stepResults?: QuickUseStepOutcome[];
  /** Present only when the run produced a merged deliverable. */
  finalVideo?: QuickUseFinalVideoOutcome;
  /**
   * Set when this template asked for a joined video and the run could not
   * deliver one. The last step result is served instead — silently swapping
   * the deliverable with no explanation is worse than saying so.
   */
  finalVideoError?: string;
}

export interface ExecuteQuickUseOptions {
  templateId: string;
  templateName: string;
  userId: string;
  userPlan: Plan;
  values: QuickUseBrowserValues;
  onProgress?: (progress: QuickUseExecutionProgress) => void;
  signal?: AbortSignal;
}

export class QuickUseCancelledError extends Error {
  constructor() {
    super('Template generation was cancelled.');
    this.name = 'QuickUseCancelledError';
  }
}

const throwIfCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new QuickUseCancelledError();
};

const awaitWithCancellation = <T,>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new QuickUseCancelledError());
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(new QuickUseCancelledError());
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort);
        reject(error);
      },
    );
  });
};

interface AssetRow {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string | null;
}

interface StepResult {
  type: 'image' | 'video';
  url: string;
}

const asNumber = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

const asString = (value: unknown, fallback = ''): string => (
  typeof value === 'string' ? value : fallback
);

const asBoolean = (value: unknown, fallback: boolean): boolean => (
  typeof value === 'boolean' ? value : fallback
);

const getResolvedInputUrl = (
  input: QuickUseExecutionInput | undefined,
  resultsByStepId: ReadonlyMap<string, StepResult>,
): string | undefined => {
  if (!input) return undefined;
  if (input.source === 'previous_step') {
    return input.fromStepId ? resultsByStepId.get(input.fromStepId)?.url : undefined;
  }
  return input.url;
};

async function uploadQuickUseFile(
  userId: string,
  candidateId: QuickUseCandidateId,
  file: File,
): Promise<QuickUseExecutionAsset> {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure upload identifiers are unavailable in this browser.');
  const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const safeCandidate = candidateId.replace(/[^a-z0-9_-]/gi, '_').slice(0, 100) || 'input';
  const path = `${userId}/quick-use-inputs/${safeCandidate}/${crypto.randomUUID()}.${extension}`;
  const { data: uploaded, error } = await supabase.storage.from('user-uploads').upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error || !uploaded?.path) throw new Error(`Could not upload ${file.name}: ${error?.message || 'storage path missing'}.`);
  const { data, error: signError } = await supabase.storage
    .from('user-uploads')
    .createSignedUrl(uploaded.path, 60 * 60);
  if (signError || !data?.signedUrl) {
    throw new Error(`Could not prepare ${file.name} for generation: ${signError?.message || 'signed URL missing'}.`);
  }
  const assetType: WorkflowAssetType = file.type.startsWith('video/')
    ? 'video'
    : file.type.startsWith('audio/')
      ? 'audio'
      : 'image';
  return { kind: 'asset', assetType, url: data.signedUrl };
}

async function resolveBrowserValues(
  userId: string,
  values: QuickUseBrowserValues,
): Promise<QuickUseExecutionValues> {
  const resolved: QuickUseExecutionValues = {};
  for (const [candidateId, value] of Object.entries(values) as Array<[QuickUseCandidateId, QuickUseBrowserValue]>) {
    resolved[candidateId] = value instanceof File
      ? await uploadQuickUseFile(userId, candidateId, value)
      : value;
  }
  return resolved;
}

async function loadLockedQuickUseDefinition(
  templateId: string,
  versionId: string,
): Promise<QuickUseDefinition> {
  const { data, error } = await supabase
    .from('template_versions')
    .select('quick_use_definition')
    .eq('id', versionId)
    .eq('template_id', templateId)
    .eq('version_status', 'published')
    .single();
  if (error || !data?.quick_use_definition) {
    throw new Error(`Could not load the locked Quick Use version: ${error?.message || 'definition missing'}.`);
  }
  return data.quick_use_definition as QuickUseDefinition;
}

async function loadTemplateAssetUrls(
  templateId: string,
  versionId: string,
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('template_assets')
    .select('id,storage_bucket,storage_path,public_url')
    .eq('template_id', templateId)
    .eq('version_id', versionId);
  if (error) throw new Error(`Could not load the locked template assets: ${error.message}.`);
  const entries = await Promise.all(((data || []) as AssetRow[]).map(async (asset): Promise<[string, string] | null> => {
    if (asset.public_url) return [asset.id, asset.public_url];
    if (!asset.storage_bucket || !asset.storage_path) return null;
    const { data: signed, error: signError } = await supabase.storage
      .from(asset.storage_bucket)
      .createSignedUrl(asset.storage_path, 60 * 60);
    if (signError || !signed?.signedUrl) return null;
    return [asset.id, signed.signedUrl];
  }));
  return Object.fromEntries(entries.filter((entry): entry is [string, string] => Boolean(entry)));
}

/**
 * Maps the template's `step-N-result` demo assets onto authored step ids so a
 * step the user left untouched can be served without calling a provider.
 * Audio results are ignored: no workflow step outputs audio.
 */
function mapTemplateStepResults(
  steps: QuickUseExecutionStep[],
  assetsByKey: Readonly<Record<string, { url: string; type: 'image' | 'video' | 'audio' }>>,
): Record<string, QuickUseTemplateStepResult> {
  const ordered = [...steps].sort((left, right) => left.order - right.order);
  const results: Record<string, QuickUseTemplateStepResult> = {};
  ordered.forEach((step, index) => {
    const asset = assetsByKey[`step-${step.order}-result`]
      || assetsByKey[`step-${index + 1}-result`];
    if (!asset || asset.type === 'audio') return;
    results[step.id] = { url: asset.url, type: asset.type };
  });
  return results;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', handleAbort);
    resolve();
  }, ms);
  function handleAbort() {
    clearTimeout(timer);
    reject(new QuickUseCancelledError());
  }
  if (signal?.aborted) {
    clearTimeout(timer);
    reject(new QuickUseCancelledError());
    return;
  }
  signal?.addEventListener('abort', handleAbort, { once: true });
});

/**
 * Asks the server to join the run's clips, and does not give up if the reply
 * is lost.
 *
 * Assembly is a server-side job that stores its result on the run before it
 * answers. A dropped response, an expired token, or a proxy timing the request
 * out would otherwise throw away a video that already exists and had already
 * been paid for, so the run falls back to reading the stored result.
 */
async function resolveFinalVideo(
  runId: string,
  signal?: AbortSignal,
): Promise<{ video?: QuickUseFinalVideoOutcome; error?: string }> {
  let lastError: string | undefined;
  try {
    const assembled = await awaitWithCancellation(finalizeWorkflowVideo(runId, { signal }), signal);
    if (assembled.finalVideoUrl) {
      return {
        video: {
          url: assembled.finalVideoUrl,
          thumbnailUrl: assembled.thumbnailUrl,
          durationSeconds: assembled.durationSeconds,
          stepIds: assembled.stepIds,
        },
      };
    }
    // The server answered "this version does not ask for a joined video".
    // That is a normal outcome, not a failure, and needs no recovery.
    if (!assembled.assembled) return {};
  } catch (error) {
    if (error instanceof QuickUseCancelledError) throw error;
    lastError = error instanceof Error ? error.message : 'The joined video could not be assembled.';
    console.error('[Quick Use] Final video assembly failed:', error);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await sleep(3_000, signal);
    const stored = await fetchTemplateRunFinalVideo(runId).catch(() => null);
    if (stored?.finalVideoUrl) {
      return {
        video: {
          url: stored.finalVideoUrl,
          thumbnailUrl: stored.finalThumbnailUrl,
          durationSeconds: null,
          stepIds: stored.stepIds,
        },
      };
    }
  }

  return { error: lastError || 'The joined video is not ready yet.' };
}

const toInputSnapshots = (
  step: QuickUseExecutionStep,
  resultsByStepId: ReadonlyMap<string, StepResult>,
): GenerationInputAssetSnapshot[] => step.inputs.flatMap((input) => {
  const url = getResolvedInputUrl(input, resultsByStepId);
  return url ? [{ key: input.slot, assetType: input.assetType, url }] : [];
});

async function executeImageStep(
  step: QuickUseExecutionStep,
  context: TemplateGenerationContext,
  resultsByStepId: ReadonlyMap<string, StepResult>,
) {
  const inputUrl = (slot: string) => getResolvedInputUrl(
    step.inputs.find((input) => input.slot === slot),
    resultsByStepId,
  );
  const prompt = asString(step.parameters.prompt, step.instruction);
  const outputCount = Math.max(1, Math.floor(asNumber(step.parameters.outputCount, 1)));
  const resolution = asString(step.parameters.resolution, '1K') as '1K' | '2K' | '4K';
  const model = asString(step.parameters.model, 'gpt-image-2');
  const sourceImageUrl = inputUrl('source_image');
  const subjectReferenceUrls = [
    inputUrl('reference_image'),
    inputUrl('reference_image_2'),
  ].filter((url): url is string => Boolean(url));
  const modifyInputUrls = [sourceImageUrl, ...subjectReferenceUrls]
    .filter((url): url is string => Boolean(url));
  const referenceUrls = step.inputs
    .map((input) => getResolvedInputUrl(input, resultsByStepId))
    .filter((url): url is string => Boolean(url));

  let resolvedPrompt = resolveWorkflowInputPromptTokens(
    prompt,
    getWorkflowCapability(step.capability).inputs,
  );
  if (step.capability === 'image.modify') {
    // Preserve old published templates while presenting the provider with the
    // same positional names used by GPT Image: image1, image2, image3.
    resolvedPrompt = resolvedPrompt
      .replace(/\bsubject reference(?: image)?\s*2\b/gi, 'image3')
      .replace(/\bsubject reference(?: image)?\s*1\b/gi, 'image2')
      .replace(/\bsubject reference image\b/gi, 'image2')
      .replace(/\bsource image\b/gi, 'image1');
  }
  if (step.capability === 'image.change_ratio' && !resolvedPrompt.trim()) {
    resolvedPrompt = `Extend this image to fit a ${asString(step.parameters.ratio, '1:1')} aspect ratio while preserving the original content and style.`;
  } else if (step.capability === 'image.enhance' && !resolvedPrompt.trim()) {
    resolvedPrompt = 'Enhance this image while preserving its composition. Improve clarity, lighting, color, and detail.';
  } else if (step.capability === 'image.upscale' && !resolvedPrompt.trim()) {
    resolvedPrompt = `Upscale this image to ${resolution} while preserving its composition and details.`;
  }
  return generateImages({
    prompt: resolvedPrompt,
    capability: step.capability,
    provider: model === 'mj-v8.1' ? 'evolink-mj-v8.1' : step.capability === 'image.modify' ? 'fal-gpt-image-2-edit' : undefined,
    imageUrl: step.capability === 'image.replace_product'
      ? inputUrl('scene_image')
      : sourceImageUrl || referenceUrls[0],
    productImageUrl: step.capability === 'image.replace_product'
      ? inputUrl('product_image')
      : subjectReferenceUrls[0] || referenceUrls[1],
    referenceImageUrls: step.capability === 'image.modify'
      ? modifyInputUrls
      : step.capability === 'image.text_to_image'
        ? referenceUrls
        : undefined,
    numberOfImages: model === 'mj-v8.1' ? 4 : outputCount,
    imageSize: resolution,
    aspectRatio: step.capability === 'image.modify'
      ? 'auto'
      : asString(step.parameters.ratio) || undefined,
    quality: 'medium',
    mjQuality: asString(step.parameters.quality) === 'hd' ? 'hd' : 'standard',
    mjParams: model === 'mj-v8.1' ? {
      stylize: asNumber(step.parameters.stylize, 100),
      chaos: asNumber(step.parameters.chaos, 0),
      experimental: asNumber(step.parameters.experimental, 0),
      raw: asBoolean(step.parameters.raw, false),
      seed: typeof step.parameters.seed === 'number' ? step.parameters.seed : undefined,
      referenceMode: asString(step.parameters.referenceMode) as 'image' | 'style' | 'omni' || undefined,
      imageWeight: asNumber(step.parameters.imageWeight, 1),
      styleWeight: asNumber(step.parameters.styleWeight, 100),
      omniWeight: asNumber(step.parameters.omniWeight, 100),
      imageReferenceUrl: inputUrl('image_reference'),
      styleReferenceUrl: inputUrl('style_reference'),
      omniReferenceUrl: inputUrl('omni_reference'),
    } : undefined,
    templateContext: context,
  });
}

async function executeVideoStep(
  step: QuickUseExecutionStep,
  context: TemplateGenerationContext,
  resultsByStepId: ReadonlyMap<string, StepResult>,
) {
  const inputUrl = (slot: string) => getResolvedInputUrl(
    step.inputs.find((input) => input.slot === slot),
    resultsByStepId,
  );
  const mode = step.capability === 'video.motion_control'
    ? 'motion_control'
    : step.capability.startsWith('video.lip_sync_')
      ? 'lip_sync'
      : 'image_to_video';
  return generateVideo({
    mode,
    prompt: resolveWorkflowInputPromptTokens(
      asString(step.parameters.prompt, step.instruction),
      getWorkflowCapability(step.capability).inputs,
    ),
    startImageUrl: inputUrl('start_image') || inputUrl('character_image') || inputUrl('portrait_image'),
    endImageUrl: inputUrl('end_image'),
    videoUrl: inputUrl('driver_video') || inputUrl('source_video'),
    audioUrl: inputUrl('audio'),
    duration: asNumber(step.parameters.duration, 5),
    resolution: asString(step.parameters.resolution, '720p') === '1080p' ? '1080p' : '720p',
    characterOrientation: asString(step.parameters.characterOrientation, 'video') === 'image' ? 'image' : 'video',
    generationCount: 1,
    requestedOutputCount: 1,
    generateAudio: asBoolean(step.parameters.generateAudio, true),
    allowConcurrent: true,
    allowAdminDemo: false,
    templateContext: context,
  });
}

export async function executeQuickUseTemplate(
  options: ExecuteQuickUseOptions,
): Promise<QuickUseExecutionProgress> {
  throwIfCancelled(options.signal);
  const run = await startTemplateRun(options.templateId, createRunIdempotencyKey(options.templateId));
  // A Template run is not a Workflow run. Tagging it keeps the Workflow Dock
  // from adopting it as a resumable step-by-step session. Best-effort: an
  // untagged run must still be able to generate.
  await setTemplateRunMode(run.id, 'quick_use').catch((modeError) => {
    console.warn('Could not tag this run as Quick Use:', modeError);
  });
  let currentStep = 0;
  const stepOutcomes: QuickUseStepOutcome[] = [];
  const report = (progress: Omit<QuickUseExecutionProgress, 'runId' | 'totalSteps'>) => {
    options.onProgress?.({
      stepResults: [...stepOutcomes],
      ...progress,
      runId: run.id,
      totalSteps: run.workflow.steps.length,
    });
  };
  report({ status: 'preparing', currentStep: 0 });

  try {
    throwIfCancelled(options.signal);
    const [definition, templateAssetUrls, stepResultAssets, resolvedValues] = await awaitWithCancellation(Promise.all([
      loadLockedQuickUseDefinition(run.templateId, run.templateVersionId),
      loadTemplateAssetUrls(run.templateId, run.templateVersionId),
      fetchTemplateStepResultAssets(run.templateId, run.templateVersionId),
      resolveBrowserValues(options.userId, options.values),
    ]), options.signal);
    const workflow = run.workflow as unknown as WorkflowDefinition;
    const plan = compileQuickUseExecutionPlan(
      workflow,
      definition,
      resolvedValues,
      templateAssetUrls,
    );
    const resultsByStepId = new Map<string, StepResult>();

    // Decide once, before anything runs, which steps must call a provider.
    // A step is only reused when the user changed nothing bound to it *and*
    // every upstream step it consumes was reused too, so the delivered clips
    // always belong to the same take.
    const decisions: ReadonlyMap<string, QuickUseStepExecutionDecision> = resolveQuickUseStepExecution({
      workflow,
      definition,
      steps: plan.steps,
      values: resolvedValues,
      templateStepResults: mapTemplateStepResults(plan.steps, stepResultAssets),
    });

    for (let index = 0; index < plan.steps.length; index += 1) {
      throwIfCancelled(options.signal);
      const step = plan.steps[index];
      currentStep = index + 1;
      report({ status: 'running', currentStep: index + 1, stepId: step.id, stepTitle: step.title });
      await awaitWithCancellation(engageTemplateRunStep(run.id, step.id, 'all'), options.signal);

      const decision = decisions.get(step.id);
      if (decision?.mode === 'reuse' && decision.reusableUrl && decision.reusableType) {
        await awaitWithCancellation(
          reuseTemplateRunStep(run.id, step.id, decision.reusableUrl),
          options.signal,
        );
        resultsByStepId.set(step.id, { type: decision.reusableType, url: decision.reusableUrl });
        stepOutcomes.push({
          stepId: step.id,
          stepTitle: step.title,
          order: step.order,
          type: decision.reusableType,
          url: decision.reusableUrl,
          executionMode: 'reused_template_result',
        });
        throwIfCancelled(options.signal);
        continue;
      }

      const context: TemplateGenerationContext = {
        templateRunId: run.id,
        templateStepId: step.id,
        templateCapability: step.capability,
      };
      const inputAssets = toInputSnapshots(step, resultsByStepId);

      if (step.output.assetType === 'image') {
        const result = await awaitWithCancellation(executeImageStep(step, context, resultsByStepId), options.signal);
        if (!result.success || !result.images?.length || !result.requestId) {
          throw new Error(result.error || 'Image generation did not return a result.');
        }
        const totalCredits = result.creditsUsed ?? result.creditsDeducted ?? 0;
        const generations = result.images.map((url, imageIndex) => ({
          userId: options.userId,
          templateId: options.templateId,
          templateName: options.templateName,
          imageUrl: url,
          creditsUsed: imageIndex === 0 ? totalCredits : 0,
          prompt: asString(step.parameters.prompt, step.instruction),
          mediaType: 'image' as const,
          capability: step.capability,
          inputAssets,
          generationParameters: step.parameters,
          requestId: result.requestId,
          templateRunId: run.id,
          templateStepId: step.id,
          templateCapability: step.capability,
        }));
        const saved = await saveGenerationsToDb(generations, options.userPlan);
        if (saved.error || !saved.data[0]) throw new Error(saved.error || 'Could not persist the generated image.');
        await completeTemplateRunStep(run.id, step.id, saved.data[0].id);
        resultsByStepId.set(step.id, { type: 'image', url: result.images[0] });
        stepOutcomes.push({
          stepId: step.id,
          stepTitle: step.title,
          order: step.order,
          type: 'image',
          url: result.images[0],
          executionMode: 'generated',
        });
      } else {
        const result = await awaitWithCancellation(executeVideoStep(step, context, resultsByStepId), options.signal);
        if (!result.success || !result.videoUrl || !result.requestId) {
          throw new Error(result.error || 'Video generation did not return a result.');
        }
        const saved = await saveGenerationsToDb([{
          userId: options.userId,
          templateId: options.templateId,
          templateName: options.templateName,
          imageUrl: result.videoUrl,
          creditsUsed: result.creditsUsed ?? result.creditsDeducted ?? 0,
          prompt: asString(step.parameters.prompt, step.instruction),
          mediaType: 'video',
          videoUrl: result.videoUrl,
          videoDuration: result.duration,
          videoMode: step.capability === 'video.motion_control'
            ? 'motion_control'
            : step.capability.startsWith('video.lip_sync_')
              ? 'lip_sync'
              : 'image_to_video',
          capability: step.capability,
          inputAssets,
          generationParameters: step.parameters,
          requestId: result.requestId,
          templateRunId: run.id,
          templateStepId: step.id,
          templateCapability: step.capability,
        }], options.userPlan);
        if (saved.error || !saved.data[0]) throw new Error(saved.error || 'Could not persist the generated video.');
        await completeTemplateRunStep(run.id, step.id, saved.data[0].id);
        resultsByStepId.set(step.id, { type: 'video', url: result.videoUrl });
        stepOutcomes.push({
          stepId: step.id,
          stepTitle: step.title,
          order: step.order,
          type: 'video',
          url: result.videoUrl,
          executionMode: 'generated',
        });
      }
      throwIfCancelled(options.signal);
    }

    const lastStepResult = resultsByStepId.get(plan.steps[plan.steps.length - 1].id);
    if (!lastStepResult) throw new Error('Quick Use completed without a final result.');

    // Assemble the deliverable when the published version asks for one. A
    // failure here never loses the run: the per-step results are already
    // saved, so the last step result is delivered instead.
    let finalVideo: QuickUseFinalVideoOutcome | undefined;
    let finalVideoError: string | undefined;
    if (selectFinalVideoStepIds(plan, definition).length > 0) {
      throwIfCancelled(options.signal);
      report({
        status: 'assembling',
        currentStep: plan.steps.length,
        stepTitle: 'Joining your shots',
      });
      const outcome = await resolveFinalVideo(run.id, options.signal);
      finalVideo = outcome.video;
      finalVideoError = outcome.error;
    }

    const completed: QuickUseExecutionProgress = {
      runId: run.id,
      status: 'completed',
      currentStep: plan.steps.length,
      totalSteps: plan.steps.length,
      result: finalVideo
        ? { type: 'video', url: finalVideo.url }
        : lastStepResult,
      stepResults: [...stepOutcomes],
      finalVideo,
      finalVideoError,
    };
    options.onProgress?.(completed);
    return completed;
  } catch (error) {
    if (error instanceof QuickUseCancelledError) {
      await cancelTemplateRun(run.id).catch((cancelError) => {
        console.error('Could not mark the cancelled Quick Use run:', cancelError);
      });
      options.onProgress?.({
        runId: run.id,
        status: 'cancelled',
        currentStep,
        totalSteps: run.workflow.steps.length,
        stepResults: [...stepOutcomes],
      });
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Quick Use execution failed.';
    if (currentStep === 0) {
      await cancelTemplateRun(run.id).catch((cancelError) => {
        console.error('Could not cancel an unprepared Quick Use run:', cancelError);
      });
    }
    const failed: QuickUseExecutionProgress = {
      runId: run.id,
      status: 'failed',
      currentStep,
      totalSteps: run.workflow.steps.length,
      error: message,
      stepResults: [...stepOutcomes],
    };
    options.onProgress?.(failed);
    throw error;
  }
}
