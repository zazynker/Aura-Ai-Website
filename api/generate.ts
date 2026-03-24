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
        const { prompt, imageUrl, productImageUrl, numberOfImages = 1 } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        console.log('=== Generate API called ===');
        console.log('Prompt:', prompt.substring(0, 100) + '...');
        console.log('Has base image:', !!imageUrl);
        console.log('Has product image:', !!productImageUrl);
        console.log('Number of images:', numberOfImages);

        // Build the request content parts
        const parts: any[] = [];

        // Add product image first if provided (for Replace functionality)
        if (productImageUrl) {
            const productImageData = await fetchImageAsBase64(productImageUrl);
            if (productImageData) {
                parts.push({
                    inline_data: {
                        mime_type: productImageData.mimeType,
                        data: productImageData.base64
                    }
                });
                console.log('Added product image to request');
            }
        }

        // Add base/scene image if provided
        if (imageUrl) {
            const baseImageData = await fetchImageAsBase64(imageUrl);
            if (baseImageData) {
                parts.push({
                    inline_data: {
                        mime_type: baseImageData.mimeType,
                        data: baseImageData.base64
                    }
                });
                console.log('Added base image to request');
            }
        }

        // Add the text prompt
        parts.push({ text: prompt });

        // Build the full request body
        const requestBody = {
            contents: [{
                parts: parts
            }],
            generationConfig: {
                responseModalities: ["Text", "Image"],
                temperature: 1,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 8192,
            },
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
            ]
        };

        console.log('Sending request to Gemini API...');
        console.log('Request parts count:', parts.length);

        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Gemini API error:', errorText);
            return res.status(response.status).json({ 
                error: 'Gemini API error', 
                details: errorText 
            });
        }

        const data = await response.json();
        console.log('Gemini API response received');

        // Extract images from response
        const images: string[] = [];
        let textResponse = '';

        if (data.candidates && data.candidates[0]?.content?.parts) {
            for (const part of data.candidates[0].content.parts) {
                if (part.inlineData?.data) {
                    // Convert base64 to data URL
                    const mimeType = part.inlineData.mimeType || 'image/png';
                    const dataUrl = `data:${mimeType};base64,${part.inlineData.data}`;
                    images.push(dataUrl);
                    console.log('Extracted image from response');
                } else if (part.text) {
                    textResponse += part.text;
                }
            }
        }

        console.log('Total images generated:', images.length);
        console.log('Text response length:', textResponse.length);

        return res.status(200).json({
            success: true,
            images: images,
            text: textResponse,
            count: images.length
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