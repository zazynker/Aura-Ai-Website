// utils/generateService.ts

import { supabase } from "./supabase";
import {
  beginActiveTemplateGeneration,
  failTemplateGeneration,
  type TemplateGenerationContext,
} from "./templateRunGeneration";

export interface GenerateOptions {
  prompt: string;
  capability?: string;
  provider?: "fal-gpt-image-2-edit" | "evolink-mj-v8.1";
  imageUrl?: string; // Base/scene image (e.g., model photo)
  productImageUrl?: string; // Product image to replace/insert
  referenceImageUrls?: string[];
  numberOfImages?: number;
  imageSize?: "512" | "1K" | "2K" | "4K";
  aspectRatio?: string;
  quality?: "low" | "medium" | "high";
  mjQuality?: "standard" | "hd";
  mjParams?: {
    stylize?: number;
    chaos?: number;
    experimental?: number;
    raw?: boolean;
    seed?: number;
    referenceMode?: "image" | "style" | "omni";
    imageWeight?: number;
    styleWeight?: number;
    omniWeight?: number;
    imageReferenceUrl?: string;
    styleReferenceUrl?: string;
    omniReferenceUrl?: string;
  };
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
  eligiblePaidCredits?: number;
  creditDeductionId?: string;
  newCredits?: number;
  actualCostUsd?: number;
  provider?: string;
  quality?: string;
  requestId?: string;
  recovered?: boolean;
  pending?: boolean;
  templateRunId?: string;
  templateStepId?: string;
  templateCapability?: string;
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

const IMAGE_RECOVERY_ATTEMPTS = 180;
const IMAGE_RECOVERY_DELAY_MS = 3000;

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
  eligiblePaidCredits: Number(data.eligiblePaidCredits) || 0,
  creditDeductionId: data.creditDeductionId,
  newCredits: typeof data.newCredits === "number" ? data.newCredits : undefined,
  actualCostUsd: Number(data.actualCostUsd) || 0,
  provider: data.provider,
  quality: data.quality,
  requestId: data.requestId,
  recovered: Boolean(data.recovered),
  tokenBreakdown: data.tokenBreakdown,
});

const addTemplateContext = <T extends object>(
  value: T,
  context: TemplateGenerationContext | null | undefined,
): T & Partial<TemplateGenerationContext> => ({
  ...value,
  ...(context || {}),
});

const safelyFailTemplateGeneration = async (
  context: TemplateGenerationContext | null | undefined,
  error: unknown,
) => {
  try {
    await failTemplateGeneration(context, error);
  } catch (lifecycleError) {
    console.error("Unable to record workflow step failure:", lifecycleError);
  }
};

