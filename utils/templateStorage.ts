import { supabase } from './supabase';

export const TEMPLATE_PREVIEWS_BUCKET = 'template-previews';
export const TEMPLATE_ASSETS_BUCKET = 'template-assets';

export const TEMPLATE_UPLOAD_LIMITS = {
  coverImageBytes: 10 * 1024 * 1024,
  coverVideoBytes: 20 * 1024 * 1024,
  coverVideoSeconds: 15,
  coverClipSeconds: 2,
  materialBytes: 25 * 1024 * 1024,
} as const;

const COVER_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);
const COVER_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
const MATERIAL_TYPES = {
  image: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  video: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
  audio: new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/mp4',
  ]),
} as const;

export type TemplateAssetType = keyof typeof MATERIAL_TYPES;

export interface TemplateStorageIdentity {
  userId: string;
  templateId: string;
  versionId: string;
}

export interface UploadedTemplateObject {
  bucket: string;
  path: string;
  publicUrl: string | null;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface UploadedTemplateCover {
  coverType: 'image' | 'video';
  original: UploadedTemplateObject;
  thumbnail: UploadedTemplateObject;
}

export interface UploadedTemplateVideoWithPoster {
  original: UploadedTemplateObject;
  poster: UploadedTemplateObject;
}

export interface GenerationAssetReference {
  source: 'generation';
  generationId: string;
  url: string;
  assetType: TemplateAssetType;
}

interface ImageVariant {
  blob: Blob;
  width: number;
  height: number;
}

interface VideoVariant extends ImageVariant {
  mimeType: string;
  durationSeconds: number;
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeSegment(value: string): string {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return sanitized || 'asset';
}

function extensionForMime(mimeType: string): string {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
  };
  return extensions[mimeType] || 'bin';
}

function buildObjectPath(
  identity: TemplateStorageIdentity,
  objectName: string,
  mimeType: string,
): string {
  const filename = `${sanitizeSegment(objectName)}-${randomId()}.${extensionForMime(mimeType)}`;
  const directory = [identity.userId, identity.templateId, identity.versionId]
    .map(sanitizeSegment)
    .join('/');
  return `${directory}/${filename}`;
}

function assertFile(
  file: File,
  allowedTypes: ReadonlySet<string>,
  maxBytes: number,
  label: string,
): void {
  if (!allowedTypes.has(file.type)) {
    throw new Error(`${label} file type ${file.type || 'unknown'} is not supported.`);
  }
  if (file.size <= 0) throw new Error(`${label} file is empty.`);
  if (file.size > maxBytes) {
    throw new Error(`${label} must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.`);
  }
}

export function validateTemplateCoverFile(file: File): void {
  if (file.type.startsWith('image/')) {
    assertFile(file, COVER_IMAGE_TYPES, TEMPLATE_UPLOAD_LIMITS.coverImageBytes, 'Cover image');
    return;
  }
  assertFile(file, COVER_VIDEO_TYPES, TEMPLATE_UPLOAD_LIMITS.coverVideoBytes, 'Cover video');
}

export function validateTemplateMaterialFile(
  file: File,
  assetType: TemplateAssetType,
  label = 'Template material',
): void {
  assertFile(file, MATERIAL_TYPES[assetType], TEMPLATE_UPLOAD_LIMITS.materialBytes, label);
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('The image could not be decoded.'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be converted to WebP.'))),
      'image/webp',
      quality,
    );
  });
}

async function createImageVariant(
  source: Blob,
  maxWidth: number,
  maxHeight: number,
  quality: number,
): Promise<ImageVariant> {
  const image = await loadImage(source);
  const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot process the image.');
  context.drawImage(image, 0, 0, width, height);
  return { blob: await canvasToBlob(canvas, quality), width, height };
}

async function readVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    // `loadedmetadata` only guarantees dimensions and duration. Drawing at that
    // point can capture a transparent canvas before the first frame is decoded.
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => resolve(video);
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('The video could not be decoded.'));
    };
    video.src = objectUrl;
    video.load();
  });
}

