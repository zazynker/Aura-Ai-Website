// utils/generateService.ts

import { supabase } from "./supabase";

export interface GenerateOptions {
  prompt: string;
  imageUrl?: string; // Base/scene image (e.g., model photo)
  productImageUrl?: string; // Product image to replace/insert
  numberOfImages?: number;
  imageSize?: "512" | "1K" | "2K" | "4K";
  aspectRatio?: string;
}

export interface GenerateResult {
  success: boolean;
  images?: string[];
  text?: string;
  error?: string;
  imageSize?: string;
  tokensUsed?: number;
  creditsUsed?: number;
  creditsDeducted?: number;
  newCredits?: number;
  actualCostUsd?: number;
  requestId?: string;
  recovered?: boolean;
  tokenBreakdown?: {
    inputTokens: number;
    outputTextTokens: number;
    outputImageTokens: number;
    thinkingTokens: number;
    totalTokens: number;
  };
}

type GenerateApiResponse = GenerateResult & {
  code?: string;
  pending?: boolean;
};

// Friendly error messages
const ERROR_MESSAGES: Record<number, string> = {
  400: "Invalid request. Please check your inputs and try again.",
  401: "Please log in to generate images.",
  402: "Not enough credits for image generation.",
  403: "4K resolution is available for Pro users only. Upgrade to unlock.",
  413: "Image too large. Please use images under 10MB each, or try compressing them first.",
  429: "Slow down! Please wait a moment before generating more images.",
  500: "Server error. Please try again in a few moments.",
  502: "Service temporarily unavailable. Checking whether your image was already saved…",
  503: "Service is busy. Checking whether your image was already saved…",
  504: "The request timed out. Checking whether your image was already saved…",
};

const IMAGE_RECOVERY_ATTEMPTS = 5;
const IMAGE_RECOVERY_DELAY_MS = 1500;

const imageSleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const makeImageRequestId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

const normalizeGenerateResponse = (
  data: GenerateApiResponse,
): GenerateResult => ({
  success: true,
  images: Array.isArray(data.images) ? data.images : [],
  text: data.text || "",
  imageSize: data.imageSize,
  tokensUsed: Number(data.tokensUsed) || 0,
  creditsUsed: Number(data.creditsUsed) || 0,
  creditsDeducted: Number(data.creditsDeducted) || 0,
  newCredits: typeof data.newCredits === "number" ? data.newCredits : undefined,
  actualCostUsd: Number(data.actualCostUsd) || 0,
  requestId: data.requestId,
  recovered: Boolean(data.recovered),
  tokenBreakdown: data.tokenBreakdown,
});

async function recoverGeneratedImages(
  accessToken: string,
  requestId: string,
): Promise<GenerateResult | null> {
  for (let attempt = 1; attempt <= IMAGE_RECOVERY_ATTEMPTS; attempt += 1) {
    await imageSleep(IMAGE_RECOVERY_DELAY_MS * attempt);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          requestId,
          recoverOnly: true,
        }),
      });

      if (response.status === 202) {
        continue;
      }

      const data = (await response
        .json()
        .catch(() => null)) as GenerateApiResponse | null;
      if (
        response.ok &&
        data?.success &&
        Array.isArray(data.images) &&
        data.images.length > 0
      ) {
        console.log(
          "Recovered generated image URLs after interrupted response:",
          {
            requestId,
            imageCount: data.images.length,
            attempt,
          },
        );
        return normalizeGenerateResponse(data);
      }
    } catch (recoveryError) {
      console.warn(
        `Image result recovery attempt ${attempt} failed:`,
        recoveryError,
      );
    }
  }

  return null;
}

/**
 * Generate images using the Gemini API via our serverless function.
 * The server stores generated image bytes in Supabase and returns short URLs.
 * A stable requestId lets this function recover the result without generating
 * or charging twice when the original HTTP response is interrupted.
 */