async function recoverGeneratedImages(
  accessToken: string,
  requestId: string,
  context?: TemplateGenerationContext | null,
): Promise<GenerateResult | null> {
  let consecutiveNotFound = 0;

  for (let attempt = 1; attempt <= IMAGE_RECOVERY_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await imageSleep(IMAGE_RECOVERY_DELAY_MS);

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
          ...(context || {}),
        }),
      });

      const data = (await response
        .json()
        .catch(() => null)) as GenerateApiResponse | null;

      if (response.status === 202 || data?.pending) {
        consecutiveNotFound = 0;
        console.log("Image generation is still pending:", {
          requestId,
          attempt,
          status: (data as GenerateApiResponse & { status?: string } | null)?.status,
        });
        continue;
      }

      if (response.status === 404 && data?.code === "REQUEST_NOT_FOUND") {
        consecutiveNotFound += 1;
        // The initial submit response may have been interrupted while the server
        // was still persisting the Fal recovery record. Allow a few short retries.
        if (consecutiveNotFound < 4) continue;
        return addTemplateContext({
          success: false,
          error: "The image request could not be found. Please submit it again.",
          requestId,
        }, context);
      }

      if (
        response.ok &&
        data?.success &&
        Array.isArray(data.images) &&
        data.images.length > 0
      ) {
        console.log("Recovered completed image generation:", {
          requestId,
          imageCount: data.images.length,
          attempt,
        });
        return addTemplateContext(normalizeGenerateResponse(data), context);
      }

      if (!response.ok || data?.error) {
        const retryable = [500, 502, 503, 504].includes(response.status) ||
          data?.code === "FAL_STATUS_FAILED" ||
          data?.code === "FAL_RESULT_FINALIZATION_FAILED" ||
          data?.code === "EVOLINK_STATUS_FAILED" ||
          data?.code === "EVOLINK_RESULT_FINALIZATION_FAILED";
        if (retryable && attempt < IMAGE_RECOVERY_ATTEMPTS) {
          console.warn("Image finalization is temporarily unavailable; retrying the same request:", {
            requestId,
            attempt,
            status: response.status,
            code: data?.code,
          });
          continue;
        }
        return addTemplateContext({
          success: false,
          error:
            data?.error ||
            ERROR_MESSAGES[response.status] ||
            `Image generation failed (Error ${response.status}).`,
          requestId,
        }, context);
      }
    } catch (recoveryError) {
      console.warn(
        `Image result polling attempt ${attempt} failed:`,
        recoveryError,
      );
      // A transient browser/network failure should not create a second Fal job.
      // Keep polling the same requestId until the overall polling window expires.
    }
  }

  return addTemplateContext({
    success: false,
    pending: true,
    error:
      "The image is still processing and could not be confirmed within 9 minutes. Do not submit it again immediately; try this page again later.",
    requestId,
  }, context);
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
    referenceImageUrls,
    capability,
    provider,
    numberOfImages = 1,
    imageSize = "1K",
    aspectRatio,
    quality = "medium",
    mjQuality,
    mjParams,
  } = options;

  console.log("=== generateImages called ===");
  console.log("Prompt:", prompt.substring(0, 100) + "...");
  console.log("Has base image:", !!imageUrl);
  console.log("Has product image:", !!productImageUrl);
  console.log("Image size:", imageSize);
  console.log("Capability:", capability || "image.modify");
  console.log("Provider override:", provider || "default");
  console.log("Quality:", quality);

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
  let templateContext: TemplateGenerationContext | null = null;
  console.log("User ID for generation:", session.user.id);
  console.log("Image request ID:", requestId);

  try {
    if (capability) {
      templateContext = await beginActiveTemplateGeneration(capability);
    }

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
        referenceImageUrls,
        numberOfImages,
        imageSize,
        aspectRatio,
        capability,
        provider,
        quality,
        mjQuality,
        mjParams,
        requestId,
        ...(templateContext || {}),
      }),
    });

    if (response.status === 202) {
      console.log("Image request accepted by the queue:", { requestId });
      const completed = await recoverGeneratedImages(
        session.access_token,
        requestId,
        templateContext,
      );
      if (completed) {
        if (!completed.success && !completed.pending) {
          await safelyFailTemplateGeneration(templateContext, completed.error);
        }
        return completed;
      }
    }

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({}))) as GenerateApiResponse;
      console.error("API error:", response.status, errorData);

      if ([502, 503, 504].includes(response.status)) {
        const recovered = await recoverGeneratedImages(
          session.access_token,
          requestId,
          templateContext,
        );
        if (recovered) return recovered;
      }

      const failure = {
        success: false,
        error:
          errorData.error ||
          ERROR_MESSAGES[response.status] ||
          `Generation failed (Error ${response.status}). Please try again.`,
        requestId,
      };
      await safelyFailTemplateGeneration(templateContext, failure.error);
      return addTemplateContext(failure, templateContext);
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
        templateContext,
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
      const failure = {
        success: false,
        error: data.error || "Generation failed",
        tokensUsed: data.tokensUsed || 0,
        requestId: data.requestId || requestId,
      };
      await safelyFailTemplateGeneration(templateContext, failure.error);
      return addTemplateContext(failure, templateContext);
    }

    return addTemplateContext(normalizeGenerateResponse({
      ...data,
      requestId: data.requestId || requestId,
    }), templateContext);
  } catch (err) {
    console.error("Generate exception:", err);

    const recovered = await recoverGeneratedImages(
      session.access_token,
      requestId,
      templateContext,
    );
    if (recovered) return recovered;

    const failure = {
      success: false,
      error:
        "The connection was interrupted and Lazora could not confirm the image result. The same request was checked repeatedly, so do not submit a duplicate immediately.",
      requestId,
    };
    await safelyFailTemplateGeneration(templateContext, failure.error);
    return addTemplateContext(failure, templateContext);
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
  creditsDeducted?: number;
  eligiblePaidCredits?: number;
  creditDeductionId?: string;
  pending?: boolean;
  pendingJob?: PendingVideoJob;
  requestId?: string;
  status?: string;
  templateRunId?: string;
  templateStepId?: string;
  templateCapability?: string;
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
  eligiblePaidCredits?: number;
  creditDeductionId?: string;
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
  templateRunId?: string;
  templateStepId?: string;
  templateCapability?: string;
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

const getVideoTemplateCapability = (
  options: Pick<VideoGenerateOptions, "mode" | "videoUrl">,
): string => {
  if (options.mode === "motion_control") return "video.motion_control";
  if (options.mode === "lip_sync") {
    return options.videoUrl ? "video.lip_sync_video" : "video.lip_sync_image";
  }
  return "video.image_to_video";
};

const getPendingJobTemplateContext = (
  job: PendingVideoJob,
): TemplateGenerationContext | null => {
  if (!job.templateRunId || !job.templateStepId || !job.templateCapability) return null;
  return {
    templateRunId: job.templateRunId,
    templateStepId: job.templateStepId,
    templateCapability: job.templateCapability,
  };
};

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

  let templateContext: TemplateGenerationContext | null = null;

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

    templateContext = await beginActiveTemplateGeneration(
      getVideoTemplateCapability({ mode, videoUrl }),
    );

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
        ...(templateContext || {}),
      }),
    });

    if (!submitResponse.ok) {
      const errorData = await submitResponse.json().catch(() => ({}));
      const friendlyMessage = getUserFacingServiceError(
        errorData.error || VIDEO_ERROR_MESSAGES[submitResponse.status],
        `Video generation failed (Error ${submitResponse.status}).`,
      );

      await safelyFailTemplateGeneration(templateContext, friendlyMessage);
      return addTemplateContext({
        success: false,
        error: friendlyMessage,
      }, templateContext);
    }

    const submitData = (await submitResponse.json()) as VideoSubmitResponse;

    if (!submitData.success || !submitData.requestId || !submitData.endpoint) {
      const error = getUserFacingServiceError(
        submitData.error,
        "Failed to submit video generation job.",
      );
      await safelyFailTemplateGeneration(templateContext, error);
      return addTemplateContext({
        success: false,
        error,
      }, templateContext);
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
      ...(templateContext || {}),
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
      if (!pending) await safelyFailTemplateGeneration(templateContext, err);
      return addTemplateContext({
        success: false,
        pending: Boolean(pending),
        pendingJob: pending || undefined,
        error:
          "Network error. If the job was already submitted, use Resume instead of Generate.",
      }, pending ? getPendingJobTemplateContext(pending) : templateContext);
    }

    await safelyFailTemplateGeneration(templateContext, err);
    return addTemplateContext({
      success: false,
      error: getUserFacingServiceError(
        err instanceof Error ? err.message : undefined,
        "An unexpected error occurred.",
      ),
    }, templateContext);
  }
}

