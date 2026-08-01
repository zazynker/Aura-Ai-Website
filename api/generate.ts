import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 60 };

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent";
const USD_TO_CREDITS = 195;
const INPUT_USD_PER_MILLION = 0.5;
const TEXT_AND_THINKING_USD_PER_MILLION = 3.0;
const IMAGE_OUTPUT_USD_PER_MILLION = 60.0;
const ESTIMATED_OVERHEAD_USD_PER_IMAGE = 0.005;

const FAL_QUEUE_BASE_URL = "https://queue.fal.run";
const FAL_GPT_IMAGE_2_TEXT_ENDPOINT = "openai/gpt-image-2";
const FAL_GPT_IMAGE_2_EDIT_ENDPOINT = "openai/gpt-image-2/edit";
const FAL_TEXT_INPUT_USD_PER_MILLION = 5.0;
const FAL_TEXT_OUTPUT_USD_PER_MILLION = 10.0;
const FAL_IMAGE_INPUT_USD_PER_MILLION = 8.0;
const FAL_IMAGE_OUTPUT_USD_PER_MILLION = 30.0;
const FAL_MIN_EXTRA_INPUT_IMAGE_USD = 0.006;
const FAL_MAX_TOTAL_PIXELS = 8_294_400;
const EVOLINK_API_BASE_URL = "https://api.evolink.ai/v1";
const EVOLINK_MJ_MODEL = "mj-v8.1";
const EVOLINK_MJ_STANDARD_USD = Number(process.env.EVOLINK_MJ_STANDARD_USD || 0.08);
const EVOLINK_MJ_HD_USD = Number(process.env.EVOLINK_MJ_HD_USD || 0.12);

// Initialize Supabase client for user verification
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ============ INPUT VALIDATION CONSTANTS ============
const VALID_SIZES = ["512", "1K", "2K", "4K"];
const MAX_PROMPT_LENGTH = 2000;
const MAX_IMAGES = 4;
const GENERATED_IMAGES_BUCKET = "generations";
const GENERATED_IMAGE_FOLDER = "requests";
const GENERATION_MANIFEST_NAME = "manifest.json";
const PENDING_GENERATION_MANIFEST_NAME = "pending.json";

// Estimated tokens per image for credit pre-check
const ESTIMATED_TOKENS_PER_IMAGE: Record<string, number> = {
  "512": 747,
  "1K": 1120,
  "2K": 1680,
  "4K": 2520,
};

type TokenBreakdown = {
  inputTokens: number;
  outputTextTokens: number;
  outputImageTokens: number;
  thinkingTokens: number;
  totalTokens: number;
};
type GeneratedImagePayload = { base64: string; mimeType: string };
type FalImageQuality = "low" | "medium" | "high";
type MjImageQuality = "standard" | "hd";
type MjReferenceMode = "image" | "style" | "omni";
type FalImageMode = "text" | "edit";
type FalImageSize = string | { width: number; height: number };
type FalImageFile = {
  url?: unknown;
  content_type?: unknown;
  width?: unknown;
  height?: unknown;
};
type FalUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
  input_tokens_details?: { image_tokens?: unknown; text_tokens?: unknown };
  output_tokens_details?: { image_tokens?: unknown; text_tokens?: unknown };
};
type FalImageOutput = {
  images?: FalImageFile[];
  usage?: FalUsage;
};
type FalQueueSubmitResult = {
  requestId: string;
  statusUrl?: string;
  responseUrl?: string;
  cancelUrl?: string;
};
type StoredFalPendingGeneration = {
  version: 1;
  provider: "fal-gpt-image-2";
  clientRequestId: string;
  falRequestId: string;
  endpoint: string;
  statusUrl?: string;
  responseUrl?: string;
  cancelUrl?: string;
  submittedAt: string;
  mode: FalImageMode;
  quality: FalImageQuality;
  falImageSize: FalImageSize;
  requestedImageSize: string;
  aspectRatio?: string;
  requestedImages: number;
  inputImageCount: number;
  templateRunId?: string;
  templateStepId?: string;
  templateCapability?: string;
};
type StoredEvoLinkPendingGeneration = {
  version: 1;
  provider: "evolink-mj-v8.1";
  clientRequestId: string;
  evolinkTaskId: string;
  submittedAt: string;
  quality: MjImageQuality;
  aspectRatio: string;
  requestedImages: 4;
  templateRunId?: string;
  templateStepId?: string;
  templateCapability?: string;
};
type StoredPendingGeneration =
  | StoredFalPendingGeneration
  | StoredEvoLinkPendingGeneration;
type FalFinalizeResult =
  | { state: "pending"; status: string }
  | { state: "success"; payload: StoredGenerationManifest }
  | { state: "failed"; statusCode: number; code: string; error: string };
type FalCanonicalPrice = {
  width: number;
  height: number;
  low: number;
  medium: number;
  high: number;
};
type StoredGenerationManifest = {
  success: true;
  images: string[];
  text: string;
  count: number;
  imageSize?: string;
  tokensUsed: number;
  tokenBreakdown?: TokenBreakdown;
  actualCostUsd?: number;
  creditsUsed: number;
  creditsDeducted: number;
  eligiblePaidCredits: number;
  creditDeductionId?: string;
  newCredits?: number;
  requestId: string;
  recovered: boolean;
  provider?: string;
  quality?: FalImageQuality | MjImageQuality;
};
type GenerateRequestBody = {
  prompt?: string;
  imageUrl?: string;
  productImageUrl?: string;
  referenceImageUrls?: string[];
  numberOfImages?: number;
  imageSize?: string;
  aspectRatio?: string;
  capability?: string;
  provider?: "fal-gpt-image-2-edit" | "evolink-mj-v8.1";
  quality?: FalImageQuality;
  mjQuality?: MjImageQuality;
  mjParams?: {
    stylize?: number;
    chaos?: number;
    experimental?: number;
    raw?: boolean;
    seed?: number;
    referenceMode?: MjReferenceMode;
    imageWeight?: number;
    styleWeight?: number;
    omniWeight?: number;
  };
  requestId?: string;
  recoverOnly?: boolean;
  templateRunId?: string;
  templateStepId?: string;
  templateCapability?: string;
};
const emptyTokenBreakdown = (): TokenBreakdown => ({
  inputTokens: 0,
  outputTextTokens: 0,
  outputImageTokens: 0,
  thinkingTokens: 0,
  totalTokens: 0,
});
const addTokenBreakdown = (
  a: TokenBreakdown,
  b: TokenBreakdown,
): TokenBreakdown => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTextTokens: a.outputTextTokens + b.outputTextTokens,
  outputImageTokens: a.outputImageTokens + b.outputImageTokens,
  thinkingTokens: a.thinkingTokens + b.thinkingTokens,
  totalTokens: a.totalTokens + b.totalTokens,
});
function getModalityTokens(details: unknown, modality: string): number {
  if (!Array.isArray(details)) return 0;
  return details.reduce(
    (sum, detail: any) =>
      String(detail?.modality || "").toUpperCase() === modality
        ? sum + (Number(detail?.tokenCount) || 0)
        : sum,
    0,
  );
}
function parseTokenBreakdown(usage: any): TokenBreakdown {
  const details = usage?.candidatesTokensDetails;
  return {
    inputTokens: Number(usage?.promptTokenCount) || 0,
    outputTextTokens: Array.isArray(details)
      ? getModalityTokens(details, "TEXT")
      : 0,
    outputImageTokens: Array.isArray(details)
      ? getModalityTokens(details, "IMAGE")
      : Number(usage?.candidatesTokenCount) || 0,
    thinkingTokens: Number(usage?.thoughtsTokenCount) || 0,
    totalTokens: Number(usage?.totalTokenCount) || 0,
  };
}
function calculateGeminiCostUsd(t: TokenBreakdown): number {
  return (
    (t.inputTokens * INPUT_USD_PER_MILLION +
      (t.outputTextTokens + t.thinkingTokens) *
        TEXT_AND_THINKING_USD_PER_MILLION +
      t.outputImageTokens * IMAGE_OUTPUT_USD_PER_MILLION) /
    1_000_000
  );
}
function estimateImageCredits(size: string, count: number): number {
  const imageCost =
    (((ESTIMATED_TOKENS_PER_IMAGE[size] || 1120) * count) / 1_000_000) *
    IMAGE_OUTPUT_USD_PER_MILLION;
  return Math.ceil(
    (imageCost + ESTIMATED_OVERHEAD_USD_PER_IMAGE * count) * USD_TO_CREDITS,
  );
}


