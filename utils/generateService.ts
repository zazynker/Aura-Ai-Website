// utils/generateService.ts

import { supabase } from './supabase';

export interface GenerateOptions {
  prompt: string;
  imageUrl?: string;        // Base/scene image (e.g., model photo)
  productImageUrl?: string; // Product image to replace/insert
  numberOfImages?: number;
  imageSize?: '512' | '1K' | '2K' | '4K';  // Output resolution
  aspectRatio?: string;     // e.g., "1:1", "16:9", "9:16"
}

export interface GenerateResult {
  success: boolean;
  images?: string[];
  text?: string;
  error?: string;
  imageSize?: string;
  tokensUsed?: number;  // Total tokens consumed by this generation
  newCredits?: number;  // User's new credit balance after deduction (optional)
}

// Friendly error messages
const ERROR_MESSAGES: Record<number, string> = {
  413: 'Image too large. Please use images under 10MB each, or try compressing them first.',
  400: 'Invalid request. Please check your inputs and try again.',
  401: 'Please log in to generate images.',
  403: '4K resolution is available for Pro users only. Upgrade to unlock.',
  429: 'Slow down! Please wait a moment before generating more images.',
  500: 'Server error. Please try again in a few moments.',
  502: 'Service temporarily unavailable. Please try again.',
  503: 'Service is busy. Please try again in a few moments.',
};

/**
 * Generate images using the Gemini API via our serverless function
 */
export async function generateImages(options: GenerateOptions): Promise<GenerateResult> {
  const {
    prompt,
    imageUrl,
    productImageUrl,
    numberOfImages = 1,
    imageSize = '1K',
    aspectRatio
  } = options;

  console.log('=== generateImages called ===');
  console.log('Prompt:', prompt.substring(0, 100) + '...');
  console.log('Has base image:', !!imageUrl);
  console.log('Has product image:', !!productImageUrl);
  console.log('Image size:', imageSize);

  try {
    // Get current session for auth token
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return {
        success: false,
        error: 'Please log in to generate images.',
      };
    }

    console.log('User ID for generation:', session.user.id);

    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        prompt,
        imageUrl,
        productImageUrl,
        numberOfImages,
        imageSize,
        aspectRatio,
        // userId no longer needed - backend extracts from JWT
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('API error:', response.status, errorData);

      // Use server error message if available, otherwise use friendly default
      const friendlyMessage = errorData.error ||
        ERROR_MESSAGES[response.status] ||
        `Generation failed (Error ${response.status}). Please try again.`;

      return {
        success: false,
        error: friendlyMessage,
      };
    }

    const data = await response.json();
    console.log('API response:', {
      success: data.success,
      imageCount: data.images?.length,
      imageSize: data.imageSize,
      tokensUsed: data.tokensUsed
    });

    if (!data.success) {
      return {
        success: false,
        error: data.error || 'Generation failed',
        tokensUsed: data.tokensUsed || 0,
      };
    }

    return {
      success: true,
      images: data.images || [],
      text: data.text || '',
      imageSize: data.imageSize,
      tokensUsed: data.tokensUsed || 0,
    };
  } catch (err) {
    console.error('Generate exception:', err);

    // Check for network errors
    if (err instanceof TypeError && err.message.includes('fetch')) {
      return {
        success: false,
        error: 'Network error. Please check your internet connection and try again.',
      };
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.',
    };
  }
}

// ============================================
// Video Generation (Kling via Fal)
// ============================================

export interface VideoGenerateOptions {
  mode: 'image_to_video' | 'motion_control' | 'lip_sync';
  prompt?: string;
  startImageUrl?: string;
  endImageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  duration?: number;
  resolution?: '720p' | '1080p';
  characterOrientation?: 'video' | 'image';
  generationCount?: number;
  clientJobId?: string;
  onJobSubmitted?: (job: PendingVideoJob) => void;
}

export interface VideoGenerateResult {
  success: boolean;
  videoUrl?: string;
  duration?: number;
  error?: string;
  creditsUsed?: number;
  pending?: boolean;
  pendingJob?: PendingVideoJob;
  requestId?: string;
  status?: string;
}

interface VideoSubmitResponse {
  success: boolean;
  requestId?: string;
  endpoint?: string;
  statusUrl?: string;
  responseUrl?: string;
  cancelUrl?: string;
  mode?: VideoGenerateOptions['mode'];
  error?: string;
  code?: string;
}

interface VideoStatusResponse {
  status?: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | string;
  videoUrl?: string;
  error?: string;
  code?: string;
}

