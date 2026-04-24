// utils/generateService.ts

import { supabase } from './supabase';

export interface GenerateOptions {
  prompt: string;
  imageUrl?: string;        // Base/scene image (e.g., model photo)
  productImageUrl?: string; // Product image to replace/insert
  numberOfImages?: number;
  imageSize?: '512' | '1K' | '2K' | '4K';  // Output resolution
  aspectRatio?: string;     // e.g., "1:1", "16:9", "9:16"
}

export interface GenerateResult {
  success: boolean;
  images?: string[];
  text?: string;
  error?: string;
  imageSize?: string;
  tokensUsed?: number;  // Total tokens consumed by this generation
  newCredits?: number;  // User's new credit balance after deduction (optional)
}

// Friendly error messages
const ERROR_MESSAGES: Record<number, string> = {
  413: 'Image too large. Please use images under 10MB each, or try compressing them first.',
  400: 'Invalid request. Please check your inputs and try again.',
  401: 'Please log in to generate images.',
  403: '4K resolution is available for Pro users only. Upgrade to unlock.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'Server error. Please try again in a few moments.',
  502: 'Service temporarily unavailable. Please try again.',
  503: 'Service is busy. Please try again in a few moments.',
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
    aspectRatio
  } = options;

  console.log('=== generateImages called ===');
  console.log('Prompt:', prompt.substring(0, 100) + '...');
  console.log('Has base image:', !!imageUrl);
  console.log('Has product image:', !!productImageUrl);
  console.log('Image size:', imageSize);

  try {
    // Get current session for auth token
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.access_token) {
      return {
        success: false,
        error: 'Please log in to generate images.',
      };
    }

    console.log('User ID for generation:', session.user.id);

    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        prompt,
        imageUrl,
        productImageUrl,
        numberOfImages,
        imageSize,
        aspectRatio,
        // userId no longer needed - backend extracts from JWT
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('API error:', response.status, errorData);
      
      // Use server error message if available, otherwise use friendly default
      const friendlyMessage = errorData.error || 
        ERROR_MESSAGES[response.status] || 
        `Generation failed (Error ${response.status}). Please try again.`;
      
      return {
        success: false,
        error: friendlyMessage,
      };
    }

    const data = await response.json();
    console.log('API response:', { 
      success: data.success, 
      imageCount: data.images?.length, 
      imageSize: data.imageSize,
      tokensUsed: data.tokensUsed 
    });

    if (!data.success) {
      return {
        success: false,
        error: data.error || 'Generation failed',
        tokensUsed: data.tokensUsed || 0,
      };
    }

    return {
      success: true,
      images: data.images || [],
      text: data.text || '',
      imageSize: data.imageSize,
      tokensUsed: data.tokensUsed || 0,
    };
  } catch (err) {
    console.error('Generate exception:', err);
    
    // Check for network errors
    if (err instanceof TypeError && err.message.includes('fetch')) {
      return {
        success: false,
        error: 'Network error. Please check your internet connection and try again.',
      };
    }
    
    return {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.',
    };
  }
}