const FAL_GPT_IMAGE_2_PRICES: Record<FalImageMode, FalCanonicalPrice[]> = {
  text: [
    { width: 1024, height: 768, low: 0.005, medium: 0.037, high: 0.145 },
    { width: 1024, height: 1024, low: 0.006, medium: 0.053, high: 0.211 },
    { width: 1024, height: 1536, low: 0.005, medium: 0.042, high: 0.165 },
    { width: 1920, height: 1080, low: 0.005, medium: 0.040, high: 0.158 },
    { width: 2560, height: 1440, low: 0.007, medium: 0.056, high: 0.222 },
    { width: 3840, height: 2160, low: 0.012, medium: 0.101, high: 0.401 },
  ],
  edit: [
    { width: 1024, height: 768, low: 0.011, medium: 0.043, high: 0.151 },
    { width: 1024, height: 1024, low: 0.015, medium: 0.061, high: 0.219 },
    { width: 1024, height: 1536, low: 0.018, medium: 0.054, high: 0.178 },
    { width: 1920, height: 1080, low: 0.017, medium: 0.053, high: 0.158 },
    { width: 2560, height: 1440, low: 0.019, medium: 0.068, high: 0.234 },
    { width: 3840, height: 2160, low: 0.024, medium: 0.113, high: 0.413 },
  ],
};

function isFalGptImage2Capability(capability: unknown): boolean {
  return capability === "image.text_to_image" || capability === "image.replace_product";
}

function isFalGptImage2Request(body: GenerateRequestBody): boolean {
  if (body.provider === "evolink-mj-v8.1") return false;
  return (
    isFalGptImage2Capability(body.capability) ||
    body.provider === "fal-gpt-image-2-edit"
  );
}

function normalizeFalQuality(value: unknown): FalImageQuality {
  return value === "low" || value === "high" ? value : "medium";
}

function resolveFalMode(body: GenerateRequestBody): FalImageMode {
  if (
    body.capability === "image.replace_product" ||
    body.provider === "fal-gpt-image-2-edit"
  ) {
    return "edit";
  }
  return body.imageUrl || body.productImageUrl ? "edit" : "text";
}

function roundToMultipleOf16(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16);
}

function requestedFalDimensions(
  imageSize: string,
  aspectRatio = "1:1",
): { width: number; height: number } {
  const longEdgeBySize: Record<string, number> = {
    "512": 512,
    "1K": 1024,
    "2K": 2048,
    "4K": 3840,
  };
  const match = aspectRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  const ratio = match
    ? Math.max(1 / 3, Math.min(3, Number(match[1]) / Number(match[2])))
    : 1;
  const longEdge = longEdgeBySize[imageSize] || 1024;
  let width = ratio >= 1 ? longEdge : longEdge * ratio;
  let height = ratio >= 1 ? longEdge / ratio : longEdge;

  if (width * height > FAL_MAX_TOTAL_PIXELS) {
    const scale = Math.sqrt(FAL_MAX_TOTAL_PIXELS / (width * height));
    width *= scale;
    height *= scale;
  }

  return {
    width: roundToMultipleOf16(width),
    height: roundToMultipleOf16(height),
  };
}

function toFalImageSize(
  imageSize: string,
  aspectRatio: string | undefined,
  mode: FalImageMode,
): FalImageSize {
  if (mode === "edit" && !aspectRatio) return "auto";

  if (imageSize === "1K") {
    const presets: Record<string, string> = {
      "1:1": "square_hd",
      "4:3": "landscape_4_3",
      "3:4": "portrait_4_3",
      "16:9": "landscape_16_9",
      "9:16": "portrait_16_9",
    };
    const preset = presets[aspectRatio || "1:1"];
    if (preset) return preset;
  }
  if (imageSize === "512" && (!aspectRatio || aspectRatio === "1:1")) {
    return "square";
  }

  return requestedFalDimensions(imageSize, aspectRatio || "1:1");
}

function dimensionsForFalSize(
  imageSize: FalImageSize,
  fallbackSize: string,
  fallbackRatio: string | undefined,
): { width: number; height: number } {
  if (typeof imageSize === "object") return imageSize;
  const presets: Record<string, { width: number; height: number }> = {
    square: { width: 512, height: 512 },
    square_hd: { width: 1024, height: 1024 },
    portrait_4_3: { width: 768, height: 1024 },
    portrait_16_9: { width: 576, height: 1024 },
    landscape_4_3: { width: 1024, height: 768 },
    landscape_16_9: { width: 1024, height: 576 },
    auto: { width: 1024, height: 1024 },
  };
  return presets[imageSize] || requestedFalDimensions(fallbackSize, fallbackRatio || "1:1");
}

function closestFalCanonicalPrice(
  mode: FalImageMode,
  width: number,
  height: number,
): FalCanonicalPrice {
  const area = Math.max(1, width * height);
  const ratio = Math.max(0.01, width / Math.max(1, height));
  return FAL_GPT_IMAGE_2_PRICES[mode].reduce((best, candidate) => {
    const candidateArea = candidate.width * candidate.height;
    const candidateRatio = candidate.width / candidate.height;
    const candidateScore =
      Math.abs(Math.log(area / candidateArea)) +
      0.35 * Math.abs(Math.log(ratio / candidateRatio));
    const bestArea = best.width * best.height;
    const bestRatio = best.width / best.height;
    const bestScore =
      Math.abs(Math.log(area / bestArea)) +
      0.35 * Math.abs(Math.log(ratio / bestRatio));
    return candidateScore < bestScore ? candidate : best;
  });
}

function estimateFalCostUsd(
  mode: FalImageMode,
  quality: FalImageQuality,
  imageSize: FalImageSize,
  fallbackSize: string,
  fallbackRatio: string | undefined,
  imageCount: number,
  inputImageCount: number,
  outputMetadata?: FalImageFile[],
): number {
  const fallbackDimensions = dimensionsForFalSize(
    imageSize,
    fallbackSize,
    fallbackRatio,
  );
  const count = Math.max(1, Math.floor(imageCount));
  let outputCost = 0;
  for (let index = 0; index < count; index += 1) {
    const metadata = outputMetadata?.[index];
    const width = Number(metadata?.width) || fallbackDimensions.width;
    const height = Number(metadata?.height) || fallbackDimensions.height;
    const canonical = closestFalCanonicalPrice(mode, width, height);
    const textCanonical = closestFalCanonicalPrice("text", width, height);
    const extraInputImageCostUsd = mode === "edit"
      ? Math.max(FAL_MIN_EXTRA_INPUT_IMAGE_USD, canonical[quality] - textCanonical[quality])
      : 0;
    outputCost += canonical[quality] +
      Math.max(0, inputImageCount - 1) * extraInputImageCostUsd;
  }
  return outputCost;
}

function estimateFalCredits(body: GenerateRequestBody, imageCount: number): number {
  const mode = resolveFalMode(body);
  const quality = normalizeFalQuality(body.quality);
  const imageSize = toFalImageSize(body.imageSize || "1K", body.aspectRatio, mode);
  const inputImageCount = [body.imageUrl, body.productImageUrl].filter(Boolean).length;
  const costUsd = estimateFalCostUsd(
    mode,
    quality,
    imageSize,
    body.imageSize || "1K",
    body.aspectRatio,
    imageCount,
    inputImageCount,
  );
  return Math.max(1, Math.ceil(costUsd * USD_TO_CREDITS));
}

function falUsageToTokenBreakdown(usage: FalUsage | undefined): TokenBreakdown {
  if (!usage) return emptyTokenBreakdown();
  const outputDetails = usage.output_tokens_details;
  return {
    inputTokens: Number(usage.input_tokens) || 0,
    outputTextTokens: Number(outputDetails?.text_tokens) || 0,
    outputImageTokens: Number(outputDetails?.image_tokens) || 0,
    thinkingTokens: 0,
    totalTokens: Number(usage.total_tokens) || 0,
  };
}

