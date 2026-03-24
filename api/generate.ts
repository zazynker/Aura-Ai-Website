import type { VercelRequest, VercelResponse } from '@vercel/node';

// Gemini API endpoint
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent';

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
    const { prompt, imageUrl, numberOfImages = 1 } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log('=== Generate API called ===');
    console.log('Prompt:', prompt.substring(0, 100) + '...');
    console.log('Has input image:', !!imageUrl);
    console.log('Number of images:', numberOfImages);

    // Build the request content
    const parts: any[] = [];

    // If there's an input image, add it first
    if (imageUrl) {
      // Fetch the image and convert to base64
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        return res.status(400).json({ error: 'Failed to fetch input image' });
      }
      
      const imageBuffer = await imageResponse.arrayBuffer();
      const base64Image = Buffer.from(imageBuffer).toString('base64');
      
      // Determine mime type from URL or default to jpeg
      let mimeType = 'image/jpeg';
      if (imageUrl.includes('.png')) mimeType = 'image/png';
      if (imageUrl.includes('.webp')) mimeType = 'image/webp';
      
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Image
        }
      });
    }

    // Add the text prompt
    parts.push({ text: prompt });

    // Call Gemini API
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: parts
        }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE']
        }
      })
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return res.status(geminiResponse.status).json({ 
        error: 'Gemini API error', 
        details: errorText 
      });
    }

    const geminiData = await geminiResponse.json();
    console.log('Gemini response received');

    // Extract generated images from response
    const generatedImages: string[] = [];
    const responseText: string[] = [];

    if (geminiData.candidates && geminiData.candidates[0]?.content?.parts) {
      for (const part of geminiData.candidates[0].content.parts) {
        if (part.text) {
          responseText.push(part.text);
        }
        if (part.inlineData) {
          // Convert base64 to data URL
          const dataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          generatedImages.push(dataUrl);
        }
      }
    }

    if (generatedImages.length === 0) {
      console.error('No images generated. Response:', JSON.stringify(geminiData).substring(0, 500));
      return res.status(500).json({ 
        error: 'No images generated',
        responseText: responseText.join('\n'),
        rawResponse: geminiData
      });
    }

    console.log(`Generated ${generatedImages.length} image(s)`);

    return res.status(200).json({
      success: true,
      images: generatedImages,
      text: responseText.join('\n'),
      count: generatedImages.length
    });

  } catch (error) {
    console.error('Generate API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}