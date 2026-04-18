import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Gemini API endpoint
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent';

// Initialize Supabase Admin Client
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

// Estimated tokens per image
const ESTIMATED_TOKENS: Record<string, number> = {
  '512': 747,
  '1K': 1120,
  '2K': 1680,
  '4K': 2520,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', errorCode: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not configured');
    return res.status(500).json({ error: 'API key not configured', errorCode: 500 });
  }

  // Log that we have the API key (don't log the actual key)
  console.log('GEMINI_API_KEY configured:', apiKey ? 'YES' : 'NO');
  console.log('GEMINI_API_KEY length:', apiKey?.length);

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
    // STEP 2: Get User Data
    // ============================================
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('plan, credits, is_whitelisted')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      console.error('User not found:', userError?.message);
      return res.status(403).json({ 
        error: 'User account not found.',
        errorCode: 403 
      });
    }

    const userPlan = userData.plan || 'Free';
    const userCredits = userData.credits || 0;
    console.log('User plan:', userPlan, '| Credits:', userCredits, '| Whitelisted:', userData.is_whitelisted);

    // ============================================
    // STEP 3: Parse Request
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

    const numImages = Math.min(Math.max(1, numberOfImages), 4);

    // ============================================
    // STEP 4: Check Resolution Permission
    // ============================================
    const allowedResolutions = RESOLUTION_LIMITS[userPlan] || RESOLUTION_LIMITS['Free'];
    if (!allowedResolutions.includes(imageSize)) {
      console.log(`User ${userId} (${userPlan}) attempted ${imageSize} - DENIED`);
      return res.status(403).json({ 
        error: `${imageSize} resolution requires Pro subscription.`,
        errorCode: 403,
        upgradeRequired: true
      });
    }

    // ============================================
    // STEP 5: Check Pro Template
    // ============================================
    if (templateId && templateId !== 'modify-session' && templateId !== 'text-to-image') {
      const { data: template } = await supabaseAdmin
        .from('templates')
        .select('is_pro')
        .eq('id', templateId)
        .single();

      if (template?.is_pro && userPlan === 'Free') {
        return res.status(403).json({ 
          error: 'This template requires Pro subscription.',
          errorCode: 403,
          upgradeRequired: true
        });
      }
    }

    // ============================================
    // STEP 6: Pre-check Credits
    // ============================================
    const tokensPerImage = ESTIMATED_TOKENS[imageSize] || ESTIMATED_TOKENS['1K'];
    const estimatedCredits = Math.ceil((tokensPerImage * numImages) / 60);

    if (userCredits < estimatedCredits) {
      return res.status(402).json({ 
        error: `Insufficient credits. Need ~${estimatedCredits}, have ${userCredits}.`,
        errorCode: 402
      });
    }

    // ============================================
    // STEP 7: Build Request & Generate
    // ============================================
    console.log('=== Starting Generation ===');
    console.log('Prompt:', prompt.substring(0, 100) + '...');
    console.log('Image size:', imageSize);
    console.log('Number of images:', numImages);
    console.log('Aspect ratio:', aspectRatio || 'default');

    const parts: any[] = [];

    // Add base image
    if (imageUrl) {
      console.log('Fetching base image from:', imageUrl.substring(0, 80) + '...');
      const baseImageData = await fetchImageAsBase64(imageUrl);
      if (baseImageData) {
        parts.push({
          inline_data: {
            mime_type: baseImageData.mimeType,
            data: baseImageData.base64
          }
        });
        console.log('Added base/scene image, mime:', baseImageData.mimeType, 'size:', baseImageData.base64.length);
      } else {
        console.log('Failed to fetch base image');
      }
    }

    // Add product image
    if (productImageUrl) {
      console.log('Fetching product image from:', productImageUrl.substring(0, 80) + '...');
      const productImageData = await fetchImageAsBase64(productImageUrl);
      if (productImageData) {
        parts.push({
          inline_data: {
            mime_type: productImageData.mimeType,
            data: productImageData.base64
          }
        });
        console.log('Added product image, mime:', productImageData.mimeType, 'size:', productImageData.base64.length);
      } else {
        console.log('Failed to fetch product image');
      }
    }

    // Add prompt
    parts.push({ text: prompt });
    console.log('Total parts:', parts.length);

    // Build config
    const imageConfig: any = {};
    if (['512', '1K', '2K', '4K'].includes(imageSize)) {
      imageConfig.imageSize = imageSize;
    }
    if (aspectRatio) {
      imageConfig.aspectRatio = aspectRatio;
    }

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

    // Generate images
    const images: string[] = [];
    let totalTokensUsed = 0;

    for (let i = 0; i < numImages; i++) {
      console.log(`Generating image ${i + 1}/${numImages}...`);
      const result = await generateOne(apiKey, requestBody);
      
      console.log(`Image ${i + 1} result:`, {
        hasImage: !!result.image,
        tokensUsed: result.tokensUsed,
        error: result.error
      });
      
      if (result.image) {
        images.push(result.image);
        totalTokensUsed += result.tokensUsed;
      }
      
      if (result.error?.code === 429) {
        console.log('Rate limit hit');
        if (images.length > 0) {
          const partialCredits = Math.ceil(totalTokensUsed / 60);
          await deductCredits(userId, partialCredits);
        }
        return res.status(429).json({
          success: images.length > 0,
          images,
          error: 'Rate limit. Please wait.',
          errorCode: 429,
          tokensUsed: totalTokensUsed
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

    // Deduct credits
    const actualCredits = Math.ceil(totalTokensUsed / 60);
    const newBalance = await deductCredits(userId, actualCredits);
    console.log(`Deducted ${actualCredits} credits. New balance: ${newBalance}`);

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
      error: 'Generation failed.',
      errorCode: 500,
      details: err instanceof Error ? err.message : 'Unknown error' 
    });
  }
}