function calculateFalUsageCostUsd(usage: FalUsage | undefined): number | null {
  if (!usage) return null;
  const inputDetails = usage.input_tokens_details;
  const outputDetails = usage.output_tokens_details;
  const inputText = Number(inputDetails?.text_tokens) || 0;
  const inputImage = Number(inputDetails?.image_tokens) || 0;
  const outputText = Number(outputDetails?.text_tokens) || 0;
  const outputImage = Number(outputDetails?.image_tokens) || 0;
  const detailedTotal = inputText + inputImage + outputText + outputImage;
  if (detailedTotal <= 0) return null;
  return (
    inputText * FAL_TEXT_INPUT_USD_PER_MILLION +
    inputImage * FAL_IMAGE_INPUT_USD_PER_MILLION +
    outputText * FAL_TEXT_OUTPUT_USD_PER_MILLION +
    outputImage * FAL_IMAGE_OUTPUT_USD_PER_MILLION
  ) / 1_000_000;
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

function unwrapFalOutput(payload: Record<string, unknown>): FalImageOutput {
  const nested = payload.data;
  return nested && typeof nested === "object"
    ? nested as FalImageOutput
    : payload as FalImageOutput;
}

function falEndpointForMode(mode: FalImageMode): string {
  return mode === "edit"
    ? FAL_GPT_IMAGE_2_EDIT_ENDPOINT
    : FAL_GPT_IMAGE_2_TEXT_ENDPOINT;
}

function getStringField(
  payload: Record<string, unknown>,
  snakeCase: string,
  camelCase: string,
): string | undefined {
  const value = payload[snakeCase] ?? payload[camelCase];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function falErrorMessage(payload: Record<string, unknown>, fallback: string): string {
  const detail = payload.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (detail && typeof detail === "object") {
    const nested = detail as Record<string, unknown>;
    const message = nested.message ?? nested.error;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  const message = payload.message ?? payload.error;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

function normalizeFalQueueStatus(payload: Record<string, unknown>): string {
  const raw = payload.status ?? payload.state ?? payload.queue_status ?? payload.queueStatus;
  if (typeof raw !== "string") return "IN_PROGRESS";
  const normalized = raw.trim().toUpperCase().replace(/[-\s]+/g, "_");
  if (["SUCCESS", "SUCCEEDED", "COMPLETE", "DONE"].includes(normalized)) return "COMPLETED";
  if (["RUNNING", "PROCESSING"].includes(normalized)) return "IN_PROGRESS";
  if (["QUEUED", "PENDING"].includes(normalized)) return "IN_QUEUE";
  if (normalized === "CANCELED") return "CANCELLED";
  return normalized;
}

async function submitFalGptImage2(
  mode: FalImageMode,
  payload: Record<string, unknown>,
  falKey: string,
): Promise<FalQueueSubmitResult> {
  const endpoint = falEndpointForMode(mode);
  const response = await fetch(`${FAL_QUEUE_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const responsePayload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      `Fal GPT Image 2 queue submission failed (${response.status}): ${falErrorMessage(responsePayload, response.statusText)}`,
    );
  }
  const requestId = getStringField(responsePayload, "request_id", "requestId");
  if (!requestId) throw new Error("Fal queue response did not include request_id.");
  return {
    requestId,
    statusUrl: getStringField(responsePayload, "status_url", "statusUrl"),
    responseUrl: getStringField(responsePayload, "response_url", "responseUrl"),
    cancelUrl: getStringField(responsePayload, "cancel_url", "cancelUrl"),
  };
}

async function getFalQueueStatus(
  pending: StoredFalPendingGeneration,
  falKey: string,
): Promise<Record<string, unknown>> {
  const url = pending.statusUrl ||
    `${FAL_QUEUE_BASE_URL}/${pending.endpoint}/requests/${pending.falRequestId}/status?logs=1`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Key ${falKey}` },
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      `Fal GPT Image 2 status failed (${response.status}): ${falErrorMessage(payload, response.statusText)}`,
    );
  }
  return payload;
}

async function getFalQueueResult(
  pending: StoredFalPendingGeneration,
  falKey: string,
): Promise<FalImageOutput> {
  const url = pending.responseUrl ||
    `${FAL_QUEUE_BASE_URL}/${pending.endpoint}/requests/${pending.falRequestId}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Key ${falKey}` },
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      `Fal GPT Image 2 result failed (${response.status}): ${falErrorMessage(payload, response.statusText)}`,
    );
  }
  const output = unwrapFalOutput(payload);
  if (!Array.isArray(output.images) || output.images.length === 0) {
    throw new Error("Fal GPT Image 2 completed without returning any images.");
  }
  return output;
}

async function downloadFalImages(images: FalImageFile[]): Promise<GeneratedImagePayload[]> {
  return Promise.all(images.map(async (image, index) => {
    const url = typeof image.url === "string" ? image.url : "";
    if (!url.startsWith("https://") && !url.startsWith("data:")) {
      throw new Error(`Fal image ${index + 1} has no usable URL.`);
    }
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error(`Fal image ${index + 1} returned an invalid data URI.`);
      return { mimeType: match[1], base64: match[2] };
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not download Fal image ${index + 1} (${response.status}).`);
    }
    const mimeType = response.headers.get("content-type") ||
      (typeof image.content_type === "string" ? image.content_type : "image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error(`Fal image ${index + 1} was empty.`);
    return { mimeType, base64: bytes.toString("base64") };
  }));
}
async function finalizeFalPendingGeneration(
  supabase: any,
  userId: string,
  pending: StoredFalPendingGeneration,
  falKey: string,
): Promise<FalFinalizeResult> {
  let statusPayload: Record<string, unknown>;
  try {
    statusPayload = await getFalQueueStatus(pending, falKey);
  } catch (error) {
    console.error("Fal image status check failed:", error);
    return {
      state: "failed",
      statusCode: 502,
      code: "FAL_STATUS_FAILED",
      error: error instanceof Error ? error.message : "Could not check Fal image status.",
    };
  }

  const status = normalizeFalQueueStatus(statusPayload);
  const statusError = falErrorMessage(statusPayload, "");
  console.log("Fal GPT Image 2 queue status:", {
    clientRequestId: pending.clientRequestId,
    falRequestId: pending.falRequestId,
    endpoint: pending.endpoint,
    status,
  });

  if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
    return { state: "pending", status };
  }

  if (status === "FAILED" || status === "CANCELLED" || statusError) {
    await deletePendingGeneration(supabase, userId, pending.clientRequestId);
    return {
      state: "failed",
      statusCode: 422,
      code: status === "CANCELLED" ? "FAL_CANCELLED" : "FAL_GENERATION_FAILED",
      error: statusError || "Fal image generation failed. No Lazora credits were deducted.",
    };
  }

  if (status !== "COMPLETED") {
    return { state: "pending", status: status || "IN_PROGRESS" };
  }

  try {
    const falOutput = await getFalQueueResult(pending, falKey);
    const falImages = (falOutput.images || []).slice(0, pending.requestedImages);
    const generatedImages = await downloadFalImages(falImages);
    const imageUrls = await uploadGeneratedImages(
      supabase,
      userId,
      pending.clientRequestId,
      generatedImages,
    );

    const tokenBreakdown = falUsageToTokenBreakdown(falOutput.usage);
    const usageCostUsd = calculateFalUsageCostUsd(falOutput.usage);
    const fallbackCostUsd = estimateFalCostUsd(
      pending.mode,
      pending.quality,
      pending.falImageSize,
      pending.requestedImageSize,
      pending.aspectRatio,
      imageUrls.length,
      pending.inputImageCount,
      falImages,
    );
    const actualCostUsd = usageCostUsd ?? fallbackCostUsd;
    const creditsToDeduct = Math.max(1, Math.ceil(actualCostUsd * USD_TO_CREDITS));

    const { data: deductResult, error: deductError } = await supabase.rpc(
      "deduct_generation_credits",
      {
        p_user_id: userId,
        p_amount: creditsToDeduct,
        p_request_id: pending.clientRequestId,
        p_template_run_id: pending.templateRunId || null,
        p_template_step_id: pending.templateStepId || null,
        p_capability: pending.templateCapability || null,
      },
    );
    const deductionSucceeded =
      !deductError && deductResult && deductResult.success === true;
    if (!deductionSucceeded) {
      console.error("Fal image credit deduction failed:", {
        requestId: pending.clientRequestId,
        deductError: deductError?.message,
        deductResult,
        creditsToDeduct,
      });
      await deleteStoredGenerationArtifacts(supabase, userId, pending.clientRequestId);
      await deletePendingGeneration(supabase, userId, pending.clientRequestId);
      const insufficientCredits =
        !deductError && deductResult?.error === "Insufficient credits";
      return {
        state: "failed",
        statusCode: insufficientCredits ? 402 : 500,
        code: insufficientCredits ? "INSUFFICIENT_CREDITS" : "CREDIT_DEDUCTION_FAILED",
        error: insufficientCredits
          ? "Your credit balance changed while the image was generating. No image was delivered."
          : "Unable to charge credits. No image was delivered.",
      };
    }

    const responsePayload: StoredGenerationManifest = {
      success: true,
      images: imageUrls,
      text: "",
      count: imageUrls.length,
      imageSize: pending.requestedImageSize,
      tokensUsed: tokenBreakdown.totalTokens,
      tokenBreakdown,
      actualCostUsd,
      creditsUsed: creditsToDeduct,
      creditsDeducted: Number(deductResult.credits_deducted) || 0,
      eligiblePaidCredits: Number(deductResult.eligible_paid_credits) || 0,
      creditDeductionId: typeof deductResult.deduction_id === "string"
        ? deductResult.deduction_id
        : undefined,
      newCredits: Number(deductResult.new_balance ?? deductResult.new_credits ?? 0),
      requestId: pending.clientRequestId,
      recovered: true,
      provider: pending.mode === "edit" ? "fal-gpt-image-2-edit" : "fal-gpt-image-2",
      quality: pending.quality,
    };

    await saveGenerationManifest(
      supabase,
      userId,
      pending.clientRequestId,
      responsePayload,
    );
    await deletePendingGeneration(supabase, userId, pending.clientRequestId);
    return { state: "success", payload: responsePayload };
  } catch (error) {
    console.error("Fal image finalization failed:", error);
    const storedManifest = await readGenerationManifest(
      supabase,
      userId,
      pending.clientRequestId,
    );
    if (storedManifest) return { state: "success", payload: storedManifest };
    return {
      state: "failed",
      statusCode: 500,
      code: "FAL_RESULT_FINALIZATION_FAILED",
      error: error instanceof Error
        ? error.message
        : "The image finished generating but could not be finalized.",
    };
  }
}

const MJ_ASPECT_RATIOS = new Set([
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
]);

const clampNumber = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

function normalizeMjQuality(value: unknown): MjImageQuality {
  return value === "hd" ? "hd" : "standard";
}

function estimateMjCostUsd(quality: MjImageQuality): number {
  const configured = quality === "hd" ? EVOLINK_MJ_HD_USD : EVOLINK_MJ_STANDARD_USD;
  const fallback = quality === "hd" ? 0.12 : 0.08;
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function estimateMjCredits(quality: MjImageQuality): number {
  return Math.max(1, Math.ceil(estimateMjCostUsd(quality) * USD_TO_CREDITS));
}

function normalizeReferenceUrls(body: GenerateRequestBody): string[] {
  const explicit = Array.isArray(body.referenceImageUrls)
    ? body.referenceImageUrls
    : [];
  return [...explicit, body.imageUrl, body.productImageUrl]
    .filter((value): value is string =>
      typeof value === "string" &&
      (value.startsWith("https://") || value.startsWith("data:")),
    )
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 3);
}

function buildEvoLinkMjPrompt(body: GenerateRequestBody): string {
  const prompt = String(body.prompt || "").trim();
  if (/(^|\s)--[a-z]/i.test(prompt)) {
    throw new Error(
      "Use Lazora's Midjourney settings instead of typing -- parameters in the prompt.",
    );
  }

  const aspectRatio = MJ_ASPECT_RATIOS.has(String(body.aspectRatio))
    ? String(body.aspectRatio)
    : "1:1";
  const params = body.mjParams || {};
  const stylize = Math.round(clampNumber(params.stylize, 0, 1000, 100));
  const chaos = Math.round(clampNumber(params.chaos, 0, 100, 0));
  const experimental = Math.round(clampNumber(params.experimental, 0, 100, 0));
  const seed = params.seed === undefined || params.seed === null
    ? undefined
    : Math.round(clampNumber(params.seed, 0, 4_294_967_295, 0));
  const referenceMode: MjReferenceMode = ["style", "omni"].includes(
    String(params.referenceMode),
  )
    ? params.referenceMode as MjReferenceMode
    : "image";
  const referenceUrls = normalizeReferenceUrls(body);
  const prefix = referenceMode === "image" && referenceUrls.length > 0
    ? `${referenceUrls.join(" ")} `
    : "";
  const suffixes = [`--ar ${aspectRatio}`, `--s ${stylize}`];

  if (chaos > 0) suffixes.push(`--chaos ${chaos}`);
  if (experimental > 0) suffixes.push(`--exp ${experimental}`);
  if (params.raw) suffixes.push("--raw");
  if (seed !== undefined) suffixes.push(`--seed ${seed}`);

  if (referenceUrls.length > 0) {
    if (referenceMode === "image") {
      const imageWeight = clampNumber(params.imageWeight, 0, 3, 1);
      suffixes.push(`--iw ${imageWeight}`);
    } else if (referenceMode === "style") {
      const styleWeight = Math.round(clampNumber(params.styleWeight, 0, 1000, 100));
      suffixes.push(`--sref ${referenceUrls.join(" ")}`, `--sw ${styleWeight}`);
    } else {
      const omniWeight = Math.round(clampNumber(params.omniWeight, 1, 1000, 100));
      suffixes.push(`--oref ${referenceUrls[0]}`, `--ow ${omniWeight}`);
    }
  }

  return `${prefix}${prompt} ${suffixes.join(" ")}`.trim();
}

function evoLinkErrorMessage(
  payload: Record<string, unknown>,
  fallback: string,
): string {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const nested = error as Record<string, unknown>;
    const message = nested.message ?? nested.detail;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  const message = payload.message ?? payload.detail;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

async function submitEvoLinkMj(
  prompt: string,
  quality: MjImageQuality,
  apiKey: string,
): Promise<string> {
  const response = await fetch(`${EVOLINK_API_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EVOLINK_MJ_MODEL,
      prompt,
      quality,
      model_params: { speed: "fast" },
    }),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      `EvoLink Midjourney submission failed (${response.status}): ${evoLinkErrorMessage(payload, response.statusText)}`,
    );
  }
  const taskId = getStringField(payload, "id", "taskId");
  if (!taskId) throw new Error("EvoLink did not return a task ID.");
  return taskId;
}

