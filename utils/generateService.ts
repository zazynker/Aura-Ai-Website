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
}

export interface VideoGenerateResult {
  success: boolean;
  videoUrl?: string;
  duration?: number;
  error?: string;
  creditsUsed?: number;
}

interface VideoSubmitResponse {
  success: boolean;
  requestId?: string;
  endpoint?: string;
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

const VIDEO_ERROR_MESSAGES: Record<number, string> = {
  400: 'Invalid request. Please check your inputs and try again.',
  401: 'Please log in to generate videos.',
  402: 'Not enough credits for video generation.',
  429: 'Slow down! Please wait a moment before generating more videos.',
  500: 'Video generation server error. Please try again.',
  502: 'Video service temporarily unavailable. Please try again.',
  503: 'Video service is busy. Please try again in a few moments.',
  504: 'Video generation timed out. Please try again.',
};

const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_MAX_POLL_ATTEMPTS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  } = options;

  console.log('=== generateVideo called ===');
  console.log('Mode:', mode);
  console.log('Prompt:', prompt?.substring(0, 100));

  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return {
        success: false,
        error: 'Please log in to generate videos.',
      };
    }

    // Step 1: Submit job to backend. Backend only creates the Fal request and returns requestId.
    const submitResponse = await fetch('/api/generate-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
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

    console.log('Video job submitted:', {
      requestId: submitData.requestId,
      endpoint: submitData.endpoint,
      mode: submitData.mode,
    });

    // Step 2: Poll status from frontend every 3 seconds.
    for (let attempt = 0; attempt < VIDEO_MAX_POLL_ATTEMPTS; attempt += 1) {
      await sleep(VIDEO_POLL_INTERVAL_MS);

      const statusResponse = await fetch('/api/video-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          requestId: submitData.requestId,
          endpoint: submitData.endpoint,
        }),
      });

      if (!statusResponse.ok) {
        const errorData = await statusResponse.json().catch(() => ({}));
        const friendlyMessage =
          errorData.error ||
          VIDEO_ERROR_MESSAGES[statusResponse.status] ||
          `Video status check failed (Error ${statusResponse.status}).`;

        return {
          success: false,
          error: friendlyMessage,
        };
      }

      const statusData = (await statusResponse.json()) as VideoStatusResponse;
      const status = String(statusData.status || '').toUpperCase();

      console.log('Video status:', {
        attempt: attempt + 1,
        status,
      });

      if (status === 'COMPLETED') {
        if (!statusData.videoUrl) {
          return {
            success: false,
            error: 'Video completed but no video URL was returned.',
          };
        }

        return {
          success: true,
          videoUrl: statusData.videoUrl,
          duration,
          creditsUsed: 0,
        };
      }

      if (status === 'FAILED' || status === 'CANCELLED') {
        return {
          success: false,
          error: statusData.error || 'Video generation failed.',
        };
      }
    }

    return {
      success: false,
      error: 'Video generation timed out. Please try again later.',
    };
  } catch (err) {
    console.error('generateVideo exception:', err);

    if (err instanceof TypeError && err.message.includes('fetch')) {
      return {
        success: false,
        error: 'Network error. Please check your connection.',
      };
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred.',
    };
  }
}