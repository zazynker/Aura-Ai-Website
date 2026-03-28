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
                responseModalities: ["Image"],
                temperature: 1,
            },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
            ]
        };

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
        const generateOne = async (attempt = 1): Promise<string | null> => {
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
                    if (attempt < maxAttempts) {
                        await new Promise(r => setTimeout(r, 300 * attempt)); // Increasing delay
                        return generateOne(attempt + 1);
                    }
                    return null;
                }

                const data = await response.json();
                
                if (data.candidates && data.candidates[0]?.content?.parts) {
                    for (const part of data.candidates[0].content.parts) {
                        if (part.inlineData?.data) {
                            const mimeType = part.inlineData.mimeType || 'image/png';
                            return `data:${mimeType};base64,${part.inlineData.data}`;
                        }
                    }
                }
                
                // No image in response, retry
                if (attempt < maxAttempts) {
                    console.log(`No image in response, retrying... (attempt ${attempt + 1})`);
                    await new Promise(r => setTimeout(r, 300 * attempt));
                    return generateOne(attempt + 1);
                }
                return null;
            } catch (err) {
                console.error(`Error in generateOne (attempt ${attempt}):`, err);
                if (attempt < maxAttempts) {
                    await new Promise(r => setTimeout(r, 300 * attempt));
                    return generateOne(attempt + 1);
                }
                return null;
            }
        };

        // Run generations and ensure we get the requested number
        const numToGenerate = Math.min(Math.max(1, numberOfImages), 4);
        let images: string[] = [];
        let totalAttempts = 0;
        const maxTotalAttempts = numToGenerate * 2; // Allow up to 2x attempts to fill quota
        
        // First batch - parallel
        const promises = Array.from({ length: numToGenerate }, () => generateOne());
        const results = await Promise.all(promises);
        images = results.filter((img): img is string => img !== null);
        totalAttempts = numToGenerate;
        
        // If we didn't get enough, try to fill the gap
        while (images.length < numToGenerate && totalAttempts < maxTotalAttempts) {
            const needed = numToGenerate - images.length;
            console.log(`Only got ${images.length}/${numToGenerate}, generating ${needed} more...`);
            const extraPromises = Array.from({ length: needed }, () => generateOne());
            const extraResults = await Promise.all(extraPromises);
            const extraImages = extraResults.filter((img): img is string => img !== null);
            images = [...images, ...extraImages];
            totalAttempts += needed;
        }
        
        console.log('Total images generated:', images.length, 'out of', numToGenerate, 'requested');
        console.log('Image size setting:', imageSize);

        if (images.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'All generation attempts failed',
                images: [],
                count: 0
            });
        }

        return res.status(200).json({
            success: true,
            images: images,
            text: '',
            count: images.length,
            imageSize: imageSize
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