export interface PendingVideoJob {
  clientJobId: string;
  userId: string;
  mode: VideoGenerateOptions['mode'];
  requestId: string;
  endpoint: string;
  statusUrl?: string;
  responseUrl?: string;
  cancelUrl?: string;
  prompt?: string;
  startImageUrl?: string;
  endImageUrl?: string;
  inputVideoUrl?: string;
  audioUrl?: string;
  duration?: number;
  resolution?: '720p' | '1080p';
  characterOrientation?: 'video' | 'image';
  generationCount?: number;
  createdAt: number;
  updatedAt: number;
}

const VIDEO_ERROR_MESSAGES: Record<number, string> = {
  400: 'Invalid request. Please check your inputs and try again.',
  401: 'Please log in to generate videos.',
  402: 'Not enough credits for video generation.',
  429: 'Slow down! Please wait a moment before generating more videos.',
  500: 'Video generation server error. Please try again.',
  502: 'Video service temporarily unavailable. The job may still be running. Use Resume instead of Generate.',
  503: 'Video service is busy. The job may still be running. Use Resume instead of Generate.',
  504: 'Video status check timed out. The job may still be running. Use Resume instead of Generate.',
};

const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_MAX_POLL_ATTEMPTS = 100;
const PENDING_VIDEO_JOB_KEY = 'lazora-pending-video-job-v1';
const PENDING_VIDEO_JOB_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const makeClientJobId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export function getPendingVideoJob(): PendingVideoJob | null {
  const raw = localStorage.getItem(PENDING_VIDEO_JOB_KEY);
  if (!raw) return null;

  try {
    const job = JSON.parse(raw) as PendingVideoJob;
    if (!job?.requestId || !job?.endpoint || !job?.userId || !job?.mode) {
      localStorage.removeItem(PENDING_VIDEO_JOB_KEY);
      return null;
    }

    if (Date.now() - Number(job.createdAt || 0) > PENDING_VIDEO_JOB_MAX_AGE_MS) {
      localStorage.removeItem(PENDING_VIDEO_JOB_KEY);
      return null;
    }

    return job;
  } catch {
    localStorage.removeItem(PENDING_VIDEO_JOB_KEY);
    return null;
  }
}

export function savePendingVideoJob(job: PendingVideoJob) {
  localStorage.setItem(
    PENDING_VIDEO_JOB_KEY,
    JSON.stringify({ ...job, updatedAt: Date.now() })
  );
}

export function clearPendingVideoJob() {
  localStorage.removeItem(PENDING_VIDEO_JOB_KEY);
}

function isSameResumeCandidate(
  job: PendingVideoJob,
  userId: string,
  mode: VideoGenerateOptions['mode']
) {
  return job.userId === userId && job.mode === mode;
}

async function getAccessToken(): Promise<{ accessToken: string; userId: string } | { error: string }> {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return { error: 'Please log in to generate videos.' };
  }

  return {
    accessToken: session.access_token,
    userId: session.user.id,
  };
}

export async function pollPendingVideoJob(): Promise<VideoGenerateResult> {
  const auth = await getAccessToken();
  if ('error' in auth) {
    return { success: false, error: auth.error };
  }

  const pendingJob = getPendingVideoJob();
  if (!pendingJob) {
    return {
      success: false,
      error: 'No pending video job found.',
    };
  }

  if (pendingJob.userId !== auth.userId) {
    clearPendingVideoJob();
    return {
      success: false,
      error: 'Pending job belongs to a different user. It has been cleared.',
    };
  }

  return pollVideoJob(pendingJob, auth.accessToken);
}