async function getEvoLinkTask(
  taskId: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${EVOLINK_API_BASE_URL}/tasks/${encodeURIComponent(taskId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      `EvoLink task status failed (${response.status}): ${evoLinkErrorMessage(payload, response.statusText)}`,
    );
  }
  return payload;
}

async function finalizeEvoLinkPendingGeneration(
  supabase: any,
  userId: string,
  pending: StoredEvoLinkPendingGeneration,
  apiKey: string,
): Promise<FalFinalizeResult> {
  let task: Record<string, unknown>;
  try {
    task = await getEvoLinkTask(pending.evolinkTaskId, apiKey);
  } catch (error) {
    console.error("EvoLink Midjourney status check failed:", error);
    return {
      state: "failed",
      statusCode: 502,
      code: "EVOLINK_STATUS_FAILED",
      error: error instanceof Error ? error.message : "Could not check Midjourney status.",
    };
  }

  const status = String(task.status || "pending").trim().toLowerCase();
  if (status === "pending" || status === "processing") {
    return { state: "pending", status: status.toUpperCase() };
  }
  if (status === "failed" || status === "cancelled" || status === "canceled") {
    await deletePendingGeneration(supabase, userId, pending.clientRequestId);
    return {
      state: "failed",
      statusCode: 422,
      code: status.startsWith("cancel") ? "EVOLINK_CANCELLED" : "EVOLINK_GENERATION_FAILED",
      error: `${evoLinkErrorMessage(task, "Midjourney generation failed.")} No Lazora credits were deducted.`,
    };
  }
  if (status !== "completed") {
    return { state: "pending", status: status.toUpperCase() || "PROCESSING" };
  }

  try {
    const resultUrls = (Array.isArray(task.results) ? task.results : [])
      .filter((value): value is string => typeof value === "string" && value.startsWith("https://"))
      .slice(0, 4);
    if (resultUrls.length === 0) {
      throw new Error("Midjourney completed without returning any approved images.");
    }
    const generatedImages = await downloadFalImages(
      resultUrls.map((url) => ({ url })),
    );
    const imageUrls = await uploadGeneratedImages(
      supabase,
      userId,
      pending.clientRequestId,
      generatedImages,
    );
    const actualCostUsd = estimateMjCostUsd(pending.quality);
    const creditsToDeduct = estimateMjCredits(pending.quality);
    const { data: deductResult, error: deductError } = await supabase.rpc(
      "deduct_generation_credits",
      {
        p_user_id: userId,
        p_amount: creditsToDeduct,
        p_request_id: pending.clientRequestId,
        p_template_run_id: pending.templateRunId || null,
        p_template_step_id: pending.templateStepId || null,
        p_capability: pending.templateCapability || null,
      },
    );
    const deductionSucceeded =
      !deductError && deductResult && deductResult.success === true;
    if (!deductionSucceeded) {
      await deleteStoredGenerationArtifacts(supabase, userId, pending.clientRequestId);
      await deletePendingGeneration(supabase, userId, pending.clientRequestId);
      const insufficientCredits =
        !deductError && deductResult?.error === "Insufficient credits";
      return {
        state: "failed",
        statusCode: insufficientCredits ? 402 : 500,
        code: insufficientCredits ? "INSUFFICIENT_CREDITS" : "CREDIT_DEDUCTION_FAILED",
        error: insufficientCredits
          ? "Your credit balance changed while Midjourney was generating. No image was delivered."
          : "Unable to charge credits. No image was delivered.",
      };
    }

    const responsePayload: StoredGenerationManifest = {
      success: true,
      images: imageUrls,
      text: "",
      count: imageUrls.length,
      imageSize: pending.quality === "hd" ? "HD" : "Standard",
      tokensUsed: 0,
      actualCostUsd,
      creditsUsed: creditsToDeduct,
      creditsDeducted: Number(deductResult.credits_deducted) || 0,
      eligiblePaidCredits: Number(deductResult.eligible_paid_credits) || 0,
      creditDeductionId: typeof deductResult.deduction_id === "string"
        ? deductResult.deduction_id
        : undefined,
      newCredits: Number(deductResult.new_balance ?? deductResult.new_credits ?? 0),
      requestId: pending.clientRequestId,
      recovered: true,
      provider: "evolink-mj-v8.1",
      quality: pending.quality,
    };
    await saveGenerationManifest(
      supabase,
      userId,
      pending.clientRequestId,
      responsePayload,
    );
    await deletePendingGeneration(supabase, userId, pending.clientRequestId);
    return { state: "success", payload: responsePayload };
  } catch (error) {
    console.error("EvoLink Midjourney finalization failed:", error);
    const storedManifest = await readGenerationManifest(
      supabase,
      userId,
      pending.clientRequestId,
    );
    if (storedManifest) return { state: "success", payload: storedManifest };
    return {
      state: "failed",
      statusCode: 500,
      code: "EVOLINK_RESULT_FINALIZATION_FAILED",
      error: error instanceof Error
        ? error.message
        : "Midjourney finished but the result could not be finalized.",
    };
  }
}

