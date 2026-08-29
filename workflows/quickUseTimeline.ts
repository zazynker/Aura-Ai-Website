import type {
  QuickUseDefinition,
  QuickUseTimelineClipSource,
  QuickUseTimelineDefinition,
} from './quickUseTypes';

export const QUICK_USE_TIMELINE_MAX_VIDEO_CLIPS = 8;
export const QUICK_USE_TIMELINE_MAX_AUDIO_CLIPS = 8;
export const QUICK_USE_TIMELINE_MAX_START_MS = 6 * 60 * 60 * 1000;
export const QUICK_USE_TIMELINE_MIN_DURATION_SCALE = 1;
export const QUICK_USE_TIMELINE_MAX_DURATION_SCALE = 2;
export const QUICK_USE_TIMELINE_ASSET_KEY_PREFIX = 'timeline-asset-';

export const createDefaultTimelineDefinition = (): QuickUseTimelineDefinition => ({
  enabled: false,
  preserveVideoAudio: true,
  videoClips: [],
  audioClips: [],
});

export const createTimelineAssetKey = (clipId: string): string => (
  `${QUICK_USE_TIMELINE_ASSET_KEY_PREFIX}${clipId.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80)}`
);

export const getTimelineTemplateAssetSources = (
  definition: QuickUseDefinition | null | undefined,
): Array<{ assetKey: string; assetType: 'video' | 'audio' }> => {
  if (!definition?.timeline) return [];
  const sources: Array<{ assetKey: string; assetType: 'video' | 'audio' }> = [];
  definition.timeline.videoClips.forEach((clip) => {
    if (clip.source.kind === 'template_asset') sources.push({ assetKey: clip.source.assetKey, assetType: 'video' });
  });
  definition.timeline.audioClips.forEach((clip) => {
    if (clip.source.kind === 'template_asset') sources.push({ assetKey: clip.source.assetKey, assetType: 'audio' });
  });
  return sources;
};

export const setTimelineClipSource = (
  definition: QuickUseDefinition,
  clipType: 'video' | 'audio',
  clipId: string,
  source: QuickUseTimelineClipSource,
): QuickUseDefinition => {
  const timeline = definition.timeline || createDefaultTimelineDefinition();
  return {
    ...definition,
    timeline: clipType === 'video'
      ? { ...timeline, videoClips: timeline.videoClips.map((clip) => clip.id === clipId ? { ...clip, source } : clip) }
      : { ...timeline, audioClips: timeline.audioClips.map((clip) => clip.id === clipId ? { ...clip, source } : clip) },
  };
};
