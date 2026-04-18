// utils/generateService.ts

import { supabase } from './supabase';

export interface GenerateOptions {
  prompt: string;
  imageUrl?: string;        // Base/scene image (e.g., model photo)
  productImageUrl?: string; // Product image to replace/insert
  numberOfImages?: number;
  imageSize?: '512' | '1K' | '2K' | '4K';  // Output resolution
  aspectRatio?: string;     // e.g., "1:1", "16:9", "9:16"
  templateId?: string;      // For Pro template check
}

export interface GenerateResult {
  success: boolean;
  images?: string[];
  text?: string;
  error?: string;
  errorCode?: number;
  imageSize?: string;
  tokensUsed?: number;
  creditsUsed?: number;
  newCredits?: number;      // New balance after deduction
}

// Friendly error messages with error codes
const ERROR_MESSAGES: Record<number, string> = {
  400: 'Invalid request. Please check your inputs and try again. [E400]',
  401: 'Please login to generate images. [E401]',
  402: 'Insufficient credits. Please purchase more credits. [E402]',
  403: 'Access denied. This feature requires a Pro subscription. [E403]',
  413: 'Image too large. Please use images under 10MB each. [E413]',
  429: 'Server busy. Please wait a moment and try again. [E429]',
  500: 'Server error. Please try again in a few moments. [E500]',
  502: 'Service temporarily unavailable. Please try again. [E502]',
  503: 'Service is busy. Please try again in a few moments. [E503]',
};

/**
 * Generate images using the Gemini API via our serverless function
 */
export async function generateImages(options: GenerateOptions): Promise<GenerateResult> {
  const { 
    prompt, 
    imageUrl, 
    productImageUrl, 
    numberOfImages = 1,
    imageSize = '1K',
    aspectRatio,
    templateId
  } = options;

  console.log('=== generateImages called ===');
  console.log('Prompt:', prompt.substring(0, 100) + '...');
  console.log('Has base image:', !!imageUrl);
  console.log('Has product image:', !!productImageUrl);
  console.log('Image size:', imageSize);

  try {
    // 获取当前用户的 session token
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.access_token) {
      return {
        success: false,
        error: 'Please login to generate images. [E401]',
        errorCode: 401
      };
    }

    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,  // 添加认证
      },
      body: JSON.stringify({
        prompt,
        imageUrl,
        productImageUrl,
        numberOfImages,
        imageSize,
        aspectRatio,
        templateId,
      }),
    });

    // Handle non-OK responses
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('API error:', response.status, errorData);
      
      // Get friendly error message
      const friendlyMessage = ERROR_MESSAGES[response.status] || 
        errorData.error || 
        `Generation failed (Error ${response.status}). [E${response.status}]`;

      return {
        success: false,
        error: friendlyMessage,
        errorCode: response.status,
      };
    }

    // Parse successful response
    const data = await response.json();
    
    console.log('=== Generation successful ===');
    console.log('Images received:', data.images?.length || 0);
    console.log('Tokens used:', data.tokensUsed);
    console.log('Credits used:', data.creditsUsed);
    console.log('New credits balance:', data.newCredits);

    return {
      success: true,
      images: data.images || [],
      text: data.text,
      imageSize: data.imageSize,
      tokensUsed: data.tokensUsed || 0,
      creditsUsed: data.creditsUsed || 0,
      newCredits: data.newCredits,
    };

  } catch (err) {
    console.error('Network or parsing error:', err);
    
    // Check for network errors
    if (err instanceof TypeError && err.message.includes('fetch')) {
      return {
        success: false,
        error: 'Network error. Please check your connection and try again. [E000]',
        errorCode: 0
      };
    }

    return {
      success: false,
      error: 'An unexpected error occurred. Please try again. [E999]',
      errorCode: 999
    };
  }
}