// ====================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ============================================
  // JWT Authentication (Required for all requests)
  // ============================================
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    });
  }

  const token = authHeader.substring(7);

  // Verify Supabase credentials exist
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Supabase credentials not configured");
    return res.status(500).json({
      error: "Server configuration error",
      code: "CONFIG_ERROR",
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    console.error("Auth verification failed:", authError?.message);
    return res.status(401).json({
      error: "Invalid or expired token",
      code: "INVALID_TOKEN",
    });
  }

  console.log("Authenticated user:", user.id);

  const body = parseBody(req.body);
  const requestId = normalizeRequestId(body.requestId) || createRequestId();

  // A repeated request with the same requestId must never generate or charge twice.
  // The manifest is written before the success response, so an interrupted browser
  // connection can recover the exact URLs and credit settlement.
  const storedManifest = await readGenerationManifest(
    supabase,
    user.id,
    requestId,
  );
  if (storedManifest) {
    console.log("Recovered stored generation manifest:", {
      requestId,
      imageCount: storedManifest.images.length,
    });
    return res.status(200).json({
      ...storedManifest,
      recovered: true,
    });
  }

  const pendingGeneration = await readPendingGeneration(
    supabase,
    user.id,
    requestId,
  );
  if (pendingGeneration?.provider === "fal-gpt-image-2") {
    const falKey = process.env.FAL_KEY;
    if (!falKey) {
      return res.status(500).json({
        success: false,
        code: "CONFIG_ERROR",
        error: "Fal API key not configured",
        requestId,
      });
    }
    const finalized = await finalizeFalPendingGeneration(
      supabase,
      user.id,
      pendingGeneration,
      falKey,
    );
    if (finalized.state === "success") {
      return res.status(200).json(finalized.payload);
    }
    if (finalized.state === "pending") {
      return res.status(202).json({
        success: false,
        pending: true,
        status: finalized.status,
        code: "RESULT_NOT_READY",
        error: "Your image is still generating.",
        requestId,
      });
    }
    return res.status(finalized.statusCode).json({
      success: false,
      code: finalized.code,
      error: finalized.error,
      requestId,
    });
  }
  if (pendingGeneration?.provider === "evolink-mj-v8.1") {
    const evoLinkKey = process.env.EVOLINK_API_KEY;
    if (!evoLinkKey) {
      return res.status(500).json({
        success: false,
        code: "CONFIG_ERROR",
        error: "EvoLink API key not configured",
        requestId,
      });
    }
    const finalized = await finalizeEvoLinkPendingGeneration(
      supabase,
      user.id,
      pendingGeneration,
      evoLinkKey,
    );
    if (finalized.state === "success") {
      return res.status(200).json(finalized.payload);
    }
    if (finalized.state === "pending") {
      return res.status(202).json({
        success: false,
        pending: true,
        status: finalized.status,
        code: "RESULT_NOT_READY",
        error: "Your Midjourney images are still generating.",
        requestId,
      });
    }
    return res.status(finalized.statusCode).json({
      success: false,
      code: finalized.code,
      error: finalized.error,
      requestId,
    });
  }

  const existingImages = await findStoredGeneratedImages(
    supabase,
    user.id,
    requestId,
  );
  if (existingImages.length > 0) {
    return res.status(202).json({
      success: false,
      pending: true,
      code: "RESULT_FINALIZING",
      error: "The generated image is being finalized.",
      requestId,
    });
  }
  if (body.recoverOnly) {
    return res.status(404).json({
      success: false,
      pending: false,
      code: "REQUEST_NOT_FOUND",
      error: "No recoverable image request was found.",
      requestId,
    });
  }
  // ============================================

  // ============================================
  // Rate Limiting (10 requests per minute)
  // ============================================
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

  const { count, error: countError } = await supabase
    .from("generations")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneMinuteAgo);

  if (countError) {
    console.error("Rate limit check failed:", countError);
    // Fail open - allow request if we can't check rate limit
  } else if (count !== null && count >= 10) {
    console.log(
      `Rate limit exceeded for user ${user.id}: ${count} requests in last minute`,
    );
    return res.status(429).json({
      error: "Slow down! Please wait a moment before generating more images.",
      code: "RATE_LIMITED",
    });
  }
  // ============================================

  // ============================================
  // Credit Pre-Check (estimate based on request)
  // ============================================
  const requestedImages = Math.min(
    Math.max(1, Number(body.numberOfImages) || 1),
    MAX_IMAGES,
  );
  const requestedSize =
    body.imageSize && VALID_SIZES.includes(body.imageSize)
      ? body.imageSize
      : "1K";
  const useFalGptImage2 = isFalGptImage2Request(body);
  const useEvoLinkMj = body.provider === "evolink-mj-v8.1";
  const normalizedMjQuality = normalizeMjQuality(body.mjQuality);
  const estimatedCredits = useEvoLinkMj
    ? estimateMjCredits(normalizedMjQuality)
    : useFalGptImage2
    ? estimateFalCredits(body, requestedImages)
    : estimateImageCredits(requestedSize, requestedImages);

  // Fetch user data for credit check and plan verification
  const { data: userData, error: userDataError } = await supabase
    .from("users")
    .select("credits, plan, is_whitelisted")
    .eq("id", user.id)
    .single();

  if (userDataError || !userData) {
    console.error("Failed to fetch user data:", userDataError);
    return res.status(500).json({
      error: "Failed to verify user credits",
      code: "USER_DATA_ERROR",
    });
  }

  // Whitelisted users bypass credit check
  if (!userData.is_whitelisted && userData.credits < estimatedCredits) {
    console.log(
      `Insufficient credits: has ${userData.credits}, needs ~${estimatedCredits}`,
    );
    return res.status(402).json({
      error: "Insufficient credits. Please purchase more credits to continue.",
      code: "INSUFFICIENT_CREDITS",
      required: estimatedCredits,
      available: userData.credits,
    });
  }

  console.log(
    `Credit pre-check passed: has ${userData.credits}, estimated need ${estimatedCredits}, whitelisted: ${userData.is_whitelisted}`,
  );
  // ============================================

  // Check only the provider key required for this request. FAL_KEY already
  // powers video generation and remains server-side in Vercel.
  const apiKey = process.env.GEMINI_API_KEY;
  const falKey = process.env.FAL_KEY;
  const evoLinkKey = process.env.EVOLINK_API_KEY;
  if (useEvoLinkMj && !evoLinkKey) {
    console.error("EVOLINK_API_KEY not configured");
    return res.status(500).json({ error: "EvoLink API key not configured" });
  }
  if (useFalGptImage2 && !falKey) {
    console.error("FAL_KEY not configured");
    return res.status(500).json({ error: "Fal API key not configured" });
  }
  if (!useFalGptImage2 && !useEvoLinkMj && !apiKey) {
    console.error("GEMINI_API_KEY not configured");
    return res.status(500).json({ error: "Gemini API key not configured" });
  }

  try {
    const {
      prompt,
      imageUrl,
      productImageUrl,
      numberOfImages = 1,
      imageSize = "1K", // Default to 1K, options: "512", "1K", "2K", "4K"
      aspectRatio, // Optional: "1:1", "3:4", "4:3", "9:16", "16:9", etc.
      capability,
      quality = "medium",
    } = body;

    // ============================================
    // INPUT VALIDATION
    // ============================================

    // 验证 prompt - 必填且长度限制
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        error: "Prompt is required",
        code: "INVALID_INPUT",
      });
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({
        error: `Prompt too long (max ${MAX_PROMPT_LENGTH} characters)`,
        code: "INVALID_INPUT",
      });
    }

    // 验证 imageSize - 只允许指定值
    if (imageSize && !VALID_SIZES.includes(imageSize)) {
      return res.status(400).json({
        error: "Invalid image size. Must be 512, 1K, 2K, or 4K",
        code: "INVALID_INPUT",
      });
    }

    // 验证 numberOfImages - 静默截断到合法范围 (1-4)
    const validatedNumberOfImages = Math.min(
      Math.max(1, Number(numberOfImages) || 1),
      MAX_IMAGES,
    );

    // 验证 imageUrl - 必须是 https:// 或 data: 开头
    if (imageUrl && typeof imageUrl === "string") {
      if (!imageUrl.startsWith("https://") && !imageUrl.startsWith("data:")) {
        return res.status(400).json({
          error: "Invalid image URL. Must start with https:// or data:",
          code: "INVALID_INPUT",
        });
      }
    }

    // 验证 productImageUrl - 同样的规则
    if (productImageUrl && typeof productImageUrl === "string") {
      if (
        !productImageUrl.startsWith("https://") &&
        !productImageUrl.startsWith("data:")
      ) {
        return res.status(400).json({
          error: "Invalid product image URL. Must start with https:// or data:",
          code: "INVALID_INPUT",
        });
      }
    }
    // ============================================

    console.log("=== Generate API called ===");
    console.log("Prompt:", prompt.substring(0, 100) + "...");
    console.log("Has base image:", !!imageUrl);
    console.log("Has product image:", !!productImageUrl);
    console.log("Number of images requested:", validatedNumberOfImages);
    console.log("Image size:", imageSize);
    console.log("Aspect ratio:", aspectRatio || "default");
    console.log("Capability:", capability || "image.modify");
    console.log(
      "Provider:",
      useFalGptImage2
        ? resolveFalMode(body) === "edit"
          ? "fal-gpt-image-2-edit"
          : "fal-gpt-image-2"
        : "gemini",
    );
    console.log("User ID:", user.id);

    // ============================================
    // 4K Permission Check (Pro/Enterprise only)
    // Other resolutions are available for all logged-in users
    // ============================================
    if (!useEvoLinkMj && imageSize === "4K") {
      const userPlan = userData.plan || "Free";
      console.log("User plan:", userPlan);

      if (userPlan !== "Pro" && userPlan !== "Enterprise") {
        console.log("Free user attempted 4K - rejecting");
        return res.status(403).json({
          error: "4K resolution is available for Pro users only",
          code: "PRO_REQUIRED",
        });
      }

      console.log("4K access granted for", userPlan, "user");
    }
    // ============================================

    if (useEvoLinkMj) {
      let assembledPrompt: string;
      try {
        assembledPrompt = buildEvoLinkMjPrompt(body);
      } catch (error) {
        return res.status(400).json({
          success: false,
          code: "INVALID_MJ_PROMPT",
          error: error instanceof Error ? error.message : "Invalid Midjourney prompt.",
          requestId,
        });
      }
      console.log("Submitting EvoLink Midjourney V8.1 request:", {
        requestId,
        quality: normalizedMjQuality,
        aspectRatio: MJ_ASPECT_RATIOS.has(String(aspectRatio)) ? aspectRatio : "1:1",
        requestedImages: 4,
        referenceImageCount: normalizeReferenceUrls(body).length,
      });
      const evolinkTaskId = await submitEvoLinkMj(
        assembledPrompt,
        normalizedMjQuality,
        evoLinkKey as string,
      );
      const pendingMjGeneration: StoredEvoLinkPendingGeneration = {
        version: 1,
        provider: "evolink-mj-v8.1",
        clientRequestId: requestId,
        evolinkTaskId,
        submittedAt: new Date().toISOString(),
        quality: normalizedMjQuality,
        aspectRatio: MJ_ASPECT_RATIOS.has(String(aspectRatio)) ? String(aspectRatio) : "1:1",
        requestedImages: 4,
        templateRunId: body.templateRunId,
        templateStepId: body.templateStepId,
        templateCapability: body.templateCapability,
      };
      try {
        await savePendingGeneration(
          supabase,
          user.id,
          requestId,
          pendingMjGeneration,
        );
      } catch (pendingSaveError) {
        console.error("Unable to save EvoLink pending request:", pendingSaveError);
        return res.status(500).json({
          success: false,
          code: "PENDING_REQUEST_SAVE_FAILED",
          error: "The Midjourney request was submitted but Lazora could not save its recovery record. Do not submit another request yet.",
          requestId,
          evolinkTaskId,
        });
      }
      return res.status(202).json({
        success: false,
        pending: true,
        status: "PENDING",
        code: "GENERATION_QUEUED",
        error: "Your Midjourney request was queued and is still generating.",
        requestId,
      });
    }

    if (useFalGptImage2) {
      const mode = resolveFalMode(body);
      const normalizedQuality = normalizeFalQuality(quality);
      const inputImageUrls = normalizeReferenceUrls(body);
      if (mode === "edit" && inputImageUrls.length === 0) {
        return res.status(400).json({
          success: false,
          error: "GPT Image 2 Edit requires at least one input image.",
          code: "MISSING_INPUT_IMAGE",
          requestId,
        });
      }

      const falImageSize = toFalImageSize(imageSize, aspectRatio, mode);
      const falPayload: Record<string, unknown> = {
        prompt,
        image_size: falImageSize,
        quality: normalizedQuality,
        num_images: validatedNumberOfImages,
        output_format: "png",
        sync_mode: false,
        ...(mode === "edit" ? { image_urls: inputImageUrls } : {}),
      };

      console.log("Submitting Fal GPT Image 2 request:", {
        endpoint: mode === "edit" ? FAL_GPT_IMAGE_2_EDIT_ENDPOINT : FAL_GPT_IMAGE_2_TEXT_ENDPOINT,
        requestId,
        imageSize: falImageSize,
        quality: normalizedQuality,
        imageCount: validatedNumberOfImages,
        inputImageCount: inputImageUrls.length,
      });

      const falJob = await submitFalGptImage2(
        mode,
        falPayload,
        falKey as string,
      );
      const pendingGeneration: StoredFalPendingGeneration = {
        version: 1,
        provider: "fal-gpt-image-2",
        clientRequestId: requestId,
        falRequestId: falJob.requestId,
        endpoint: falEndpointForMode(mode),
        statusUrl: falJob.statusUrl,
        responseUrl: falJob.responseUrl,
        cancelUrl: falJob.cancelUrl,
        submittedAt: new Date().toISOString(),
        mode,
        quality: normalizedQuality,
        falImageSize,
        requestedImageSize: imageSize,
        aspectRatio,
        requestedImages: validatedNumberOfImages,
        inputImageCount: inputImageUrls.length,
        templateRunId: body.templateRunId,
        templateStepId: body.templateStepId,
        templateCapability: body.templateCapability,
      };

      try {
        await savePendingGeneration(
          supabase,
          user.id,
          requestId,
          pendingGeneration,
        );
      } catch (pendingSaveError) {
        console.error("Unable to save Fal pending request:", pendingSaveError);
        return res.status(500).json({
          success: false,
          code: "PENDING_REQUEST_SAVE_FAILED",
          error: "The Fal request was submitted but Lazora could not save its recovery record. Do not submit another request yet.",
          requestId,
          falRequestId: falJob.requestId,
        });
      }

      return res.status(202).json({
        success: false,
        pending: true,
        status: "IN_QUEUE",
        code: "GENERATION_QUEUED",
        error: "Your image request was queued and is still generating.",
        requestId,
      });
    }

    // Build the request content parts
    // IMPORTANT: Order matters! Scene/base image FIRST, then product image, then prompt
    // This matches Google AI Studio's behavior
    const parts: any[] = [];

    // Add base/scene image FIRST if provided (the model/background photo)
    if (imageUrl) {
      const baseImageData = await fetchImageAsBase64(imageUrl);
      if (baseImageData) {
        parts.push({
          inline_data: {
            mime_type: baseImageData.mimeType,
            data: baseImageData.base64,
          },
        });
        console.log("Added base/scene image to request (FIRST)");
      }
    }

    // Add product image SECOND if provided (the product to insert)
    if (productImageUrl) {
      const productImageData = await fetchImageAsBase64(productImageUrl);
      if (productImageData) {
        parts.push({
          inline_data: {
            mime_type: productImageData.mimeType,
            data: productImageData.base64,
          },
        });
        console.log("Added product image to request (SECOND)");
      }
    }

    // Add the text prompt LAST
    parts.push({ text: prompt });

    // Determine if this is a pure text-to-image request (no input images)
    const isPureTextToImage = !imageUrl && !productImageUrl;

    // Build imageConfig for resolution and aspect ratio
    // Note: Gemini API uses camelCase for these parameters
    const imageConfig: any = {};
    if (imageSize && ["512", "1K", "2K", "4K"].includes(imageSize)) {
      imageConfig.imageSize = imageSize; // camelCase
    }
    if (aspectRatio) {
      imageConfig.aspectRatio = aspectRatio; // camelCase
      console.log("Setting aspectRatio:", aspectRatio);
    }

    // Build the full request body
    const requestBody: any = {
      contents: [
        {
          parts: parts,
        },
      ],
      generationConfig: {
        // For image generation, we need specific output settings
        responseModalities: ["image", "text"],
        // Apply image config if set
        ...(Object.keys(imageConfig).length > 0 && { imageConfig }),
      },
      // Safety settings - be permissive for product photography
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_ONLY_HIGH",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_ONLY_HIGH",
        },
      ],
    };

    console.log(
      "Request body imageConfig:",
      requestBody.generationConfig.imageConfig,
    );

    // Function to generate a single image with retries
    const generateOne = async (
      attempt = 1,
      accumulated = emptyTokenBreakdown(),
    ): Promise<{
      image: GeneratedImagePayload | null;
      tokenBreakdown: TokenBreakdown;
    }> => {
      const maxAttempts = 2;
      try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            `Gemini API error (attempt ${attempt}):`,
            response.status,
            errorText,
          );
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
            return generateOne(attempt + 1, accumulated);
          }
          return { image: null, tokenBreakdown: accumulated };
        }

        const data = await response.json();
        const billedTokens = addTokenBreakdown(
          accumulated,
          parseTokenBreakdown(data.usageMetadata),
        );

        // ===== DETAILED TOKEN LOGGING =====
        // Log the FULL usageMetadata to diagnose token discrepancies
        console.log("=== Full usageMetadata ===");
        console.log(JSON.stringify(data.usageMetadata, null, 2));

        // Extract token usage from usageMetadata
        const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
        const inputTokens = data.usageMetadata?.promptTokenCount || 0;
        const totalTokens = data.usageMetadata?.totalTokenCount || 0;
        const thoughtsTokens = data.usageMetadata?.thoughtsTokenCount || 0;

        // Log per-modality breakdown if available
        const candidatesDetails = data.usageMetadata?.candidatesTokensDetails;
        if (candidatesDetails) {
          console.log("=== Output Token Breakdown by Modality ===");
          for (const detail of candidatesDetails) {
            console.log(`  ${detail.modality}: ${detail.tokenCount} tokens`);
          }
        }

        const promptDetails = data.usageMetadata?.promptTokensDetails;
        if (promptDetails) {
          console.log("=== Input Token Breakdown by Modality ===");
          for (const detail of promptDetails) {
            console.log(`  ${detail.modality}: ${detail.tokenCount} tokens`);
          }
        }

        console.log("Token summary:", {
          promptTokenCount: inputTokens,
          candidatesTokenCount: outputTokens,
          thoughtsTokenCount: thoughtsTokens,
          totalTokenCount: totalTokens,
          billingTokens: outputTokens,
        });
        // ===== END DETAILED TOKEN LOGGING =====

        if (data.candidates && data.candidates[0]?.content?.parts) {
          // Log all parts to see what's being returned
          const parts = data.candidates[0].content.parts;
          console.log("Response parts count:", parts.length);

          let textContent = "";
          let imageFound = false;

          for (const part of parts) {
            if (part.text) {
              textContent += part.text;
              console.log(
                "Found TEXT in response (this consumes tokens!):",
                part.text.substring(0, 100) + "...",
              );
            }
            if (part.inlineData?.data) {
              imageFound = true;
              const mimeType = part.inlineData.mimeType || "image/png";
              return {
                image: { base64: part.inlineData.data, mimeType },
                tokenBreakdown: billedTokens,
              };
            }
          }

          if (textContent && !imageFound) {
            console.log("WARNING: Response contains only text, no image!");
          }
        }

        // No image in response, retry
        if (attempt < maxAttempts) {
          console.log(
            `No image in response, retrying... (attempt ${attempt + 1})`,
          );
          await new Promise((r) => setTimeout(r, 300 * attempt));
          return generateOne(attempt + 1, billedTokens);
        }
        return { image: null, tokenBreakdown: billedTokens };
      } catch (err) {
        console.error(`Error in generateOne (attempt ${attempt}):`, err);
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 300 * attempt));
          return generateOne(attempt + 1, accumulated);
        }
        return { image: null, tokenBreakdown: accumulated };
      }
    };

    // Run generations and ensure we get the requested number
    // Use validatedNumberOfImages instead of numberOfImages
    const numToGenerate = validatedNumberOfImages;
    let generatedImages: GeneratedImagePayload[] = [];
    let totalTokenBreakdown = emptyTokenBreakdown();
    let totalAttempts = 0;
    const maxTotalAttempts = numToGenerate * 2; // Allow up to 2x attempts to fill quota

    // First batch - parallel
    const promises = Array.from({ length: numToGenerate }, () => generateOne());
    const results = await Promise.all(promises);

    for (const result of results) {
      if (result.image) {
        generatedImages.push(result.image);
      }
      totalTokenBreakdown = addTokenBreakdown(
        totalTokenBreakdown,
        result.tokenBreakdown,
      );
    }
    totalAttempts = numToGenerate;

    // If we didn't get enough, try to fill the gap
    while (
      generatedImages.length < numToGenerate &&
      totalAttempts < maxTotalAttempts
    ) {
      const needed = numToGenerate - generatedImages.length;
      console.log(
        `Only got ${generatedImages.length}/${numToGenerate}, generating ${needed} more...`,
      );
      const extraPromises = Array.from({ length: needed }, () => generateOne());
      const extraResults = await Promise.all(extraPromises);
      for (const result of extraResults) {
        if (result.image) {
          generatedImages.push(result.image);
        }
        totalTokenBreakdown = addTokenBreakdown(
          totalTokenBreakdown,
          result.tokenBreakdown,
        );
      }
      totalAttempts += needed;
    }

    console.log("=== Generation Summary ===");
    console.log(
      "Total images generated:",
      generatedImages.length,
      "out of",
      numToGenerate,
      "requested",
    );
    console.log("Image size setting:", imageSize);
    console.log("Token breakdown:", totalTokenBreakdown);

    if (generatedImages.length === 0) {
      return res.status(500).json({
        success: false,
        error: "All generation attempts failed",
        images: [],
        count: 0,
        tokensUsed: totalTokenBreakdown.totalTokens,
        tokenBreakdown: totalTokenBreakdown,
      });
    }

    // Upload the generated bytes before charging the user. The API response now contains
    // small, durable URLs instead of multi-megabyte Base64 strings.
    let imageUrls: string[];
    try {
      imageUrls = await uploadGeneratedImages(
        supabase,
        user.id,
        requestId,
        generatedImages,
      );
    } catch (uploadError) {
      console.error("Generated image upload failed:", uploadError);
      return res.status(500).json({
        success: false,
        error:
          "The image was generated but could not be saved. No credits were deducted.",
        code: "RESULT_UPLOAD_FAILED",
        requestId,
      });
    }

    console.log("Generated images saved to storage:", {
      requestId,
      imageCount: imageUrls.length,
    });

    // ============================================
    // Deduct credits only after every image is safely stored
    // ============================================
    const actualCostUsd = calculateGeminiCostUsd(totalTokenBreakdown);
    const creditsToDeduct = Math.max(
      1,
      Math.ceil(actualCostUsd * USD_TO_CREDITS),
    );

    let newCredits = userData.credits;
    let creditsDeducted = 0;
    let eligiblePaidCredits = 0;
    let creditDeductionId: string | undefined;

    // This server-owned settlement records the exact FIFO lots, including a
    // zero-charge audit row for whitelisted users. Template attribution is
    // locked here and cannot be supplied later by a client generation row.
    {
      const { data: deductResult, error: deductError } = await supabase.rpc(
        "deduct_generation_credits",
        {
          p_user_id: user.id,
          p_amount: creditsToDeduct,
          p_request_id: requestId,
          p_template_run_id: body.templateRunId || null,
          p_template_step_id: body.templateStepId || null,
          p_capability: body.templateCapability || null,
        },
      );

      const deductionSucceeded =
        !deductError && deductResult && deductResult.success === true;

      if (!deductionSucceeded) {
        console.error("Credit deduction failed; generated files will not be delivered:", {
          requestId,
          deductError: deductError?.message,
          deductResult,
          creditsToDeduct,
        });

        const cleanupSucceeded = await deleteStoredGenerationArtifacts(
          supabase,
          user.id,
          requestId,
        );

        if (!cleanupSucceeded) {
          console.error("CRITICAL: unable to remove unpaid generated files", {
            userId: user.id,
            requestId,
          });
        }

        const insufficientCredits =
          !deductError && deductResult?.error === "Insufficient credits";

        return res.status(insufficientCredits ? 402 : 500).json({
          success: false,
          code: insufficientCredits
            ? "INSUFFICIENT_CREDITS"
            : "CREDIT_DEDUCTION_FAILED",
          error: insufficientCredits
            ? "Your credit balance changed before checkout. No image was delivered."
            : "Unable to charge credits. No image was delivered.",
          creditsDeducted: 0,
          requestId,
        });
      }

      console.log("Credit deduction result:", deductResult);
      creditsDeducted = Number(deductResult.credits_deducted) || 0;
      eligiblePaidCredits = Number(deductResult.eligible_paid_credits) || 0;
      creditDeductionId = typeof deductResult.deduction_id === "string"
        ? deductResult.deduction_id
        : undefined;
      newCredits = Number(
        deductResult.new_balance ?? deductResult.new_credits ?? newCredits,
      );
    }
    // ============================================

    const responsePayload: StoredGenerationManifest = {
      success: true,
      images: imageUrls,
      text: "",
      count: imageUrls.length,
      imageSize: imageSize,
      tokensUsed: totalTokenBreakdown.totalTokens,
      tokenBreakdown: totalTokenBreakdown,
      actualCostUsd,
      creditsUsed: creditsToDeduct,
      creditsDeducted,
      eligiblePaidCredits,
      creditDeductionId,
      newCredits: newCredits,
      requestId,
      recovered: false,
    };

    try {
      await saveGenerationManifest(
        supabase,
        user.id,
        requestId,
        responsePayload,
      );
    } catch (manifestError) {
      console.error("Failed to save generation manifest:", manifestError);
      // The images are already safely stored and the normal response can still succeed.
    }

    console.log("Sending compact generation response:", {
      requestId,
      imageCount: imageUrls.length,
      creditsDeducted,
    });

    return res.status(200).json(responsePayload);
  } catch (err) {
    console.error("Generation exception:", err);
    return res.status(500).json({
      error: "Generation failed",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

// Helper function to fetch and convert image to base64
async function fetchImageAsBase64(
  imageUrl: string,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    // If it's already a data URL, extract the base64 part
    if (imageUrl.startsWith("data:")) {
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        return {
          mimeType: matches[1],
          base64: matches[2],
        };
      }
      return null;
    }

    // Fetch the image from URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error("Failed to fetch image:", imageUrl);
      return null;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      mimeType: contentType,
      base64: base64,
    };
  } catch (err) {
    console.error("Error fetching image:", err);
    return null;
  }
}