export async function generateImages(
  options: GenerateOptions,
): Promise<GenerateResult> {
  const {
    prompt,
    imageUrl,
    productImageUrl,
    numberOfImages = 1,
    imageSize = "1K",
    aspectRatio,
  } = options;

  console.log("=== generateImages called ===");
  console.log("Prompt:", prompt.substring(0, 100) + "...");
  console.log("Has base image:", !!imageUrl);
  console.log("Has product image:", !!productImageUrl);
  console.log("Image size:", imageSize);

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return {
      success: false,
      error: "Please log in to generate images.",
    };
  }

  const requestId = makeImageRequestId();
  console.log("User ID for generation:", session.user.id);
  console.log("Image request ID:", requestId);

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        prompt,
        imageUrl,
        productImageUrl,
        numberOfImages,
        imageSize,
        aspectRatio,
        requestId,
      }),
    });

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({}))) as GenerateApiResponse;
      console.error("API error:", response.status, errorData);

      if ([502, 503, 504].includes(response.status)) {
        const recovered = await recoverGeneratedImages(
          session.access_token,
          requestId,
        );
        if (recovered) return recovered;
      }

      return {
        success: false,
        error:
          errorData.error ||
          ERROR_MESSAGES[response.status] ||
          `Generation failed (Error ${response.status}). Please try again.`,
        requestId,
      };
    }

    let data: GenerateApiResponse;
    try {
      data = (await response.json()) as GenerateApiResponse;
    } catch (parseError) {
      console.error(
        "Unable to parse generation response; attempting recovery:",
        parseError,
      );
      const recovered = await recoverGeneratedImages(
        session.access_token,
        requestId,
      );
      if (recovered) return recovered;
      throw parseError;
    }

    console.log("API response:", {
      success: data.success,
      imageCount: data.images?.length,
      imageSize: data.imageSize,
      tokensUsed: data.tokensUsed,
      requestId: data.requestId || requestId,
      recovered: data.recovered,
    });

    if (
      !data.success ||
      !Array.isArray(data.images) ||
      data.images.length === 0
    ) {
      return {
        success: false,
        error: data.error || "Generation failed",
        tokensUsed: data.tokensUsed || 0,
        requestId: data.requestId || requestId,
      };
    }

    return normalizeGenerateResponse({
      ...data,
      requestId: data.requestId || requestId,
    });
  } catch (err) {
    console.error("Generate exception:", err);

    const recovered = await recoverGeneratedImages(
      session.access_token,
      requestId,
    );
    if (recovered) return recovered;

    return {
      success: false,
      error:
        "The connection was interrupted before the result could be confirmed. No new request was submitted. Please try again.",
      requestId,
    };
  }
}

// ============================================
// Video Generation (Kling via Fal)
// ============================================

export interface VideoGenerateOptions {
  mode: "image_to_video" | "motion_control" | "lip_sync";
  prompt?: string;
  startImageUrl?: string;
  endImageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  duration?: number;
  resolution?: "720p" | "1080p";
  characterOrientation?: "video" | "image";
  generationCount?: number;
  requestedOutputCount?: number;
  generateAudio?: boolean;
  allowConcurrent?: boolean;
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
  mode?: VideoGenerateOptions["mode"];
  creditsUsed?: number;
  creditsDeducted?: number;
  newCredits?: number;
  error?: string;
  code?: string;
}

interface VideoStatusResponse {
  status?:
    | "IN_QUEUE"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED"
    | string;
  videoUrl?: string;
  error?: string;
  code?: string;
}

export interface PendingVideoJob {
  clientJobId: string;
  userId: string;
  mode: VideoGenerateOptions["mode"];
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
  resolution?: "720p" | "1080p";
  characterOrientation?: "video" | "image";
  generationCount?: number;
  requestedOutputCount?: number;
  generateAudio?: boolean;
  creditsUsed?: number;
  createdAt: number;
  updatedAt: number;
}

const VIDEO_ERROR_MESSAGES: Record<number, string> = {
  400: "Invalid request. Please check your inputs and try again.",
  401: "Please log in to generate videos.",
  402: "Not enough credits for video generation.",
  403: "A Pro plan is required for this video setting.",
  429: "Slow down! Please wait a moment before generating more videos.",
  500: "Video generation server error. Please try again.",
  502: "Video service temporarily unavailable. The job may still be running. Use Resume instead of Generate.",
  503: "Video service is busy. The job may still be running. Use Resume instead of Generate.",
  504: "Video status check timed out. The job may still be running. Use Resume instead of Generate.",
};

const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_MAX_POLL_ATTEMPTS = 200;
const PENDING_VIDEO_JOBS_KEY = "lazora-pending-video-jobs-v2";
const LEGACY_PENDING_VIDEO_JOB_KEY = "lazora-pending-video-job-v1";
const PENDING_VIDEO_JOB_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const makeClientJobId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const isValidPendingVideoJob = (job: PendingVideoJob | null | undefined) =>
  Boolean(
    job?.requestId &&
      job?.endpoint &&
      job?.userId &&
      job?.mode &&
      Date.now() - Number(job.createdAt || 0) <= PENDING_VIDEO_JOB_MAX_AGE_MS,
  );

