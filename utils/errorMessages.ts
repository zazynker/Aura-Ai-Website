// utils/errorMessages.ts

/**
 * User-friendly error messages for common error codes
 */
export const ERROR_MESSAGES: Record<number | string, string> = {
    // HTTP 状态码
    400: 'Invalid request. Please check your inputs and try again.',
    401: 'Please log in to continue.',
    403: 'You don\'t have permission to do this.',
    404: 'The requested resource was not found.',
    413: 'File too large. Please use files under 10MB.',
    429: 'Too many requests. Please wait a moment and try again.',
    500: 'Something went wrong on our end. Please try again.',
    502: 'Service temporarily unavailable. Please try again.',
    503: 'Service is busy. Please try again in a moment.',
    
    // 自定义错误码
    NETWORK_ERROR: 'Network error. Please check your internet connection.',
    GENERATION_FAILED: 'Image generation failed. Please try a different prompt.',
    UPLOAD_FAILED: 'Failed to upload file. Please try again.',
    AUTH_REQUIRED: 'Please log in to continue.',
    INVALID_TOKEN: 'Your session has expired. Please log in again.',
    RATE_LIMITED: 'You\'re generating too fast. Please wait a moment.',
    PRO_REQUIRED: '4K resolution is available for Pro users only.',
    INVALID_INPUT: 'Invalid input. Please check your request.',
    UNKNOWN: 'Something went wrong. Please try again.',
  };
  
  /**
   * Get a user-friendly error message from an error object or status code
   */
  export function getFriendlyMessage(error: unknown): string {
    // Handle HTTP status codes
    if (typeof error === 'number') {
      return ERROR_MESSAGES[error] || ERROR_MESSAGES.UNKNOWN;
    }
    
    // Handle error objects with code property
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      if (ERROR_MESSAGES[code]) {
        return ERROR_MESSAGES[code];
      }
    }
    
    // Handle Error instances
    if (error instanceof Error) {
      // Network errors
      if (error.message.includes('fetch') || error.message.includes('network')) {
        return ERROR_MESSAGES.NETWORK_ERROR;
      }
      // Return the error message if it's user-friendly (not too technical)
      if (error.message.length < 100 && !error.message.includes('Error:')) {
        return error.message;
      }
    }
    
    // Handle string errors
    if (typeof error === 'string') {
      if (error.length < 100) {
        return error;
      }
    }
    
    return ERROR_MESSAGES.UNKNOWN;
  }
  
  /**
   * Check if an error is a network error
   */
  export function isNetworkError(error: unknown): boolean {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return true;
    }
    if (error instanceof Error && error.message.includes('network')) {
      return true;
    }
    return false;
  }