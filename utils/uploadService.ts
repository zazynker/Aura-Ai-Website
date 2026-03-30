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
/**
 * 将 base64 图片上传到 Supabase Storage (generations bucket)
 * @param base64Data - base64 图片数据 (可以带或不带 data:image/... 前缀)
 * @param userId - 用户ID，用于组织文件路径
 * @returns 上传后的公开 URL，失败返回 null
 */
export async function uploadBase64Image(
  base64Data: string,
  userId: string
): Promise<{ url: string | null; error: string | null }> {
  try {
    console.log('=== uploadBase64Image called ===');
    
    // 移除 data:image/xxx;base64, 前缀（如果有）
    let base64Content = base64Data;
    let mimeType = 'image/png'; // 默认
    
    if (base64Data.startsWith('data:')) {
      const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Content = matches[2];
      }
    }
    
    // 确定文件扩展名
    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const ext = extMap[mimeType] || 'png';
    
    // 生成唯一文件名
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const fileName = `${userId}/${timestamp}_${randomStr}.${ext}`;
    
    console.log('Uploading to:', fileName);
    console.log('MIME type:', mimeType);
    
    // 将 base64 转换为 Blob
    const byteCharacters = atob(base64Content);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    
    console.log('Blob size:', blob.size, 'bytes');
    
    // 上传到 Supabase Storage (generations bucket)
    const { data, error } = await supabase.storage
      .from('generations')
      .upload(fileName, blob, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false,
      });
    
    if (error) {
      console.error('=== Upload ERROR ===', error);
      return { url: null, error: error.message };
    }
    
    console.log('Upload success:', data);
    
    // 获取公开 URL
    const { data: urlData } = supabase.storage
      .from('generations')
      .getPublicUrl(fileName);
    
    console.log('Public URL:', urlData.publicUrl);
    
    return { url: urlData.publicUrl, error: null };
  } catch (err) {
    console.error('Upload exception:', err);
    return { url: null, error: err instanceof Error ? err.message : 'Upload failed' };
  }
}

/**
 * 批量上传 base64 图片
 */
export async function uploadBase64Images(
  base64Images: string[],
  userId: string
): Promise<{ urls: string[]; errors: string[] }> {
  console.log('=== uploadBase64Images called ===');
  console.log('Number of images:', base64Images.length);
  
  const results = await Promise.all(
    base64Images.map(img => uploadBase64Image(img, userId))
  );
  
  const urls: string[] = [];
  const errors: string[] = [];
  
  results.forEach((result, index) => {
    if (result.url) {
      urls.push(result.url);
    } else {
      errors.push(`Image ${index + 1}: ${result.error}`);
    }
  });
  
  console.log('Uploaded successfully:', urls.length);
  console.log('Failed:', errors.length);
  
  return { urls, errors };
}