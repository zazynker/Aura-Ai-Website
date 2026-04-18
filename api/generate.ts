import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Gemini API endpoint - using gemini-3.1-flash-image-preview
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent';

// Initialize Supabase Admin Client (uses service role key to bypass RLS)
const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Resolution limits by plan
const RESOLUTION_LIMITS: Record<string, string[]> = {
  'Free': ['512', '1K'],
  'Pro': ['512', '1K', '2K', '4K'],
  'Enterprise': ['512', '1K', '2K', '4K'],
};

// Estimated tokens per image (for credit pre-check)
const ESTIMATED_TOKENS: Record<string, number> = {
  '512': 747,
  '1K': 1120,
  '2K': 1680,
  '4K': 2520,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', errorCode: 405 });
  }

  // Check for Gemini API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not configured');
    return res.status(500).json({ error: 'API key not configured', errorCode: 500 });
  }

  try {
    // ============================================
    // STEP 1: Authenticate User
    // ============================================
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('No auth header provided');
      return res.status(401).json({ 
        error: 'Authentication required. Please login to generate images.',
        errorCode: 401 
      });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Verify the JWT token with Supabase
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Auth error:', authError?.message);
      return res.status(401).json({ 
        error: 'Invalid or expired session. Please login again.',
        errorCode: 401 
      });
    }

    const userId = user.id;
    console.log('Authenticated user:', userId);

    // ============================================
    // STEP 2: Get User Data (plan, credits)
    // ============================================
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('plan, credits, is_whitelisted')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      console.error('User not found:', userError?.message);
      return res.status(403).json({ 
        error: 'User account not found. Please contact support.',
        errorCode: 403 
      });
    }

    const userPlan = userData.plan || 'Free';
    const userCredits = userData.credits || 0;
    const isWhitelisted = userData.is_whitelisted || false;

    console.log('User plan:', userPlan, '| Credits:', userCredits, '| Whitelisted:', isWhitelisted);

    // ============================================
    // STEP 3: Parse and Validate Request
    // ============================================
    const { 
      prompt, 
      imageUrl, 
      productImageUrl, 
      numberOfImages = 4,
      imageSize = '1K',
      aspectRatio,
      templateId
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required', errorCode: 400 });
    }

    // Clamp numberOfImages between 1 and 4
    const numImages = Math.min(Math.max(1, numberOfImages), 4);

    // ============================================
    // STEP 4: Check Resolution Permission
    // ============================================
    const allowedResolutions = RESOLUTION_LIMITS[userPlan] || RESOLUTION_LIMITS['Free'];
    
    if (!allowedResolutions.includes(imageSize)) {
      console.log(`User ${userId} (${userPlan}) attempted ${imageSize} resolution - DENIED`);
      return res.status(403).json({ 
        error: `${imageSize} resolution requires a Pro subscription. Please upgrade to access higher resolutions.`,
        errorCode: 403,
        upgradeRequired: true
      });
    }

    // ============================================
    // STEP 5: Check Pro Template Permission
    // ============================================
    if (templateId && templateId !== 'modify-session' && templateId !== 'text-to-image') {
      const { data: template, error: templateError } = await supabaseAdmin
        .from('templates')
        .select('is_pro')
        .eq('id', templateId)
        .single();

      if (!templateError && template?.is_pro && userPlan === 'Free') {
        console.log(`User ${userId} (Free) attempted Pro template ${templateId} - DENIED`);
        return res.status(403).json({ 
          error: 'This template requires a Pro subscription.',
          errorCode: 403,
          upgradeRequired: true
        });
      }
    }

    // ============================================
    // STEP 6: Estimate Credits & Pre-check Balance
    // ============================================
    const tokensPerImage = ESTIMATED_TOKENS[imageSize] || ESTIMATED_TOKENS['1K'];
    const estimatedTokens = tokensPerImage * numImages;
    const estimatedCredits = Math.ceil(estimatedTokens / 60);

    if (userCredits < estimatedCredits) {
      console.log(`User ${userId} insufficient credits: has ${userCredits}, needs ~${estimatedCredits}`);
      return res.status(402).json({ 
        error: `Insufficient credits. You need approximately ${estimatedCredits} credits, but only have ${userCredits}.`,
        errorCode: 402,
        creditsRequired: estimatedCredits,
        creditsAvailable: userCredits
      });
    }

    // ============================================
    // STEP 7: Generate Images
    // ============================================
    console.log('=== Starting Generation ===');
    console.log('Prompt:', prompt.substring(0, 100) + '...');
    console.log('Image size:', imageSize);
    console.log('Number of images:', numImages);
    console.log('Aspect ratio:', aspectRatio || 'default');

    // Build the request content parts
    const parts: any[] = [];

    // Add base/scene image if provided (FIRST)
    if (imageUrl) {
      const baseImageData = await fetchImageAsBase64(imageUrl);
      if (baseImageData) {
        parts.push({
          inline_data: {
            mime_type: baseImageData.mimeType,
            data: baseImageData.base64
          }
        });
        console.log('Added base/scene image');
      }
    }

    // Add product image if provided (SECOND)
    if (productImageUrl) {
      const productImageData = await fetchImageAsBase64(productImageUrl);
      if (productImageData) {
        parts.push({
          inline_data: {
            mime_type: productImageData.mimeType,
            data: productImageData.base64
          }
        });
        console.log('Added product image');
      }
    }

    // Add the text prompt (LAST)
    parts.push({ text: prompt });

    // Build imageConfig for resolution and aspect ratio
    const imageConfig: any = {};
    if (imageSize && ['512', '1K', '2K', '4K'].includes(imageSize)) {
      imageConfig.imageSize = imageSize;
    }
    if (aspectRatio) {
      imageConfig.aspectRatio = aspectRatio;
    }

    // Build the full request body
    const requestBody: any = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        temperature: 1,
        thinkingConfig: { thinkingLevel: "MINIMAL" }
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
      ]
    };

    if (Object.keys(imageConfig).length > 0) {
      requestBody.generationConfig.imageConfig = imageConfig;
    }

    // Generate images (call API multiple times for multiple images)
    const images: string[] = [];
    let totalTokensUsed = 0;

    for (let i = 0; i < numImages; i++) {
      const result = await generateOne(apiKey, requestBody);
      
      if (result.image) {
        images.push(result.image);
        totalTokensUsed += result.tokensUsed;
      }
      
      // Check for rate limit - return partial results
      if (result.error?.code === 429) {
        console.log('Rate limit hit at image', i + 1, '- returning partial results');
        
        // Still deduct credits for successful images
        if (images.length > 0) {
          const partialCredits = Math.ceil(totalTokensUsed / 60);
          await deductCredits(userId, partialCredits);
        }
        
        return res.status(429).json({
          success: images.length > 0,
          images,
          error: 'Rate limit reached. Please wait a moment and try again.',
          errorCode: 429,
          tokensUsed: totalTokensUsed,
          creditsUsed: Math.ceil(totalTokensUsed / 60)
        });
      }
    }

    console.log('Generation complete:', images.length, 'images');
    console.log('Total tokens used:', totalTokensUsed);

    if (images.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'All generation attempts failed. Please try again.',
        errorCode: 500,
        tokensUsed: 0
      });
    }

    // ============================================
    // STEP 8: Deduct Credits (Atomic)
    // ============================================
    const actualCredits = Math.ceil(totalTokensUsed / 60);
    const newBalance = await deductCredits(userId, actualCredits);
    
    console.log(`Deducted ${actualCredits} credits. New balance: ${newBalance}`);

    // ============================================
    // STEP 9: Return Success Response
    // ============================================
    return res.status(200).json({
      success: true,
      images,
      count: images.length,
      imageSize,
      tokensUsed: totalTokensUsed,
      creditsUsed: actualCredits,
      newCredits: newBalance
    });

  } catch (err) {
    console.error('Generation exception:', err);
    return res.status(500).json({ 
      error: 'Generation failed. Please try again.',
      errorCode: 500,
      details: err instanceof Error ? err.message : 'Unknown error' 
    });
  }
}