export function getPendingVideoJobs(): PendingVideoJob[] {
  const raw = localStorage.getItem(PENDING_VIDEO_JOBS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const jobs = (Array.isArray(parsed) ? parsed : []).filter(isValidPendingVideoJob) as PendingVideoJob[];
      if (jobs.length) {
        if (jobs.length !== parsed.length) {
          localStorage.setItem(PENDING_VIDEO_JOBS_KEY, JSON.stringify(jobs));
        }
        return jobs;
      }
    } catch {
      localStorage.removeItem(PENDING_VIDEO_JOBS_KEY);
    }
  }

  const legacyRaw = localStorage.getItem(LEGACY_PENDING_VIDEO_JOB_KEY);
  if (!legacyRaw) return [];
  try {
    const legacyJob = JSON.parse(legacyRaw) as PendingVideoJob;
    localStorage.removeItem(LEGACY_PENDING_VIDEO_JOB_KEY);
    if (!isValidPendingVideoJob(legacyJob)) return [];
    localStorage.setItem(PENDING_VIDEO_JOBS_KEY, JSON.stringify([legacyJob]));
    return [legacyJob];
  } catch {
    localStorage.removeItem(LEGACY_PENDING_VIDEO_JOB_KEY);
    return [];
  }
}

export function getPendingVideoJob(): PendingVideoJob | null {
  return getPendingVideoJobs()[0] || null;
}

export function savePendingVideoJob(job: PendingVideoJob) {
  const updatedJob = { ...job, updatedAt: Date.now() };
  const jobs = getPendingVideoJobs();
  const existingIndex = jobs.findIndex((item) => item.requestId === job.requestId);
  const next = existingIndex >= 0
    ? jobs.map((item, index) => (index === existingIndex ? updatedJob : item))
    : [...jobs, updatedJob];
  localStorage.setItem(PENDING_VIDEO_JOBS_KEY, JSON.stringify(next));
  localStorage.removeItem(LEGACY_PENDING_VIDEO_JOB_KEY);
}

export function clearPendingVideoJob(requestId?: string) {
  if (!requestId) {
    localStorage.removeItem(PENDING_VIDEO_JOBS_KEY);
    localStorage.removeItem(LEGACY_PENDING_VIDEO_JOB_KEY);
    return;
  }
  const next = getPendingVideoJobs().filter((job) => job.requestId !== requestId);
  if (next.length) localStorage.setItem(PENDING_VIDEO_JOBS_KEY, JSON.stringify(next));
  else localStorage.removeItem(PENDING_VIDEO_JOBS_KEY);
}

function isSameResumeCandidate(
  job: PendingVideoJob,
  userId: string,
  mode: VideoGenerateOptions["mode"],
) {
  return job.userId === userId && job.mode === mode;
}

function getUserFacingServiceError(value: unknown, fallback: string): string {
  const message = typeof value === "string" && value.trim() ? value : fallback;
  return message
    .replace(/Fal/gi, "generation service")
    .replace(/Kling/gi, "generation service");
}

async function getAccessToken(): Promise<
  { accessToken: string; userId: string } | { error: string }
> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return { error: "Please log in to generate videos." };
  }

  return {
    accessToken: session.access_token,
    userId: session.user.id,
  };
}

export async function pollPendingVideoJob(requestId?: string): Promise<VideoGenerateResult> {
  const auth = await getAccessToken();
  if ("error" in auth) {
    return { success: false, error: auth.error };
  }

  const pendingJob = requestId
    ? getPendingVideoJobs().find((job) => job.requestId === requestId) || null
    : getPendingVideoJob();
  if (!pendingJob) {
    return {
      success: false,
      error: "No pending video job found.",
    };
  }

  if (pendingJob.userId !== auth.userId) {
    clearPendingVideoJob(pendingJob.requestId);
    return {
      success: false,
      error: "Pending job belongs to a different user. It has been cleared.",
    };
  }

  return pollVideoJob(pendingJob, auth.accessToken);
}

