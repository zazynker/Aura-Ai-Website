// utils/uploadService.ts
import { supabase } from './supabase';

export interface UploadResult {
  success: boolean;
  url?: string;
  path?: string;
  error?: string;
}
export function validateFile(file: File): { message: string; code?: string } | null {
  const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (!validTypes.includes(file.type)) {
    return { 
      message: 'Please upload PNG, JPG, or WebP images only',
      code: 'INVALID_TYPE'
    };
  }

  if (file.size > maxSize) {
    return { 
      message: 'File must be less than 10MB',
      code: 'FILE_TOO_LARGE'
    };
  }

  return null;
}
/**
 * 上传用户图片到 Supabase Storage
 */
export async function uploadUserImage(
  userId: string,
  file: File
): Promise<UploadResult> {
  try {
    // 1. 验证文件类型
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return {
        success: false,
        error: 'Invalid file type. Please upload PNG, JPG, or WebP.',
      };
    }

    // 2. 验证文件大小 (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return {
        success: false,
        error: 'File too large. Maximum size is 10MB.',
      };
    }

    // 3. 生成唯一文件名
    const fileExt = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 11);
    const fileName = `${timestamp}_${randomStr}.${fileExt}`;
    const filePath = `${userId}/${fileName}`;

    // 4. 上传到 Supabase Storage
    const { data, error } = await supabase.storage
      .from('user-uploads')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      console.error('Upload error:', error);
      return {
        success: false,
        error: error.message || 'Upload failed. Please try again.',
      };
    }

    // 5. 获取签名URL（私有bucket需要签名URL）
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('user-uploads')
      .createSignedUrl(filePath, 60 * 60 * 24 * 7); // 7天有效期

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error('Signed URL error:', signedUrlError);
      return {
        success: false,
        error: 'Failed to get image URL.',
      };
    }

    return {
      success: true,
      url: signedUrlData.signedUrl,
      path: filePath,
    };
  } catch (err) {
    console.error('Unexpected upload error:', err);
    return {
      success: false,
      error: 'An unexpected error occurred.',
    };
  }
}

/**
 * 删除用户上传的图片
 */
export async function deleteUserImage(filePath: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage
      .from('user-uploads')
      .remove([filePath]);
    return !error;
  } catch {
    return false;
  }
}