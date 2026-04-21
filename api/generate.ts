import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Gemini API endpoint
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent';

// Credit calculation: tokens / 60 (same as frontend)
const calculateCreditsFromTokens = (tokensUsed: number): number => {
    if (tokensUsed <= 0) return 0;
    return Math.ceil(tokensUsed / 60);
};

// Estimated tokens per image (for pre-check)
const ESTIMATED_TOKENS_PER_IMAGE: Record<string, number> = {
    '512': 747,
    '1K': 1120,
    '2K': 1680,
    '4K': 2520,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ============================================
    // STEP 1: Validate Environment Variables
    // ============================================
    const apiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey) {
        console.error('GEMINI_API_KEY not configured');
        return res.status(500).json({ error: 'API key not configured' });
    }

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('Supabase credentials not configured');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    // ============================================
    // STEP 2: Verify User Authentication (JWT)
    // ============================================
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error('Missing or invalid Authorization header');
        return res.status(401).json({ 
            success: false,
            error: 'Authentication required. Please login again. [E401]',
            errorCode: 401
        });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Create Supabase client with service role (for database operations)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false }
    });

    // Verify the JWT token and get user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
        console.error('JWT verification failed:', authError?.message);
        return res.status(401).json({ 
            success: false,
            error: 'Invalid or expired session. Please login again. [E401]',
            errorCode: 401
        });
    }

    console.log('=== Authenticated User ===');
    console.log('User ID:', user.id);
    console.log('Email:', user.email);

    // ============================================
    // STEP 3: Fetch User Data & Check Permissions
    // ============================================
    const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('credits, plan, is_whitelisted, is_admin')
        .eq('id', user.id)
        .single();

    if (userError || !userData) {
        console.error('Failed to fetch user data:', userError?.message);
        return res.status(403).json({ 
            success: false,
            error: 'User account not found. [E403]',
            errorCode: 403
        });
    }

    // Check whitelist (only whitelisted users can generate)
    if (!userData.is_whitelisted && !userData.is_admin) {
        console.log('User not whitelisted:', user.email);
        return res.status(403).json({ 
            success: false,
            error: 'Image generation coming soon! Stay tuned. [E403]',
            errorCode: 403
        });
    }

    // ============================================
    // STEP 4: Parse Request & Estimate Credits
    // ============================================
    try {
        const { 
            prompt, 
            imageUrl, 
            productImageUrl, 
            numberOfImages = 4,
            imageSize = '1K',
            aspectRatio
        } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const numToGenerate = Math.min(Math.max(1, numberOfImages), 4);
        
        // Estimate credits needed
        const tokensPerImage = ESTIMATED_TOKENS_PER_IMAGE[imageSize] || ESTIMATED_TOKENS_PER_IMAGE['1K'];
        const estimatedCredits = Math.ceil((tokensPerImage * numToGenerate) / 60);

        console.log('=== Credit Pre-Check ===');
        console.log('User credits:', userData.credits);
        console.log('Estimated credits needed:', estimatedCredits);

        // ============================================
        // STEP 5: Check Credits BEFORE Generation
        // ============================================
        if (userData.credits < estimatedCredits) {
            return res.status(402).json({ 
                success: false,
                error: `Not enough credits. Need ~${estimatedCredits}, have ${userData.credits}. [E402]`,
                errorCode: 402,
                creditsNeeded: estimatedCredits,
                creditsAvailable: userData.credits
            });
        }

        console.log('=== Generate API called ===');
        console.log('Prompt:', prompt.substring(0, 100) + '...');
        console.log('Has base image:', !!imageUrl);
        console.log('Has product image:', !!productImageUrl);
        console.log('Number of images requested:', numToGenerate);
        console.log('Image size:', imageSize);

        // Build the request content parts
        const parts: any[] = [];

        // Add base/scene image FIRST if provided
        if (imageUrl) {
            const baseImageData = await fetchImageAsBase64(imageUrl);
            if (baseImageData) {
                parts.push({
                    inline_data: {
                        mime_type: baseImageData.mimeType,
                        data: baseImageData.base64
                    }
                });
                console.log('Added base/scene image to request (FIRST)');
            }
        }

        // Add product image SECOND if provided
        if (productImageUrl) {
            const productImageData = await fetchImageAsBase64(productImageUrl);
            if (productImageData) {
                parts.push({
                    inline_data: {
                        mime_type: productImageData.mimeType,
                        data: productImageData.base64
                    }
                });
                console.log('Added product image to request (SECOND)');
            }
        }

        // Add the text prompt LAST
        parts.push({ text: prompt });

        // Build imageConfig
        const imageConfig: any = {};
        if (imageSize && ['512', '1K', '2K', '4K'].includes(imageSize)) {
            imageConfig.imageSize = imageSize;
        }
        if (aspectRatio) {
            imageConfig.aspectRatio = aspectRatio;
        }

        // Build the full request body
        const requestBody: any = {
            contents: [{ parts: parts }],
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

        // ============================================
        // STEP 6: Generate Images
        // ============================================
        interface GenerationResult {
            image: string | null;
            tokensUsed: number;
            error?: { code: number; message: string };
        }
        
        const generateOne = async (attempt = 1): Promise<GenerationResult> => {
            const maxAttempts = 3;
            try {
                const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`Gemini API error (attempt ${attempt}):`, response.status, errorText);
                    
                    if (response.status === 429) {
                        return { 
                            image: null, 
                            tokensUsed: 0,
                            error: { code: 429, message: 'Server is busy. Please wait 30 seconds. [E429]' }
                        };
                    }
                    
                    if (attempt < maxAttempts) {
                        await new Promise(r => setTimeout(r, 300 * attempt));
                        return generateOne(attempt + 1);
                    }
                    return { image: null, tokensUsed: 0, error: { code: response.status, message: `API error [E${response.status}]` }};
                }

                const data = await response.json();
                const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
                
                if (data.candidates && data.candidates[0]?.content?.parts) {
                    for (const part of data.candidates[0].content.parts) {
                        if (part.inlineData?.data) {
                            const mimeType = part.inlineData.mimeType || 'image/png';
                            return { 
                                image: `data:${mimeType};base64,${part.inlineData.data}`,
                                tokensUsed: outputTokens
                            };
                        }
                    }
                }
                
                if (attempt < maxAttempts) {
                    await new Promise(r => setTimeout(r, 300 * attempt));
                    return generateOne(attempt + 1);
                }
                return { image: null, tokensUsed: 0 };
            } catch (err) {
                console.error(`Error in generateOne (attempt ${attempt}):`, err);
                if (attempt < maxAttempts) {
                    await new Promise(r => setTimeout(r, 300 * attempt));
                    return generateOne(attempt + 1);
                }
                return { image: null, tokensUsed: 0 };
            }
        };

        let images: string[] = [];
        let totalTokensUsed = 0;
        let rateLimitError: { code: number; message: string } | null = null;
        
        // Generate images in parallel
        const promises = Array.from({ length: numToGenerate }, () => generateOne());
        const results = await Promise.all(promises);
        
        for (const result of results) {
            if (result.image) images.push(result.image);
            totalTokensUsed += result.tokensUsed;
            if (result.error?.code === 429) rateLimitError = result.error;
        }

        // Handle rate limit error
        if (rateLimitError && images.length === 0) {
            return res.status(429).json({
                success: false,
                error: rateLimitError.message,
                errorCode: 429,
                images: [],
                tokensUsed: 0
            });
        }

        // ============================================
        // STEP 7: Deduct Credits (Atomic Operation)
        // ============================================
        const actualCredits = calculateCreditsFromTokens(totalTokensUsed);
        
        if (actualCredits > 0 && images.length > 0) {
            console.log('=== Deducting Credits ===');
            console.log('Tokens used:', totalTokensUsed);
            console.log('Credits to deduct:', actualCredits);

            // Use RPC for atomic deduction if available, otherwise manual update
            const { data: deductResult, error: deductError } = await supabaseAdmin.rpc(
                'deduct_credits_atomic',
                { user_id: user.id, amount: actualCredits }
            ).single();

            if (deductError) {
                // Fallback: manual deduction with optimistic locking
                console.warn('RPC not available, using manual deduction:', deductError.message);
                
                const { error: updateError } = await supabaseAdmin
                    .from('users')
                    .update({ credits: userData.credits - actualCredits })
                    .eq('id', user.id)
                    .eq('credits', userData.credits); // Optimistic lock
                
                if (updateError) {
                    console.error('Failed to deduct credits:', updateError.message);
                    // Still return images but log the error
                } else {
                    console.log('Credits deducted successfully (manual)');
                }
            } else {
              console.log('Credits deducted successfully (RPC). New balance:', (deductResult as any)?.new_credits);
            }
        }

        // ============================================
        // STEP 8: Return Results
        // ============================================
        console.log('=== Generation Summary ===');
        console.log('Images generated:', images.length);
        console.log('Total tokens:', totalTokensUsed);
        console.log('Credits charged:', actualCredits);

        if (images.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'All generation attempts failed. Please try again. [E500]',
                errorCode: 500,
                tokensUsed: totalTokensUsed
            });
        }

        return res.status(200).json({
            success: true,
            images: images,
            text: '',
            count: images.length,
            imageSize: imageSize,
            tokensUsed: totalTokensUsed,
            creditsUsed: actualCredits
        });

    } catch (err) {
        console.error('Generation exception:', err);
        return res.status(500).json({ 
            success: false,
            error: 'Generation failed. Please try again. [E500]', 
            errorCode: 500,
            details: err instanceof Error ? err.message : 'Unknown error' 
        });
    }
}

// Helper function to fetch and convert image to base64
async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string } | null> {
    try {
        if (imageUrl.startsWith('data:')) {
            const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
                return { mimeType: matches[1], base64: matches[2] };
            }
            return null;
        }

        const response = await fetch(imageUrl);
        if (!response.ok) {
            console.error('Failed to fetch image:', imageUrl);
            return null;
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');

        return { mimeType: contentType, base64: base64 };
    } catch (err) {
        console.error('Error fetching image:', err);
        return null;
    }
}