function parseBody(body: unknown): GenerateRequestBody {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as GenerateRequestBody;
    } catch {
      return {};
    }
  }
  return typeof body === "object" ? (body as GenerateRequestBody) : {};
}

function createRequestId(): string {
  return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(trimmed)) return null;
  return trimmed;
}

function getGeneratedRequestFolder(userId: string, requestId: string): string {
  return `${userId}/${GENERATED_IMAGE_FOLDER}/${requestId}`;
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  return "png";
}

async function uploadGeneratedImages(
  supabase: any,
  userId: string,
  requestId: string,
  images: GeneratedImagePayload[],
): Promise<string[]> {
  const folder = getGeneratedRequestFolder(userId, requestId);
  const uploadedPaths: string[] = [];

  try {
    const urls = await Promise.all(
      images.map(async (image, index) => {
        const extension = extensionForMimeType(image.mimeType);
        const path = `${folder}/${String(index + 1).padStart(2, "0")}.${extension}`;
        const bytes = Buffer.from(image.base64, "base64");

        if (bytes.length === 0) {
          throw new Error(`Generated image ${index + 1} was empty`);
        }

        const { error } = await supabase.storage
          .from(GENERATED_IMAGES_BUCKET)
          .upload(path, bytes, {
            contentType: image.mimeType,
            cacheControl: "31536000",
            upsert: true,
          });

        if (error) {
          throw new Error(
            `Storage upload failed for image ${index + 1}: ${error.message}`,
          );
        }

        uploadedPaths.push(path);
        return supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(path)
          .data.publicUrl as string;
      }),
    );

    return urls;
  } catch (error) {
    if (uploadedPaths.length > 0) {
      const { error: cleanupError } = await supabase.storage
        .from(GENERATED_IMAGES_BUCKET)
        .remove(uploadedPaths);
      if (cleanupError) {
        console.error(
          "Failed to clean up partial generated uploads:",
          cleanupError,
        );
      }
    }
    throw error;
  }
}

