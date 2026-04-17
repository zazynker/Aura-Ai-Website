// utils/generateService.ts

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
  errorCode?: number;  // 新增：错误码
  imageSize?: string;
  tokensUsed?: number;  // Total tokens consumed by this generation
}

// Friendly error messages with error codes for debugging
const ERROR_MESSAGES: Record<number, string> = {
  413: 'Image too large. Please use smaller images (under 10MB). [E413]',
  400: 'Invalid request. Please check your inputs. [E400]',
  401: 'Authentication error. Please refresh the page. [E401]',
  403: 'Access denied. You may have exceeded your limit. [E403]',
  429: 'Server is busy right now. Please wait 30 seconds and try again. [E429]',
  500: 'Server error. Please try again in a moment. [E500]',
  502: 'Service temporarily unavailable. Please try again. [E502]',
  503: 'Service is busy. Please try again shortly. [E503]',
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
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        imageUrl,
        productImageUrl,
        numberOfImages,
        imageSize,
        aspectRatio,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('API error:', response.status, errorData);
      
      // Get friendly error message with error code
      const friendlyMessage = ERROR_MESSAGES[response.status] || 
        errorData.error || 
        `Generation failed. Please try again. [E${response.status}]`;
      
      return {
        success: false,
        error: friendlyMessage,
        errorCode: response.status,
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
      // 检查后端是否返回了特定错误码
      const errorCode = data.errorCode || 500;
      const errorMsg = data.error || 'Generation failed';
      
      // 如果后端已经包含错误码，直接使用；否则添加
      const hasErrorCode = /\[E\d+\]/.test(errorMsg);
      const finalError = hasErrorCode ? errorMsg : `${errorMsg} [E${errorCode}]`;
      
      return {
        success: false,
        error: finalError,
        errorCode: errorCode,
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
        error: 'Network error. Please check your internet connection. [E000]',
        errorCode: 0,
      };
    }
    
    return {
      success: false,
      error: err instanceof Error 
        ? `${err.message} [E999]` 
        : 'An unexpected error occurred. Please try again. [E999]',
      errorCode: 999,
    };
  }
}