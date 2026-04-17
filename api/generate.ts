import type { VercelRequest, VercelResponse } from '@vercel/node';

// Gemini API endpoint - using gemini-3.1-flash-image-preview (Nano Banana 2)
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

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

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        console.log('=== Generate API called ===');
        console.log('Prompt:', prompt.substring(0, 100) + '...');
        console.log('Has base image:', !!imageUrl);
        console.log('Has product image:', !!productImageUrl);
        console.log('Number of images requested:', numberOfImages);
        console.log('Image size:', imageSize);
        console.log('Aspect ratio:', aspectRatio || 'default');

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
                // Use IMAGE only to avoid text output consuming extra tokens
                responseModalities: ["IMAGE"],
                temperature: 1,
                // Minimize thinking tokens to reduce unnecessary token consumption
                // Thinking tokens are billed even if not requested
                thinkingConfig: {
                    thinkingLevel: "MINIMAL"
                }
            },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
            ]
        };

        console.log('Is pure text-to-image:', isPureTextToImage);
        console.log('Response modalities:', requestBody.generationConfig.responseModalities);

        // Add imageConfig if we have any settings
        if (Object.keys(imageConfig).length > 0) {
            requestBody.generationConfig.imageConfig = imageConfig;
            console.log('ImageConfig:', imageConfig);
        }

        console.log('Sending request to Gemini API...');
        console.log('Request parts count:', parts.length);
        console.log('Number of images to generate:', numberOfImages);

        // Generate multiple images by calling API multiple times in parallel
        // With retry mechanism to improve success rate
        // Returns both image and token usage
        interface GenerationResult {
            image: string | null;
            tokensUsed: number;
            error?: { code: number; message: string };  // 新增：错误信息
        }
        
        const generateOne = async (attempt = 1): Promise<GenerationResult> => {
            const maxAttempts = 3; // Max retry attempts per image
            try {
                const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`Gemini API error (attempt ${attempt}):`, response.status, errorText);
                    
                    // ========== 429 错误不重试，直接返回 ==========
                    if (response.status === 429) {
                        console.error('Rate limit exceeded (429), not retrying');
                        return { 
                            image: null, 
                            tokensUsed: 0,
                            error: { 
                                code: 429, 
                                message: 'Server is busy right now. Please wait 30 seconds and try again. [E429]' 
                            }
                        };
                    }
                    
                    // 其他错误可以重试
                    if (attempt < maxAttempts) {
                        await new Promise(r => setTimeout(r, 300 * attempt)); // Increasing delay
                        return generateOne(attempt + 1);
                    }
                    return { 
                        image: null, 
                        tokensUsed: 0,
                        error: { 
                            code: response.status, 
                            message: `API error [E${response.status}]` 
                        }
                    };
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
        const numToGenerate = Math.min(Math.max(1, numberOfImages), 4);
        let images: string[] = [];
        let totalTokensUsed = 0;
        let totalAttempts = 0;
        let rateLimitError: { code: number; message: string } | null = null;  // 记录 429 错误
        const maxTotalAttempts = numToGenerate * 2; // Allow up to 2x attempts to fill quota
        
        // First batch - parallel
        const promises = Array.from({ length: numToGenerate }, () => generateOne());
        const results = await Promise.all(promises);
        
        for (const result of results) {
            if (result.image) {
                images.push(result.image);
            }
            totalTokensUsed += result.tokensUsed;
            
            // 检查是否有 429 错误
            if (result.error?.code === 429) {
                rateLimitError = result.error;
            }
        }
        totalAttempts = numToGenerate;
        
        // ========== 如果遇到 429 错误，立即返回，不再重试 ==========
        if (rateLimitError) {
            console.error('Rate limit hit, returning immediately');
            return res.status(429).json({
                success: false,
                error: rateLimitError.message,
                errorCode: 429,
                images: images,  // 返回已成功生成的图片
                count: images.length,
                tokensUsed: totalTokensUsed
            });
        }
        
        // If we didn't get enough, try to fill the gap (only if no rate limit error)
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
                
                // 检查是否有 429 错误
                if (result.error?.code === 429) {
                    rateLimitError = result.error;
                    break;
                }
            }
            totalAttempts += needed;
            
            // 如果遇到 429，停止重试
            if (rateLimitError) {
                console.error('Rate limit hit during retry, stopping');
                break;
            }
        }
        
        console.log('=== Generation Summary ===');
        console.log('Total images generated:', images.length, 'out of', numToGenerate, 'requested');
        console.log('Image size setting:', imageSize);
        console.log('Total tokens used:', totalTokensUsed);

        if (images.length === 0) {
            // 如果是 429 错误导致的失败
            if (rateLimitError) {
                return res.status(429).json({
                    success: false,
                    error: rateLimitError.message,
                    errorCode: 429,
                    images: [],
                    count: 0,
                    tokensUsed: totalTokensUsed
                });
            }
            
            return res.status(500).json({
                success: false,
                error: 'All generation attempts failed. Please try again. [E500]',
                errorCode: 500,
                images: [],
                count: 0,
                tokensUsed: totalTokensUsed
            });
        }

        return res.status(200).json({
            success: true,
            images: images,
            text: '',
            count: images.length,
            imageSize: imageSize,
            tokensUsed: totalTokensUsed
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