async function waitForDecodedVideoFrame(
  video: HTMLVideoElement,
  requestedTime: number,
): Promise<void> {
  const maximumTime = Number.isFinite(video.duration)
    ? Math.max(0, video.duration - 0.05)
    : requestedTime;
  const targetTime = Math.min(Math.max(requestedTime, 0), maximumTime);

  if (Math.abs(video.currentTime - targetTime) > 0.01) {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Timed out while seeking the cover video.')),
        5_000,
      );
      const finish = () => {
        window.clearTimeout(timeout);
        video.removeEventListener('seeked', finish);
        video.removeEventListener('error', fail);
        resolve();
      };
      const fail = () => {
        window.clearTimeout(timeout);
        video.removeEventListener('seeked', finish);
        video.removeEventListener('error', fail);
        reject(new Error('The cover video could not seek to a preview frame.'));
      };
      video.addEventListener('seeked', finish, { once: true });
      video.addEventListener('error', fail, { once: true });
      video.currentTime = targetTime;
    });
  }

  if (typeof video.requestVideoFrameCallback === 'function') {
    await new Promise<void>((resolve) => {
      let callbackId = 0;
      const timeout = window.setTimeout(() => {
        if (typeof video.cancelVideoFrameCallback === 'function') {
          video.cancelVideoFrameCallback(callbackId);
        }
        resolve();
      }, 2_000);
      callbackId = video.requestVideoFrameCallback(() => {
        window.clearTimeout(timeout);
        resolve();
      });
    });
    return;
  }

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

function canvasContainsVideoFrame(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  const pixels = context.getImageData(0, 0, width, height).data;
  const sampleStride = Math.max(1, Math.floor((width * height) / 2_000)) * 4;
  let visibleSamples = 0;

  for (let index = 3; index < pixels.length; index += sampleStride) {
    if (pixels[index] > 16) {
      visibleSamples += 1;
      if (visibleSamples >= 8) return true;
    }
  }
  return false;
}

async function createVideoPoster(
  video: HTMLVideoElement,
  preferredTime?: number,
): Promise<ImageVariant> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('The cover video has no readable frame dimensions.');
  }

  const scale = Math.min(1, 480 / video.videoWidth, 640 / video.videoHeight);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot create a video poster.');

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const candidateTimes = [
    ...(preferredTime === undefined
      ? []
      : [Math.min(Math.max(preferredTime, 0), Math.max(0, duration - 0.05))]),
    Math.min(Math.max(duration / 2, 0.1), 1),
    Math.min(Math.max(duration * 0.25, 0.1), Math.max(0.1, duration - 0.05)),
    Math.min(0.1, Math.max(0, duration - 0.05)),
  ].filter((time, index, values) => values.indexOf(time) === index);

  for (const seekTime of candidateTimes) {
    await waitForDecodedVideoFrame(video, seekTime);
    context.clearRect(0, 0, width, height);
    context.drawImage(video, 0, 0, width, height);
    if (canvasContainsVideoFrame(context, width, height)) {
      return { blob: await canvasToBlob(canvas, 0.82), width, height };
    }
  }

  throw new Error('The video preview frame was empty. Please try another video.');
}

function createCoverRecorder(
  stream: MediaStream,
): { recorder: MediaRecorder; uploadMimeType: string } {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot create a compact video cover.');
  }

  const supportedTypes = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].filter((mimeType) => MediaRecorder.isTypeSupported(mimeType));

  for (const mimeType of supportedTypes) {
    try {
      return {
        recorder: new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 800_000,
        }),
        uploadMimeType: mimeType.split(';', 1)[0],
      };
    } catch {
      // Some browsers report a codec as supported but cannot initialize it for
      // a canvas stream. Continue to the next broadly playable format.
    }
  }

  throw new Error('This browser cannot encode a compact MP4 or WebM cover.');
}