// ============================================
// Generate One Image - WITH DETAILED LOGGING
// ============================================
async function generateOne(
  apiKey: string, 
  requestBody: any
): Promise<{ image: string | null; tokensUsed: number; error?: { code: number; message: string } }> {
  try {
    const url = `${GEMINI_API_URL}?key=${apiKey}`;
    console.log('Calling Gemini API...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    console.log('Gemini API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error response:', response.status, errorText);
      
      if (response.status === 429) {
        return { image: null, tokensUsed: 0, error: { code: 429, message: 'Rate limit' } };
      }
      
      return { image: null, tokensUsed: 0, error: { code: response.status, message: errorText } };
    }

    const data = await response.json();
    console.log('Gemini API response keys:', Object.keys(data));
    
    // Log candidates info
    if (data.candidates) {
      console.log('Candidates count:', data.candidates.length);
      data.candidates.forEach((c: any, idx: number) => {
        console.log(`Candidate ${idx}:`, {
          hasContent: !!c.content,
          partsCount: c.content?.parts?.length,
          finishReason: c.finishReason
        });
      });
    } else {
      console.log('No candidates in response');
      console.log('Full response:', JSON.stringify(data).substring(0, 500));
    }

    // Extract token usage
    const tokensUsed = data.usageMetadata?.candidatesTokenCount || 
                       data.usageMetadata?.totalTokenCount || 
                       ESTIMATED_TOKENS['1K'];

    // Extract image
    const candidates = data.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (part.inline_data?.mime_type?.startsWith('image/')) {
          const base64 = part.inline_data.data;
          const mimeType = part.inline_data.mime_type;
          console.log('Found image in response, mime:', mimeType, 'size:', base64?.length);
          return { 
            image: `data:${mimeType};base64,${base64}`,
            tokensUsed 
          };
        }
        // Log what we found instead
        console.log('Part type:', part.text ? 'text' : part.inline_data ? 'inline_data' : 'unknown');
      }
    }

    console.log('No image found in response');
    return { image: null, tokensUsed: 0 };
  } catch (err) {
    console.error('generateOne exception:', err);
    return { image: null, tokensUsed: 0, error: { code: 500, message: String(err) } };
  }
}

// ============================================
// Deduct Credits
// ============================================
async function deductCredits(userId: string, amount: number): Promise<number> {
  try {
    const { data, error } = await supabaseAdmin.rpc('deduct_credits_atomic', {
      p_user_id: userId,
      p_amount: amount
    });

    if (!error && data !== null) {
      return data;
    }

    // Fallback
    console.log('RPC fallback for credit deduction');
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
// Fetch Image as Base64
// ============================================
async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    if (imageUrl.startsWith('data:')) {
      const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        return { mimeType: matches[1], base64: matches[2] };
      }
      return null;
    }

    console.log('Fetching image URL...');
    const response = await fetch(imageUrl);
    
    if (!response.ok) {
      console.error('Failed to fetch image, status:', response.status);
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    
    console.log('Image fetched, content-type:', contentType, 'base64 length:', base64.length);
    return { mimeType: contentType, base64 };
  } catch (err) {
    console.error('Error fetching image:', err);
    return null;
  }
}