import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent";
const USD_TO_CREDITS = 195;
const INPUT_USD_PER_MILLION = 0.5;
const TEXT_AND_THINKING_USD_PER_MILLION = 3.0;
const IMAGE_OUTPUT_USD_PER_MILLION = 60.0;
const ESTIMATED_OVERHEAD_USD_PER_IMAGE = 0.005;

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
  newCredits?: number;
  requestId: string;
  recovered: boolean;
};
type GenerateRequestBody = {
  prompt?: string;
  imageUrl?: string;
  productImageUrl?: string;
  numberOfImages?: number;
  imageSize?: string;
  aspectRatio?: string;
  requestId?: string;
  recoverOnly?: boolean;
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

  const existingImages = await findStoredGeneratedImages(
    supabase,
    user.id,
    requestId,
  );
  if (existingImages.length > 0 || body.recoverOnly) {
    return res.status(202).json({
      success: false,
      pending: true,
      code: "RESULT_NOT_READY",
      error: "The generation result is still being finalized.",
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
  const estimatedCredits = estimateImageCredits(requestedSize, requestedImages);

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

  // Check for API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY not configured");
    return res.status(500).json({ error: "API key not configured" });
  }

  try {
    const {
      prompt,
      imageUrl,
      productImageUrl,
      numberOfImages = 1,
      imageSize = "1K", // Default to 1K, options: "512", "1K", "2K", "4K"
      aspectRatio, // Optional: "1:1", "3:4", "4:3", "9:16", "16:9", etc.
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
    console.log("User ID:", user.id);

    // ============================================
    // 4K Permission Check (Pro/Enterprise only)
    // Other resolutions are available for all logged-in users
    // ============================================
    if (imageSize === "4K") {
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

    // Whitelisted users don't get credits deducted
    if (!userData.is_whitelisted) {
      // Call the FIFO deduction RPC function
      const { data: deductResult, error: deductError } = await supabase.rpc(
        "deduct_credits_fifo",
        {
          p_user_id: user.id,
          p_amount: creditsToDeduct,
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
          !deductError && deductResult?.success === false;

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
      creditsDeducted = creditsToDeduct;
      newCredits = Number(
        deductResult.new_balance ?? deductResult.new_credits ?? newCredits,
      );
    } else {
      console.log("User is whitelisted - skipping credit deduction");
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
            upsert: false,
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