export async function generateVideo(options: VideoGenerateOptions): Promise<VideoGenerateResult> {
  const {
    mode,
    prompt,
    startImageUrl,
    endImageUrl,
    videoUrl,
    audioUrl,
    duration,
    resolution,
    characterOrientation,
    generationCount,
    clientJobId,
    onJobSubmitted,
  } = options;

  console.log('=== generateVideo called ===');
  console.log('Mode:', mode);
  console.log('Prompt:', prompt?.substring(0, 100));

  try {
    const auth = await getAccessToken();
    if ('error' in auth) {
      return { success: false, error: auth.error };
    }

    const existingJob = getPendingVideoJob();
    if (existingJob && existingJob.userId === auth.userId) {
      if (isSameResumeCandidate(existingJob, auth.userId, mode)) {
        console.warn('[generateVideo] Existing pending job found. Resuming instead of submitting a new Fal request:', {
          requestId: existingJob.requestId,
          endpoint: existingJob.endpoint,
          mode: existingJob.mode,
        });
        onJobSubmitted?.(existingJob);
        return pollVideoJob(existingJob, auth.accessToken);
      }

      return {
        success: false,
        pending: true,
        pendingJob: existingJob,
        requestId: existingJob.requestId,
        error: `A ${existingJob.mode} job is already pending. Resume or clear that job before submitting a new one.`,
      };
    }

    const submitResponse = await fetch('/api/generate-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({
        mode,
        prompt,
        startImageUrl,
        endImageUrl,
        videoUrl,
        audioUrl,
        duration,
        resolution,
        characterOrientation,
        generationCount,
      }),
    });

    if (!submitResponse.ok) {
      const errorData = await submitResponse.json().catch(() => ({}));
      const friendlyMessage =
        errorData.error ||
        VIDEO_ERROR_MESSAGES[submitResponse.status] ||
        `Video generation failed (Error ${submitResponse.status}).`;

      return {
        success: false,
        error: friendlyMessage,
      };
    }

    const submitData = (await submitResponse.json()) as VideoSubmitResponse;

    if (!submitData.success || !submitData.requestId || !submitData.endpoint) {
      return {
        success: false,
        error: submitData.error || 'Failed to submit video generation job.',
      };
    }

    const pendingJob: PendingVideoJob = {
      clientJobId: clientJobId || makeClientJobId(),
      userId: auth.userId,
      mode,
      requestId: submitData.requestId,
      endpoint: submitData.endpoint,
      statusUrl: submitData.statusUrl,
      responseUrl: submitData.responseUrl,
      cancelUrl: submitData.cancelUrl,
      prompt,
      startImageUrl,
      endImageUrl,
      inputVideoUrl: videoUrl,
      audioUrl,
      duration,
      resolution,
      characterOrientation,
      generationCount,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    savePendingVideoJob(pendingJob);
    onJobSubmitted?.(pendingJob);

    console.log('Video job submitted and saved as pending:', {
      requestId: pendingJob.requestId,
      endpoint: pendingJob.endpoint,
      statusUrl: pendingJob.statusUrl,
      responseUrl: pendingJob.responseUrl,
      mode: pendingJob.mode,
    });

    return pollVideoJob(pendingJob, auth.accessToken);
  } catch (err) {
    console.error('generateVideo exception:', err);

    if (err instanceof TypeError && err.message.includes('fetch')) {
      const pending = getPendingVideoJob();
      return {
        success: false,
        pending: Boolean(pending),
        pendingJob: pending || undefined,
        error: 'Network error. If the job was already submitted, use Resume instead of Generate.',
      };
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred.',
    };
  }
}

async function pollVideoJob(job: PendingVideoJob, accessToken: string): Promise<VideoGenerateResult> {
  for (let attempt = 0; attempt < VIDEO_MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(VIDEO_POLL_INTERVAL_MS);

    const statusResponse = await fetch('/api/video-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        requestId: job.requestId,
        endpoint: job.endpoint,
        statusUrl: job.statusUrl,
        responseUrl: job.responseUrl,
      }),
    });

    if (!statusResponse.ok) {
      const errorData = await statusResponse.json().catch(() => ({}));
      console.error('Video status API error:', statusResponse.status, errorData);

      const friendlyMessage =
        errorData.error ||
        VIDEO_ERROR_MESSAGES[statusResponse.status] ||
        `Video status check failed (Error ${statusResponse.status}).`;

      savePendingVideoJob(job);
      return {
        success: false,
        pending: true,
        pendingJob: job,
        requestId: job.requestId,
        error: `${friendlyMessage} The Fal job was already submitted. Do not generate again; click Resume to check this same job.`,
      };
    }

    const statusData = (await statusResponse.json()) as VideoStatusResponse;
    const status = String(statusData.status || '').toUpperCase();

    console.log('Video status:', {
      attempt: attempt + 1,
      status,
      requestId: job.requestId,
    });

    if (status === 'COMPLETED') {
      if (!statusData.videoUrl) {
        savePendingVideoJob(job);
        return {
          success: false,
          pending: true,
          pendingJob: job,
          requestId: job.requestId,
          error: 'Video completed but no video URL was returned. Use Resume to check the same job again.',
        };
      }

      clearPendingVideoJob();
      return {
        success: true,
        videoUrl: statusData.videoUrl,
        duration: job.duration,
        creditsUsed: 0,
        requestId: job.requestId,
        status: 'COMPLETED',
      };
    }

    if (status === 'FAILED' || status === 'CANCELLED') {
      clearPendingVideoJob();
      return {
        success: false,
        pending: false,
        requestId: job.requestId,
        status,
        error: statusData.error || 'Video generation failed.',
      };
    }

    savePendingVideoJob(job);
  }

  savePendingVideoJob(job);
  return {
    success: false,
    pending: true,
    pendingJob: job,
    requestId: job.requestId,
    error: 'Video status checking timed out. The Fal job may still be running. Click Resume instead of Generate.',
  };
}