async function pollVideoJob(
  job: PendingVideoJob,
  accessToken: string,
): Promise<VideoGenerateResult> {
  const templateContext = getPendingJobTemplateContext(job);
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
        const error = "This pending request was not found. It has been cleared locally. Click Generate again to submit a new request.";
        await safelyFailTemplateGeneration(templateContext, error);
        return addTemplateContext({
          success: false,
          pending: false,
          requestId: job.requestId,
          status: "FAILED",
          error,
        }, templateContext);
      }

      const friendlyMessage = getUserFacingServiceError(
        errorData.error || VIDEO_ERROR_MESSAGES[statusResponse.status],
        `Video status check failed (Error ${statusResponse.status}).`,
      );

      savePendingVideoJob(job);
      return addTemplateContext({
        success: false,
        pending: true,
        pendingJob: job,
        requestId: job.requestId,
        error: `${friendlyMessage} The job was already submitted. Do not generate again; click Resume to check this same job.`,
      }, templateContext);
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
        return addTemplateContext({
          success: false,
          pending: true,
          pendingJob: job,
          requestId: job.requestId,
          error:
            "Video completed but no video URL was returned. Use Resume to check the same job again.",
        }, templateContext);
      }

      clearPendingVideoJob(job.requestId);
      return addTemplateContext({
        success: true,
        videoUrl: statusData.videoUrl,
        duration: job.duration,
        creditsUsed: job.creditsUsed || 0,
        requestId: job.requestId,
        status: "COMPLETED",
      }, templateContext);
    }

    if (status === "FAILED" || status === "CANCELLED") {
      clearPendingVideoJob(job.requestId);
      const error = getUserFacingServiceError(
        statusData.error,
        "Video generation failed.",
      );
      await safelyFailTemplateGeneration(templateContext, error);
      return addTemplateContext({
        success: false,
        pending: false,
        requestId: job.requestId,
        status,
        error,
      }, templateContext);
    }

    savePendingVideoJob(job);
  }

  savePendingVideoJob(job);
  return addTemplateContext({
    success: false,
    pending: true,
    pendingJob: job,
    requestId: job.requestId,
    error:
      "Video status checking timed out after about 10 minutes. The job may still be running. Click Check status / Resume instead of Generate.",
  }, templateContext);
}
