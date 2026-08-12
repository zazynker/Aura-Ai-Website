import {
  estimateCredits,
  estimateFalImageCredits,
  estimateMjImageCredits,
  estimateVideoCredits,
  type Resolution,
} from '../context/StoreContext';
import type { QuickUseInputValues } from '../components/template/TemplateExperienceModal';
import type { TemplateQuickUseCreditStep } from './templateDetailApi';

const asNumber = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);
const asString = (value: unknown, fallback = ''): string => (
  typeof value === 'string' ? value : fallback
);
const asBoolean = (value: unknown, fallback: boolean): boolean => (
  typeof value === 'boolean' ? value : fallback
);

const applyQuickUseSettings = (
  step: TemplateQuickUseCreditStep,
  values: QuickUseInputValues,
): Record<string, unknown> => {
  const parameters = { ...step.parameters };
  const prefix = `quick-use:setting:${encodeURIComponent(step.id)}:`;
  Object.entries(values).forEach(([candidateId, value]) => {
    if (!candidateId.startsWith(prefix) || value instanceof File || value == null) return;
    parameters[decodeURIComponent(candidateId.slice(prefix.length))] = value;
  });
  return parameters;
};

const countImageInputs = (step: TemplateQuickUseCreditStep, values: QuickUseInputValues): number => (
  step.imageInputs.filter((input) => {
    if (input.hasDefault) return true;
    const candidateId = `quick-use:input:${encodeURIComponent(step.id)}:${encodeURIComponent(input.slot)}`;
    return values[candidateId] instanceof File;
  }).length
);

const estimateStepCredits = (step: TemplateQuickUseCreditStep, values: QuickUseInputValues): number => {
  const parameters = applyQuickUseSettings(step, values);
  const outputCount = Math.max(1, Math.floor(asNumber(parameters.outputCount, 1)));
  const inputImageCount = countImageInputs(step, values);
  if (step.capability === 'image.text_to_image') {
    if (asString(parameters.model, 'gpt-image-2') === 'mj-v8.1') {
      return estimateMjImageCredits(asString(parameters.quality) === 'hd' ? 'hd' : 'standard');
    }
    return estimateFalImageCredits({ mode: inputImageCount > 0 ? 'edit' : 'text', resolution: asString(parameters.resolution, '1K') as Resolution, aspectRatio: asString(parameters.ratio, '1:1'), imageCount: outputCount, quality: 'medium', inputImageCount: Math.min(2, inputImageCount) });
  }
  if (step.capability === 'image.replace_product' || step.capability === 'image.modify') {
    return estimateFalImageCredits({ mode: 'edit', resolution: '1K', aspectRatio: 'auto', imageCount: outputCount, quality: 'medium', inputImageCount: Math.min(2, Math.max(1, inputImageCount)) });
  }
  if (step.capability === 'image.change_ratio' || step.capability === 'image.enhance') return estimateCredits('1K', outputCount);
  if (step.capability === 'image.upscale') return estimateCredits(asString(parameters.resolution, '2K') as Resolution, 1);
  if (step.capability === 'video.image_to_video') return estimateVideoCredits({ mode: 'image_to_video', duration: asNumber(parameters.duration, 3), resolution: asString(parameters.resolution, '720p') === '1080p' ? '1080p' : '720p', generateAudio: asBoolean(parameters.generateAudio, true) });
  if (step.capability === 'video.motion_control') return estimateVideoCredits({ mode: 'motion_control', duration: asNumber(parameters.duration, 5), resolution: asString(parameters.resolution, '720p') === '1080p' ? '1080p' : '720p' });
  if (step.capability === 'video.lip_sync_image' || step.capability === 'video.lip_sync_video') return estimateVideoCredits({ mode: 'lip_sync', duration: asNumber(parameters.duration, 5), lipSyncInput: step.capability === 'video.lip_sync_image' ? 'image' : 'video' });
  return 0;
};

export const estimateQuickUseCredits = (steps: TemplateQuickUseCreditStep[], values: QuickUseInputValues): number => (
  steps.reduce((total, step) => total + estimateStepCredits(step, values), 0)
);