// ============================================
// Helper: Generate One Image
// ============================================
async function generateOne(
  apiKey: string, 
  requestBody: any
): Promise<{ image: string | null; tokensUsed: number; error?: { code: number; message: string } }> {
  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText.substring(0, 200));
      
      // Don't retry on rate limit
      if (response.status === 429) {
        return { image: null, tokensUsed: 0, error: { code: 429, message: 'Rate limit exceeded' } };
      }
      
      return { image: null, tokensUsed: 0, error: { code: response.status, message: errorText } };
    }

    const data = await response.json();
    
    // Extract token usage
    const tokensUsed = data.usageMetadata?.candidatesTokenCount || 
                       data.usageMetadata?.totalTokenCount || 
                       ESTIMATED_TOKENS['1K']; // Default estimate

    // Extract image from response
    const candidates = data.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (part.inline_data?.mime_type?.startsWith('image/')) {
          const base64 = part.inline_data.data;
          const mimeType = part.inline_data.mime_type;
          return { 
            image: `data:${mimeType};base64,${base64}`,
            tokensUsed 
          };
        }
      }
    }

    return { image: null, tokensUsed: 0 };
  } catch (err) {
    console.error('generateOne error:', err);
    return { image: null, tokensUsed: 0 };
  }
}

// ============================================
// Helper: Deduct Credits (Atomic via RPC)
// ============================================
async function deductCredits(userId: string, amount: number): Promise<number> {
  try {
    // Try atomic RPC first
    const { data, error } = await supabaseAdmin.rpc('deduct_credits_atomic', {
      p_user_id: userId,
      p_amount: amount
    });

    if (!error && data !== null) {
      return data;
    }

    // Fallback: manual update if RPC doesn't exist
    console.log('RPC fallback - manual credit deduction');
    
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('credits')
      .eq('id', userId)
      .single();

    const currentCredits = userData?.credits || 0;
    const newCredits = Math.max(0, currentCredits - amount);

    await supabaseAdmin
      .from('users')
      .update({ credits: newCredits })
      .eq('id', userId);

    return newCredits;
  } catch (err) {
    console.error('Deduct credits error:', err);
    return -1;
  }
}

// ============================================
// Helper: Fetch Image as Base64
// ============================================
async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    // Handle data URLs
    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        return { mimeType: matches[1], base64: matches[2] };
      }
      return null;
    }

    // Fetch from URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error('Failed to fetch image:', imageUrl.substring(0, 100));
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return { mimeType: contentType, base64 };
  } catch (err) {
    console.error('Error fetching image:', err);
    return null;
  }
}