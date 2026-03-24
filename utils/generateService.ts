// utils/generateService.ts
// Service for calling the image generation API

export interface GenerateRequest {
    prompt: string;
    imageUrl?: string;  // Optional: input image for editing
    numberOfImages?: number;
  }
  
  export interface GenerateResponse {
    success: boolean;
    images?: string[];  // Array of generated image data URLs
    text?: string;      // Any text response from the model
    count?: number;
    error?: string;
    message?: string;
  }
  
  /**
   * Call the image generation API
   */
  export async function generateImages(request: GenerateRequest): Promise<GenerateResponse> {
    console.log('=== generateImages called ===');
    console.log('Prompt:', request.prompt.substring(0, 100) + '...');
    console.log('Has input image:', !!request.imageUrl);
  
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: request.prompt,
          imageUrl: request.imageUrl,
          numberOfImages: request.numberOfImages || 1,
        }),
      });
  
      const data = await response.json();
  
      if (!response.ok) {
        console.error('Generate API error:', data);
        return {
          success: false,
          error: data.error || 'Generation failed',
          message: data.message || data.details,
        };
      }
  
      console.log('Generate API success:', data.count, 'image(s)');
      return data;
  
    } catch (error) {
      console.error('Generate API exception:', error);
      return {
        success: false,
        error: 'Network error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Upload a generated image to Supabase Storage and get a permanent URL
   * (This will be implemented in task 5.3)
   */
  export async function saveGeneratedImage(
    userId: string,
    dataUrl: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    // TODO: Implement in task 5.3
    // For now, just return the data URL
    return {
      success: true,
      url: dataUrl,
    };
  }