async function deleteStoredGenerationArtifacts(
  supabase: any,
  userId: string,
  requestId: string,
): Promise<boolean> {
  const folder = getGeneratedRequestFolder(userId, requestId);
  const { data, error: listError } = await supabase.storage
    .from(GENERATED_IMAGES_BUCKET)
    .list(folder, {
      limit: MAX_IMAGES + 2,
      sortBy: { column: "name", order: "asc" },
    });

  if (listError) {
    console.error("Unable to list unpaid generated files for cleanup:", listError);
    return false;
  }

  const paths = (data || [])
    .map((item: any) => item?.name)
    .filter((name: unknown): name is string => typeof name === "string" && name.length > 0)
    .map((name: string) => `${folder}/${name}`);

  if (paths.length === 0) return true;

  const { error: removeError } = await supabase.storage
    .from(GENERATED_IMAGES_BUCKET)
    .remove(paths);

  if (removeError) {
    console.error("Unable to remove unpaid generated files:", removeError);
    return false;
  }

  console.log("Removed unpaid generated files:", {
    requestId,
    fileCount: paths.length,
  });
  return true;
}

async function savePendingGeneration(
  supabase: any,
  userId: string,
  requestId: string,
  pending: StoredPendingGeneration,
): Promise<void> {
  const folder = getGeneratedRequestFolder(userId, requestId);
  const path = `${folder}/${PENDING_GENERATION_MANIFEST_NAME}`;
  const bytes = Buffer.from(JSON.stringify(pending), "utf8");
  const { error } = await supabase.storage
    .from(GENERATED_IMAGES_BUCKET)
    .upload(path, bytes, {
      contentType: "application/json",
      cacheControl: "no-cache",
      upsert: true,
    });
  if (error) throw new Error(`Pending request upload failed: ${error.message}`);
}

