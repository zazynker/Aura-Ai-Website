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
import { generateImages, generateVideo } from './generateService';
import { saveGenerationsToDb } from './api';
import { supabase } from './supabase';
import {
  cancelTemplateRun,
  completeTemplateRunStep,
  createRunIdempotencyKey,
  engageTemplateRunStep,
  startTemplateRun,
} from './templateRunApi';
import type { TemplateGenerationContext } from './templateRunGeneration';

export type QuickUseBrowserValue = JsonPrimitive | File;
export type QuickUseBrowserValues = Partial<Record<QuickUseCandidateId, QuickUseBrowserValue>>;

export interface QuickUseExecutionProgress {
  runId: string;
  status: 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  totalSteps: number;
  stepId?: string;
  stepTitle?: string;
  error?: string;
  result?: {
    type: 'image' | 'video';
    url: string;
  };
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
  let currentStep = 0;
  const report = (progress: Omit<QuickUseExecutionProgress, 'runId' | 'totalSteps'>) => {
    options.onProgress?.({ ...progress, runId: run.id, totalSteps: run.workflow.steps.length });
  };
  report({ status: 'preparing', currentStep: 0 });

  try {
    throwIfCancelled(options.signal);
    const [definition, templateAssetUrls, resolvedValues] = await awaitWithCancellation(Promise.all([
      loadLockedQuickUseDefinition(run.templateId, run.templateVersionId),
      loadTemplateAssetUrls(run.templateId, run.templateVersionId),
      resolveBrowserValues(options.userId, options.values),
    ]), options.signal);
    const plan = compileQuickUseExecutionPlan(
      run.workflow as unknown as WorkflowDefinition,
      definition,
      resolvedValues,
      templateAssetUrls,
    );
    const resultsByStepId = new Map<string, StepResult>();

    for (let index = 0; index < plan.steps.length; index += 1) {
      throwIfCancelled(options.signal);
      const step = plan.steps[index];
      currentStep = index + 1;
      report({ status: 'running', currentStep: index + 1, stepId: step.id, stepTitle: step.title });
      await awaitWithCancellation(engageTemplateRunStep(run.id, step.id, 'all'), options.signal);
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
      }
      throwIfCancelled(options.signal);
    }

    const finalResult = resultsByStepId.get(plan.steps[plan.steps.length - 1].id);
    if (!finalResult) throw new Error('Quick Use completed without a final result.');
    const completed: QuickUseExecutionProgress = {
      runId: run.id,
      status: 'completed',
      currentStep: plan.steps.length,
      totalSteps: plan.steps.length,
      result: finalResult,
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
    };
    options.onProgress?.(failed);
    throw error;
  }
}