export async function generateVideo(
  options: VideoGenerateOptions,
): Promise<VideoGenerateResult> {
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
    requestedOutputCount,
    generateAudio,
    allowConcurrent = false,
    clientJobId,
    onJobSubmitted,
  } = options;

  console.log("=== generateVideo called ===");
  console.log("Mode:", mode);
  console.log("Prompt:", prompt?.substring(0, 100));

  try {
    const auth = await getAccessToken();
    if ("error" in auth) {
      return { success: false, error: auth.error };
    }

    const existingJob = getPendingVideoJob();
    if (!allowConcurrent && existingJob && existingJob.userId === auth.userId) {
      if (isSameResumeCandidate(existingJob, auth.userId, mode)) {
        console.warn(
          "[generateVideo] Existing pending job found. Resuming instead of submitting a new Fal request:",
          {
            requestId: existingJob.requestId,
            endpoint: existingJob.endpoint,
            mode: existingJob.mode,
          },
        );
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

    const submitResponse = await fetch("/api/generate-video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
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
        requestedOutputCount,
        generateAudio,
      }),
    });

    if (!submitResponse.ok) {
      const errorData = await submitResponse.json().catch(() => ({}));
      const friendlyMessage = getUserFacingServiceError(
        errorData.error || VIDEO_ERROR_MESSAGES[submitResponse.status],
        `Video generation failed (Error ${submitResponse.status}).`,
      );

      return {
        success: false,
        error: friendlyMessage,
      };
    }

    const submitData = (await submitResponse.json()) as VideoSubmitResponse;

    if (!submitData.success || !submitData.requestId || !submitData.endpoint) {
      return {
        success: false,
        error: getUserFacingServiceError(
          submitData.error,
          "Failed to submit video generation job.",
        ),
      };
    }

    if (
      typeof submitData.newCredits === "number" &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(
        new CustomEvent("lazora-credits-updated", {
          detail: { credits: submitData.newCredits },
        }),
      );
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
      requestedOutputCount,
      generateAudio,
      creditsUsed: Number(submitData.creditsUsed) || 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    savePendingVideoJob(pendingJob);
    onJobSubmitted?.(pendingJob);

    console.log("Video job submitted and saved as pending:", {
      requestId: pendingJob.requestId,
      endpoint: pendingJob.endpoint,
      statusUrl: pendingJob.statusUrl,
      responseUrl: pendingJob.responseUrl,
      mode: pendingJob.mode,
    });

    return pollVideoJob(pendingJob, auth.accessToken);
  } catch (err) {
    console.error("generateVideo exception:", err);

    if (err instanceof TypeError && err.message.includes("fetch")) {
      const pending = getPendingVideoJob();
      return {
        success: false,
        pending: Boolean(pending),
        pendingJob: pending || undefined,
        error:
          "Network error. If the job was already submitted, use Resume instead of Generate.",
      };
    }

    return {
      success: false,
      error: getUserFacingServiceError(
        err instanceof Error ? err.message : undefined,
        "An unexpected error occurred.",
      ),
    };
  }
}

async function pollVideoJob(
  job: PendingVideoJob,
  accessToken: string,
): Promise<VideoGenerateResult> {
  for (let attempt = 0; attempt < VIDEO_MAX_POLL_ATTEMPTS; attempt += 1) {
    // On Resume / restored pending jobs, check immediately once instead of waiting 3 seconds.
    if (attempt > 0) {
      await sleep(VIDEO_POLL_INTERVAL_MS);
    }

    const statusResponse = await fetch("/api/video-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        requestId: job.requestId,
        endpoint: job.endpoint,
        statusUrl: job.statusUrl,
        responseUrl: job.responseUrl,
        createdAt: job.createdAt,
      }),
    });

    if (!statusResponse.ok) {
      const errorData = await statusResponse.json().catch(() => ({}));
      console.error(
        "Video status API error:",
        statusResponse.status,
        errorData,
      );

      const errorCode =
        typeof errorData?.code === "string" ? errorData.code : "";
      const isFalRequestMissing =
        statusResponse.status === 404 ||
        errorCode === "FAL_STATUS_NOT_FOUND" ||
        errorCode === "FAL_RESULT_NOT_FOUND";

      if (isFalRequestMissing) {
        clearPendingVideoJob(job.requestId);
        return {
          success: false,
          pending: false,
          requestId: job.requestId,
          status: "FAILED",
          error:
            "This pending request was not found. It has been cleared locally. Click Generate again to submit a new request.",
        };
      }

      const friendlyMessage = getUserFacingServiceError(
        errorData.error || VIDEO_ERROR_MESSAGES[statusResponse.status],
        `Video status check failed (Error ${statusResponse.status}).`,
      );

      savePendingVideoJob(job);
      return {
        success: false,
        pending: true,
        pendingJob: job,
        requestId: job.requestId,
        error: `${friendlyMessage} The job was already submitted. Do not generate again; click Resume to check this same job.`,
      };
    }

    const statusData = (await statusResponse.json()) as VideoStatusResponse;
    const status = String(statusData.status || "").toUpperCase();

    console.log("Video status:", {
      attempt: attempt + 1,
      status,
      requestId: job.requestId,
    });

    if (status === "COMPLETED") {
      if (!statusData.videoUrl) {
        savePendingVideoJob(job);
        return {
          success: false,
          pending: true,
          pendingJob: job,
          requestId: job.requestId,
          error:
            "Video completed but no video URL was returned. Use Resume to check the same job again.",
        };
      }

      clearPendingVideoJob(job.requestId);
      return {
        success: true,
        videoUrl: statusData.videoUrl,
        duration: job.duration,
        creditsUsed: job.creditsUsed || 0,
        requestId: job.requestId,
        status: "COMPLETED",
      };
    }

    if (status === "FAILED" || status === "CANCELLED") {
      clearPendingVideoJob(job.requestId);
      return {
        success: false,
        pending: false,
        requestId: job.requestId,
        status,
        error: getUserFacingServiceError(
          statusData.error,
          "Video generation failed.",
        ),
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
    error:
      "Video status checking timed out after about 10 minutes. The job may still be running. Click Check status / Resume instead of Generate.",
  };
}