async function readPendingGeneration(
  supabase: any,
  userId: string,
  requestId: string,
): Promise<StoredPendingGeneration | null> {
  const folder = getGeneratedRequestFolder(userId, requestId);
  const path = `${folder}/${PENDING_GENERATION_MANIFEST_NAME}`;
  const { data, error } = await supabase.storage
    .from(GENERATED_IMAGES_BUCKET)
    .download(path);
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text()) as StoredPendingGeneration;
    if (
      parsed?.version === 1 &&
      parsed.clientRequestId === requestId &&
      (
        (
          parsed.provider === "fal-gpt-image-2" &&
          typeof parsed.falRequestId === "string" &&
          [FAL_GPT_IMAGE_2_TEXT_ENDPOINT, FAL_GPT_IMAGE_2_EDIT_ENDPOINT].includes(parsed.endpoint)
        ) ||
        (
          parsed.provider === "evolink-mj-v8.1" &&
          typeof parsed.evolinkTaskId === "string"
        )
      )
    ) {
      return parsed;
    }
  } catch (error) {
    console.warn("Unable to parse pending generation:", error);
  }
  return null;
}

async function deletePendingGeneration(
  supabase: any,
  userId: string,
  requestId: string,
): Promise<void> {
  const folder = getGeneratedRequestFolder(userId, requestId);
  const path = `${folder}/${PENDING_GENERATION_MANIFEST_NAME}`;
  const { error } = await supabase.storage
    .from(GENERATED_IMAGES_BUCKET)
    .remove([path]);
  if (error) console.warn("Unable to remove pending request:", error.message);
}

async function saveGenerationManifest(
  supabase: any,
  userId: string,
  requestId: string,
  manifest: StoredGenerationManifest,
): Promise<void> {
  const folder = getGeneratedRequestFolder(userId, requestId);
  const path = `${folder}/${GENERATION_MANIFEST_NAME}`;
  const bytes = Buffer.from(JSON.stringify(manifest), "utf8");

  const { error } = await supabase.storage
    .from(GENERATED_IMAGES_BUCKET)
    .upload(path, bytes, {
      contentType: "application/json",
      cacheControl: "no-cache",
      upsert: true,
    });

  if (error) {
    throw new Error(`Manifest upload failed: ${error.message}`);
  }
}

async function readGenerationManifest(
  supabase: any,
  userId: string,
  requestId: string,
): Promise<StoredGenerationManifest | null> {
  const folder = getGeneratedRequestFolder(userId, requestId);
  const path = `${folder}/${GENERATION_MANIFEST_NAME}`;
  const { data, error } = await supabase.storage
    .from(GENERATED_IMAGES_BUCKET)
    .download(path);

  if (error || !data) return null;

  try {
    const parsed = JSON.parse(await data.text()) as StoredGenerationManifest;
    if (
      parsed?.success === true &&
      parsed.requestId === requestId &&
      Array.isArray(parsed.images) &&
      parsed.images.length > 0
    ) {
      return parsed;
    }
  } catch (error) {
    console.warn("Unable to parse stored generation manifest:", error);
  }

  return null;
}

async function findStoredGeneratedImages(
  supabase: any,
  userId: string,
  requestId: string,
): Promise<string[]> {
  const folder = getGeneratedRequestFolder(userId, requestId);
  const { data, error } = await supabase.storage
    .from(GENERATED_IMAGES_BUCKET)
    .list(folder, {
      limit: MAX_IMAGES + 1,
      sortBy: { column: "name", order: "asc" },
    });

  if (error) {
    console.warn("Unable to look up stored generation:", error.message);
    return [];
  }

  return (data || [])
    .filter((item: any) =>
      /^\d+\.(png|jpe?g|webp|gif)$/i.test(item?.name || ""),
    )
    .map((item: any) => {
      const path = `${folder}/${item.name}`;
      return supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(path)
        .data.publicUrl as string;
    });
}
