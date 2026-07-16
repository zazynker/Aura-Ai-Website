import { supabase } from './supabase';

export const TEMPLATE_PREVIEWS_BUCKET = 'template-previews';
export const TEMPLATE_ASSETS_BUCKET = 'template-assets';

const MAX_COVER_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_COVER_VIDEO_BYTES = 5 * 1024 * 1024;
const MAX_COVER_VIDEO_SECONDS = 15;
const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;

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
    throw new Error(`${label} must be smaller than ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }
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
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('The video could not be decoded.'));
    };
    video.src = objectUrl;
  });
}

async function createVideoPoster(video: HTMLVideoElement): Promise<ImageVariant> {
  const seekTime = Math.min(Math.max(video.duration / 2, 0.1), 1);
  await new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve();
    video.onerror = () => reject(new Error('The video poster could not be generated.'));
    video.currentTime = seekTime;
  });
  const scale = Math.min(1, 480 / video.videoWidth, 640 / video.videoHeight);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot create a video poster.');
  context.drawImage(video, 0, 0, width, height);
  return { blob: await canvasToBlob(canvas, 0.82), width, height };
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
): Promise<UploadedTemplateCover> {
  if (file.type.startsWith('image/')) {
    assertFile(file, COVER_IMAGE_TYPES, MAX_COVER_IMAGE_BYTES, 'Cover image');
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

  assertFile(file, COVER_VIDEO_TYPES, MAX_COVER_VIDEO_BYTES, 'Cover video');
  const video = await readVideo(file);
  try {
    if (!Number.isFinite(video.duration) || video.duration > MAX_COVER_VIDEO_SECONDS) {
      throw new Error(`Cover video must be ${MAX_COVER_VIDEO_SECONDS} seconds or shorter.`);
    }
    const poster = await createVideoPoster(video);
    const videoPath = buildObjectPath(identity, 'cover-video', file.type);
    const posterPath = buildObjectPath(identity, 'cover-poster', 'image/webp');
    const uploadedVideo = await uploadObject(
      TEMPLATE_PREVIEWS_BUCKET,
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
  assertFile(file, MATERIAL_TYPES[assetType], MAX_MATERIAL_BYTES, 'Template material');
  const path = buildObjectPath(identity, assetKey, file.type);
  return uploadObject(TEMPLATE_ASSETS_BUCKET, path, file, file.type);
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
