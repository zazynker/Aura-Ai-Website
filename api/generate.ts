import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Gemini API endpoint - using gemini-3.1-flash-image-preview (Nano Banana 2)
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent';

// Initialize Supabase client for user verification
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ============ INPUT VALIDATION CONSTANTS ============
const VALID_SIZES = ['512', '1K', '2K', '4K'];
const MAX_PROMPT_LENGTH = 2000;
const MAX_IMAGES = 4;

// Estimated tokens per image for credit pre-check
const ESTIMATED_TOKENS_PER_IMAGE: Record<string, number> = {
    '512': 747,
    '1K': 1120,
    '2K': 1680,
    '4K': 2520,
};
// ====================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ============================================
    // JWT Authentication (Required for all requests)
    // ============================================
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ 
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }

    const token = authHeader.substring(7);
    
    // Verify Supabase credentials exist
    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('Supabase credentials not configured');
        return res.status(500).json({ 
            error: 'Server configuration error',
            code: 'CONFIG_ERROR'
        });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        console.error('Auth verification failed:', authError?.message);
        return res.status(401).json({ 
            error: 'Invalid or expired token',
            code: 'INVALID_TOKEN'
        });
    }

    console.log('Authenticated user:', user.id);
    // ============================================

    // ============================================
    // Rate Limiting (10 requests per minute)
    // ============================================
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    
    const { count, error: countError } = await supabase
        .from('generations')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', oneMinuteAgo);

    if (countError) {
        console.error('Rate limit check failed:', countError);
        // Fail open - allow request if we can't check rate limit
    } else if (count !== null && count >= 10) {
        console.log(`Rate limit exceeded for user ${user.id}: ${count} requests in last minute`);
        return res.status(429).json({
            error: 'Slow down! Please wait a moment before generating more images.',
            code: 'RATE_LIMITED'
        });
    }
    // ============================================

    // ============================================
    // Credit Pre-Check (estimate based on request)
    // ============================================
    const requestedImages = Math.min(Math.max(1, Number(req.body.numberOfImages) || 1), MAX_IMAGES);
    const requestedSize = VALID_SIZES.includes(req.body.imageSize) ? req.body.imageSize : '1K';
    const estimatedTokens = (ESTIMATED_TOKENS_PER_IMAGE[requestedSize] || 1120) * requestedImages;
    const estimatedCredits = Math.ceil(estimatedTokens / 60);
    
    // Fetch user data for credit check and plan verification
    const { data: userData, error: userDataError } = await supabase
        .from('users')
        .select('credits, plan, is_whitelisted')
        .eq('id', user.id)
        .single();
    
    if (userDataError || !userData) {
        console.error('Failed to fetch user data:', userDataError);
        return res.status(500).json({ 
            error: 'Failed to verify user credits',
            code: 'USER_DATA_ERROR'
        });
    }
    
    // Whitelisted users bypass credit check
    if (!userData.is_whitelisted && userData.credits < estimatedCredits) {
        console.log(`Insufficient credits: has ${userData.credits}, needs ~${estimatedCredits}`);
        return res.status(402).json({
            error: 'Insufficient credits. Please purchase more credits to continue.',
            code: 'INSUFFICIENT_CREDITS',
            required: estimatedCredits,
            available: userData.credits
        });
    }
    
    console.log(`Credit pre-check passed: has ${userData.credits}, estimated need ${estimatedCredits}, whitelisted: ${userData.is_whitelisted}`);
    // ============================================

    // Check for API key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY not configured');
        return res.status(500).json({ error: 'API key not configured' });
    }

    try {
        const { 
            prompt, 
            imageUrl, 
            productImageUrl, 
            numberOfImages = 4,
            imageSize = '1K',  // Default to 1K, options: "512", "1K", "2K", "4K"
            aspectRatio       // Optional: "1:1", "3:4", "4:3", "9:16", "16:9", etc.
        } = req.body;

        // ============================================
        // INPUT VALIDATION
        // ============================================
        
        // 验证 prompt - 必填且长度限制
        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ 
                error: 'Prompt is required', 
                code: 'INVALID_INPUT' 
            });
        }
        if (prompt.length > MAX_PROMPT_LENGTH) {
            return res.status(400).json({ 
                error: `Prompt too long (max ${MAX_PROMPT_LENGTH} characters)`, 
                code: 'INVALID_INPUT' 
            });
        }

        // 验证 imageSize - 只允许指定值
        if (imageSize && !VALID_SIZES.includes(imageSize)) {
            return res.status(400).json({ 
                error: 'Invalid image size. Must be 512, 1K, 2K, or 4K', 
                code: 'INVALID_INPUT' 
            });
        }

        // 验证 numberOfImages - 静默截断到合法范围 (1-4)
        const validatedNumberOfImages = Math.min(Math.max(1, Number(numberOfImages) || 1), MAX_IMAGES);

        // 验证 imageUrl - 必须是 https:// 或 data: 开头
        if (imageUrl && typeof imageUrl === 'string') {
            if (!imageUrl.startsWith('https://') && !imageUrl.startsWith('data:')) {
                return res.status(400).json({ 
                    error: 'Invalid image URL. Must start with https:// or data:', 
                    code: 'INVALID_INPUT' 
                });
            }
        }

        // 验证 productImageUrl - 同样的规则
        if (productImageUrl && typeof productImageUrl === 'string') {
            if (!productImageUrl.startsWith('https://') && !productImageUrl.startsWith('data:')) {
                return res.status(400).json({ 
                    error: 'Invalid product image URL. Must start with https:// or data:', 
                    code: 'INVALID_INPUT' 
                });
            }
        }
        // ============================================

        console.log('=== Generate API called ===');
        console.log('Prompt:', prompt.substring(0, 100) + '...');
        console.log('Has base image:', !!imageUrl);
        console.log('Has product image:', !!productImageUrl);
        console.log('Number of images requested:', validatedNumberOfImages);
        console.log('Image size:', imageSize);
        console.log('Aspect ratio:', aspectRatio || 'default');
        console.log('User ID:', user.id);

        // ============================================
        // 4K Permission Check (Pro/Enterprise only)
        // Other resolutions are available for all logged-in users
        // ============================================
        if (imageSize === '4K') {
            const userPlan = userData.plan || 'Free';
            console.log('User plan:', userPlan);

            if (userPlan !== 'Pro' && userPlan !== 'Enterprise') {
                console.log('Free user attempted 4K - rejecting');
                return res.status(403).json({ 
                    error: '4K resolution is available for Pro users only',
                    code: 'PRO_REQUIRED'
                });
            }
            
            console.log('4K access granted for', userPlan, 'user');
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
                        data: baseImageData.base64
                    }
                });
                console.log('Added base/scene image to request (FIRST)');
            }
        }

        // Add product image SECOND if provided (the product to insert)
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

        // Determine if this is a pure text-to-image request (no input images)
        const isPureTextToImage = !imageUrl && !productImageUrl;

        // Build imageConfig for resolution and aspect ratio
        // Note: Gemini API uses camelCase for these parameters
        const imageConfig: any = {};
        if (imageSize && ['512', '1K', '2K', '4K'].includes(imageSize)) {
            imageConfig.imageSize = imageSize;  // camelCase
        }
        if (aspectRatio) {
            imageConfig.aspectRatio = aspectRatio;  // camelCase
            console.log('Setting aspectRatio:', aspectRatio);
        }

        // Build the full request body
        const requestBody: any = {
            contents: [{
                parts: parts
            }],
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
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
            ]
        };

        console.log('Request body imageConfig:', requestBody.generationConfig.imageConfig);

        // Function to generate a single image with retries
        const generateOne = async (attempt = 1): Promise<{ image: string | null; tokensUsed: number }> => {
            const maxAttempts = 2;
            try {
                const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestBody),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`Gemini API error (attempt ${attempt}):`, response.status, errorText);
                    if (attempt < maxAttempts) {
                        await new Promise(r => setTimeout(r, 500 * attempt));
                        return generateOne(attempt + 1);
                    }
                    return { image: null, tokensUsed: 0 };
                }

                const data = await response.json();
                
                // ===== DETAILED TOKEN LOGGING =====
                // Log the FULL usageMetadata to diagnose token discrepancies
                console.log('=== Full usageMetadata ===');
                console.log(JSON.stringify(data.usageMetadata, null, 2));
                
                // Extract token usage from usageMetadata
                const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
                const inputTokens = data.usageMetadata?.promptTokenCount || 0;
                const totalTokens = data.usageMetadata?.totalTokenCount || 0;
                const thoughtsTokens = data.usageMetadata?.thoughtsTokenCount || 0;
                
                // Log per-modality breakdown if available
                const candidatesDetails = data.usageMetadata?.candidatesTokensDetails;
                if (candidatesDetails) {
                    console.log('=== Output Token Breakdown by Modality ===');
                    for (const detail of candidatesDetails) {
                        console.log(`  ${detail.modality}: ${detail.tokenCount} tokens`);
                    }
                }
                
                const promptDetails = data.usageMetadata?.promptTokensDetails;
                if (promptDetails) {
                    console.log('=== Input Token Breakdown by Modality ===');
                    for (const detail of promptDetails) {
                        console.log(`  ${detail.modality}: ${detail.tokenCount} tokens`);
                    }
                }
                
                console.log('Token summary:', {
                    promptTokenCount: inputTokens,
                    candidatesTokenCount: outputTokens,
                    thoughtsTokenCount: thoughtsTokens,
                    totalTokenCount: totalTokens,
                    billingTokens: outputTokens
                });
                // ===== END DETAILED TOKEN LOGGING =====
                
                if (data.candidates && data.candidates[0]?.content?.parts) {
                    // Log all parts to see what's being returned
                    const parts = data.candidates[0].content.parts;
                    console.log('Response parts count:', parts.length);
                    
                    let textContent = '';
                    let imageFound = false;
                    
                    for (const part of parts) {
                        if (part.text) {
                            textContent += part.text;
                            console.log('Found TEXT in response (this consumes tokens!):', part.text.substring(0, 100) + '...');
                        }
                        if (part.inlineData?.data) {
                            imageFound = true;
                            const mimeType = part.inlineData.mimeType || 'image/png';
                            return { 
                                image: `data:${mimeType};base64,${part.inlineData.data}`,
                                tokensUsed: outputTokens
                            };
                        }
                    }
                    
                    if (textContent && !imageFound) {
                        console.log('WARNING: Response contains only text, no image!');
                    }
                }
                
                // No image in response, retry
                if (attempt < maxAttempts) {
                    console.log(`No image in response, retrying... (attempt ${attempt + 1})`);
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

        // Run generations and ensure we get the requested number
        // Use validatedNumberOfImages instead of numberOfImages
        const numToGenerate = validatedNumberOfImages;
        let images: string[] = [];
        let totalTokensUsed = 0;
        let totalAttempts = 0;
        const maxTotalAttempts = numToGenerate * 2; // Allow up to 2x attempts to fill quota
        
        // First batch - parallel
        const promises = Array.from({ length: numToGenerate }, () => generateOne());
        const results = await Promise.all(promises);
        
        for (const result of results) {
            if (result.image) {
                images.push(result.image);
            }
            totalTokensUsed += result.tokensUsed;
        }
        totalAttempts = numToGenerate;
        
        // If we didn't get enough, try to fill the gap
        while (images.length < numToGenerate && totalAttempts < maxTotalAttempts) {
            const needed = numToGenerate - images.length;
            console.log(`Only got ${images.length}/${numToGenerate}, generating ${needed} more...`);
            const extraPromises = Array.from({ length: needed }, () => generateOne());
            const extraResults = await Promise.all(extraPromises);
            for (const result of extraResults) {
                if (result.image) {
                    images.push(result.image);
                }
                totalTokensUsed += result.tokensUsed;
            }
            totalAttempts += needed;
        }
        
        console.log('=== Generation Summary ===');
        console.log('Total images generated:', images.length, 'out of', numToGenerate, 'requested');
        console.log('Image size setting:', imageSize);
        console.log('Total tokens used:', totalTokensUsed);

        if (images.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'All generation attempts failed',
                images: [],
                count: 0,
                tokensUsed: totalTokensUsed
            });
        }

        // ============================================
        // Deduct credits after successful generation
        // ============================================
        const creditsToDeduct = Math.ceil(totalTokensUsed / 60);
        console.log(`Deducting ${creditsToDeduct} credits (from ${totalTokensUsed} tokens)`);
        
        let newCredits = userData.credits;
        
        // Whitelisted users don't get credits deducted
        if (!userData.is_whitelisted) {
            // Call the FIFO deduction RPC function
            const { data: deductResult, error: deductError } = await supabase
                .rpc('deduct_credits_fifo', {
                    p_user_id: user.id,
                    p_amount: creditsToDeduct
                });
            
            if (deductError) {
                console.error('Credit deduction failed:', deductError);
                // Don't fail the request - images were already generated
                // Log for manual reconciliation
            } else {
                console.log('Credit deduction result:', deductResult);
                if (deductResult && deductResult.success) {
                    newCredits = deductResult.new_credits;
                }
            }
        } else {
            console.log('User is whitelisted - skipping credit deduction');
        }
        // ============================================

        return res.status(200).json({
            success: true,
            images: images,
            text: '',
            count: images.length,
            imageSize: imageSize,
            tokensUsed: totalTokensUsed,
            creditsDeducted: userData.is_whitelisted ? 0 : creditsToDeduct,
            newCredits: newCredits
        });

    } catch (err) {
        console.error('Generation exception:', err);
        return res.status(500).json({ 
            error: 'Generation failed', 
            details: err instanceof Error ? err.message : 'Unknown error' 
        });
    }
}

// Helper function to fetch and convert image to base64
async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string } | null> {
    try {
        // If it's already a data URL, extract the base64 part
        if (imageUrl.startsWith('data:')) {
            const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
                return {
                    mimeType: matches[1],
                    base64: matches[2]
                };
            }
            return null;
        }

        // Fetch the image from URL
        const response = await fetch(imageUrl);
        if (!response.ok) {
            console.error('Failed to fetch image:', imageUrl);
            return null;
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');

        return {
            mimeType: contentType,
            base64: base64
        };
    } catch (err) {
        console.error('Error fetching image:', err);
        return null;
    }
}