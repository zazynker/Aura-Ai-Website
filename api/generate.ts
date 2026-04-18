import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const RESOLUTION_LIMITS: Record<string, string[]> = {
  'Free': ['512', '1K'],
  'Pro': ['512', '1K', '2K', '4K'],
};

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
    return res.status(500).json({ error: 'API key not configured', errorCode: 500 });
  }

  try {
    // Authenticate
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required.', errorCode: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid session.', errorCode: 401 });
    }

    const userId = user.id;
    console.log('User:', userId);

    // Get user data
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('plan, credits')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return res.status(403).json({ error: 'User not found.', errorCode: 403 });
    }

    const userPlan = userData.plan || 'Free';
    const userCredits = userData.credits || 0;
    console.log('Plan:', userPlan, '| Credits:', userCredits);

    // Parse request
    const { 
      prompt, 
      imageUrl, 
      productImageUrl, 
      numberOfImages = 1,
      imageSize = '1K',
      aspectRatio,
      templateId
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt required', errorCode: 400 });
    }

    const numImages = Math.min(Math.max(1, numberOfImages), 4);

    // Check resolution
    const allowed = RESOLUTION_LIMITS[userPlan] || RESOLUTION_LIMITS['Free'];
    if (!allowed.includes(imageSize)) {
      return res.status(403).json({ 
        error: `${imageSize} requires Pro.`,
        errorCode: 403,
        upgradeRequired: true
      });
    }

    // Check Pro template
    if (templateId && !['modify-session', 'text-to-image'].includes(templateId)) {
      const { data: template } = await supabaseAdmin
        .from('templates')
        .select('is_pro')
        .eq('id', templateId)
        .single();

      if (template?.is_pro && userPlan === 'Free') {
        return res.status(403).json({ 
          error: 'Pro template requires subscription.',
          errorCode: 403,
          upgradeRequired: true
        });
      }
    }

    // Check credits
    const estimatedCredits = Math.ceil((ESTIMATED_TOKENS[imageSize] * numImages) / 60);
    if (userCredits < estimatedCredits) {
      return res.status(402).json({ 
        error: `Need ~${estimatedCredits} credits, have ${userCredits}.`,
        errorCode: 402
      });
    }

    console.log('=== Generating ===');
    console.log('Size:', imageSize, '| Count:', numImages);

    // Build parts
    const parts: any[] = [];

    if (imageUrl) {
      const img = await fetchImageAsBase64(imageUrl);
      if (img) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
        console.log('Base image added');
      }
    }

    if (productImageUrl) {
      const img = await fetchImageAsBase64(productImageUrl);
      if (img) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
        console.log('Product image added');
      }
    }

    parts.push({ text: prompt });

    // Build request - CORRECT structure for Gemini
    const requestBody: any = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"],
        temperature: 1,
      }
    };

    // Add image config if needed (separate object)
    if (imageSize || aspectRatio) {
      requestBody.generationConfig.imageGenerationConfig = {};
      if (imageSize) {
        requestBody.generationConfig.imageGenerationConfig.outputSize = imageSize;
      }
      if (aspectRatio) {
        requestBody.generationConfig.imageGenerationConfig.aspectRatio = aspectRatio;
      }
    }

    console.log('Config:', JSON.stringify(requestBody.generationConfig));

    // Generate
    const images: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < numImages; i++) {
      console.log(`Image ${i + 1}/${numImages}...`);
      const result = await generateOne(apiKey, requestBody);
      
      if (result.image) {
        images.push(result.image);
        totalTokens += result.tokensUsed;
      }
      
      if (result.error?.code === 429) {
        if (images.length > 0) {
          await deductCredits(userId, Math.ceil(totalTokens / 60));
        }
        return res.status(429).json({
          success: images.length > 0,
          images,
          error: 'Rate limit.',
          errorCode: 429
        });
      }
    }

    console.log('Done:', images.length, 'images');

    if (images.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Generation failed.',
        errorCode: 500
      });
    }

    const credits = Math.ceil(totalTokens / 60);
    const newBalance = await deductCredits(userId, credits);
    console.log('Deducted:', credits, '| Balance:', newBalance);

    return res.status(200).json({
      success: true,
      images,
      count: images.length,
      tokensUsed: totalTokens,
      creditsUsed: credits,
      newCredits: newBalance
    });

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Server error.', errorCode: 500 });
  }
}

async function generateOne(apiKey: string, requestBody: any): Promise<{ image: string | null; tokensUsed: number; error?: { code: number; message: string } }> {
  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    console.log('Gemini status:', response.status);

    if (!response.ok) {
      const err = await response.text();
      console.error('Gemini error:', err.substring(0, 500));
      if (response.status === 429) {
        return { image: null, tokensUsed: 0, error: { code: 429, message: 'Rate limit' } };
      }
      return { image: null, tokensUsed: 0, error: { code: response.status, message: err } };
    }

    const data = await response.json();
    const tokensUsed = data.usageMetadata?.candidatesTokenCount || data.usageMetadata?.totalTokenCount || 1120;

    // Extract image
    for (const candidate of (data.candidates || [])) {
      for (const part of (candidate.content?.parts || [])) {
        // Try both naming conventions
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData?.mimeType?.startsWith('image/')) {
          console.log('Found image!');
          return { 
            image: `data:${inlineData.mimeType};base64,${inlineData.data}`,
            tokensUsed 
          };
        }
        if (part.text) {
          console.log('Got text:', part.text.substring(0, 100));
        }
      }
    }

    console.log('No image in response');
    return { image: null, tokensUsed: 0 };
  } catch (err) {
    console.error('generateOne error:', err);
    return { image: null, tokensUsed: 0 };
  }
}

async function deductCredits(userId: string, amount: number): Promise<number> {
  try {
    const { data, error } = await supabaseAdmin.rpc('deduct_credits_atomic', {
      p_user_id: userId,
      p_amount: amount
    });
    if (!error && data !== null) return data;

    // Fallback
    const { data: u } = await supabaseAdmin.from('users').select('credits').eq('id', userId).single();
    const newCredits = Math.max(0, (u?.credits || 0) - amount);
    await supabaseAdmin.from('users').update({ credits: newCredits }).eq('id', userId);
    return newCredits;
  } catch (err) {
    console.error('Deduct error:', err);
    return -1;
  }
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    if (url.startsWith('data:')) {
      const m = url.match(/^data:([^;]+);base64,(.+)$/);
      return m ? { mimeType: m[1], base64: m[2] } : null;
    }
    const r = await fetch(url);
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || 'image/jpeg';
    const buf = await r.arrayBuffer();
    return { mimeType: type, base64: Buffer.from(buf).toString('base64') };
  } catch {
    return null;
  }
}