async function createVideoVariant(
  video: HTMLVideoElement,
  requestedStartSeconds: number,
): Promise<VideoVariant> {
  if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
    throw new Error('The cover video has no readable dimensions or duration.');
  }

  const clipDuration = Math.min(TEMPLATE_UPLOAD_LIMITS.coverClipSeconds, video.duration);
  const startSeconds = Math.min(
    Math.max(Number.isFinite(requestedStartSeconds) ? requestedStartSeconds : 0, 0),
    Math.max(0, video.duration - clipDuration),
  );
  const endSeconds = startSeconds + clipDuration;
  const scale = Math.min(1, 720 / video.videoWidth, 720 / video.videoHeight);
  const width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
  const height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context || typeof canvas.captureStream !== 'function') {
    throw new Error('This browser cannot create a compact video cover.');
  }

  await waitForDecodedVideoFrame(video, startSeconds);
  context.drawImage(video, 0, 0, width, height);

  const stream = canvas.captureStream(30);
  const chunks: Blob[] = [];
  let recorderSetup: ReturnType<typeof createCoverRecorder>;
  try {
    recorderSetup = createCoverRecorder(stream);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const { recorder, uploadMimeType } = recorderSetup;
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('error', () => {
      reject(new Error('The compact video cover could not be encoded.'));
    }, { once: true });
    recorder.addEventListener('stop', () => {
      const blob = new Blob(chunks, { type: uploadMimeType });
      if (blob.size <= 0) {
        reject(new Error('The compact video cover was empty.'));
        return;
      }
      resolve(blob);
    }, { once: true });
  });

  let processingError: unknown = null;
  let recorderStarted = false;
  try {
    recorder.start(200);
    recorderStarted = true;
    video.playbackRate = 1;
    await video.play();
    await new Promise<void>((resolve, reject) => {
      let frameRequest = 0;
      const timeout = window.setTimeout(() => {
        window.cancelAnimationFrame(frameRequest);
        reject(new Error('Timed out while creating the 2-second video cover.'));
      }, 8_000);
      const finish = () => {
        window.clearTimeout(timeout);
        window.cancelAnimationFrame(frameRequest);
        resolve();
      };
      const drawFrame = () => {
        context.drawImage(video, 0, 0, width, height);
        if (video.ended || video.currentTime >= endSeconds - 0.02) {
          finish();
          return;
        }
        frameRequest = window.requestAnimationFrame(drawFrame);
      };
      frameRequest = window.requestAnimationFrame(drawFrame);
    });
  } catch (error) {
    processingError = error;
  } finally {
    video.pause();
    if (recorderStarted && recorder.state !== 'inactive') recorder.stop();
  }

  if (!recorderStarted) {
    stream.getTracks().forEach((track) => track.stop());
    throw processingError instanceof Error
      ? processingError
      : new Error('The compact video cover could not be encoded.');
  }

  try {
    const blob = await stopped;
    if (processingError) throw processingError;
    return {
      blob,
      mimeType: uploadMimeType,
      width,
      height,
      durationSeconds: clipDuration,
    };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

async function uploadObject(
  bucket: string,
  path: string,
  body: File | Blob,
  mimeType: string,
  dimensions?: { width?: number; height?: number; durationSeconds?: number },
): Promise<UploadedTemplateObject> {
  const { data, error } = await supabase.storage.from(bucket).upload(path, body, {
    contentType: mimeType,
    cacheControl: bucket === TEMPLATE_PREVIEWS_BUCKET ? '31536000' : '3600',
    upsert: false,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const publicUrl =
    bucket === TEMPLATE_PREVIEWS_BUCKET
      ? supabase.storage.from(bucket).getPublicUrl(data.path).data.publicUrl
      : null;

  return {
    bucket,
    path: data.path,
    publicUrl,
    mimeType,
    byteSize: body.size,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    durationSeconds: dimensions?.durationSeconds ?? null,
  };
}

export async function uploadTemplateCover(
  identity: TemplateStorageIdentity,
  file: File,
  videoStartSeconds = 0,
): Promise<UploadedTemplateCover> {
  if (file.type.startsWith('image/')) {
    validateTemplateCoverFile(file);
    const [cover, thumbnail] = await Promise.all([
      createImageVariant(file, 1600, 1600, 0.88),
      createImageVariant(file, 480, 640, 0.8),
    ]);
    const coverPath = buildObjectPath(identity, 'cover', 'image/webp');
    const thumbnailPath = buildObjectPath(identity, 'cover-thumb', 'image/webp');
    const uploadedCover = await uploadObject(
      TEMPLATE_PREVIEWS_BUCKET,
      coverPath,
      cover.blob,
      'image/webp',
      cover,
    );
    try {
      const uploadedThumbnail = await uploadObject(
        TEMPLATE_PREVIEWS_BUCKET,
        thumbnailPath,
        thumbnail.blob,
        'image/webp',
        thumbnail,
      );
      return { coverType: 'image', original: uploadedCover, thumbnail: uploadedThumbnail };
    } catch (error) {
      await supabase.storage.from(TEMPLATE_PREVIEWS_BUCKET).remove([uploadedCover.path]);
      throw error;
    }
  }

  validateTemplateCoverFile(file);
  const video = await readVideo(file);
  try {
    if (!Number.isFinite(video.duration) || video.duration > TEMPLATE_UPLOAD_LIMITS.coverVideoSeconds) {
      throw new Error(`Cover video must be ${TEMPLATE_UPLOAD_LIMITS.coverVideoSeconds} seconds or shorter.`);
    }
    const clipDuration = Math.min(TEMPLATE_UPLOAD_LIMITS.coverClipSeconds, video.duration);
    const clipStart = Math.min(
      Math.max(Number.isFinite(videoStartSeconds) ? videoStartSeconds : 0, 0),
      Math.max(0, video.duration - clipDuration),
    );
    const poster = await createVideoPoster(video, clipStart + Math.min(0.5, clipDuration / 2));
    const compactVideo = await createVideoVariant(video, clipStart);
    const videoPath = buildObjectPath(identity, 'cover-video', compactVideo.mimeType);
    const posterPath = buildObjectPath(identity, 'cover-poster', 'image/webp');
    const uploadedVideo = await uploadObject(
      TEMPLATE_PREVIEWS_BUCKET,
      videoPath,
      compactVideo.blob,
      compactVideo.mimeType,
      {
        width: compactVideo.width,
        height: compactVideo.height,
        durationSeconds: compactVideo.durationSeconds,
      },
    );
    try {
      const uploadedPoster = await uploadObject(
        TEMPLATE_PREVIEWS_BUCKET,
        posterPath,
        poster.blob,
        'image/webp',
        poster,
      );
      return { coverType: 'video', original: uploadedVideo, thumbnail: uploadedPoster };
    } catch (error) {
      await supabase.storage.from(TEMPLATE_PREVIEWS_BUCKET).remove([uploadedVideo.path]);
      throw error;
    }
  } finally {
    URL.revokeObjectURL(video.src);
  }
}

export async function uploadTemplateMaterial(
  identity: TemplateStorageIdentity,
  file: File,
  assetType: TemplateAssetType,
  assetKey: string,
): Promise<UploadedTemplateObject> {
  validateTemplateMaterialFile(file, assetType);
  const path = buildObjectPath(identity, assetKey, file.type);
  return uploadObject(TEMPLATE_ASSETS_BUCKET, path, file, file.type);
}

export async function uploadTemplateVideoWithPoster(
  identity: TemplateStorageIdentity,
  file: File,
  assetKey: string,
): Promise<UploadedTemplateVideoWithPoster> {
  validateTemplateMaterialFile(file, 'video', 'Result video');
  const video = await readVideo(file);
  try {
    const poster = await createVideoPoster(video);
    const videoPath = buildObjectPath(identity, assetKey, file.type);
    const posterPath = buildObjectPath(identity, `${assetKey}-poster`, 'image/webp');
    const original = await uploadObject(
      TEMPLATE_ASSETS_BUCKET,
      videoPath,
      file,
      file.type,
      {
        width: video.videoWidth,
        height: video.videoHeight,
        durationSeconds: video.duration,
      },
    );
    try {
      const uploadedPoster = await uploadObject(
        TEMPLATE_PREVIEWS_BUCKET,
        posterPath,
        poster.blob,
        'image/webp',
        poster,
      );
      return { original, poster: uploadedPoster };
    } catch (error) {
      await supabase.storage.from(TEMPLATE_ASSETS_BUCKET).remove([original.path]);
      throw error;
    }
  } finally {
    URL.revokeObjectURL(video.src);
  }
}

export function referenceGenerationAsset(
  generationId: string,
  url: string,
  assetType: TemplateAssetType,
): GenerationAssetReference {
  if (!generationId || !url) throw new Error('Generation reference is incomplete.');
  return { source: 'generation', generationId, url, assetType };
}

export async function createTemplateAssetSignedUrl(
  path: string,
  expiresInSeconds = 300,
): Promise<string> {
  const expires = Math.min(Math.max(expiresInSeconds, 60), 3600);
  const { data, error } = await supabase.storage
    .from(TEMPLATE_ASSETS_BUCKET)
    .createSignedUrl(path, expires);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not create a private asset URL: ${error?.message || 'unknown error'}`);
  }
  return data.signedUrl;
}

export async function removeTemplateStorageObjects(
  bucket: typeof TEMPLATE_PREVIEWS_BUCKET | typeof TEMPLATE_ASSETS_BUCKET,
  paths: string[],
): Promise<void> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (uniquePaths.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove(uniquePaths);
  if (error) throw new Error(`Could not remove replaced template files: ${error.message}`);
}
