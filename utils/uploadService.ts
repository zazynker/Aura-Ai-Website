// utils/uploadService.ts
import { supabase } from './supabase';

export interface UploadResult {
  success: boolean;
  url?: string;
  path?: string;
  error?: string;
}

// ============================================
// 图片压缩配置
// ============================================
const COMPRESSION_CONFIG = {
  // 超过这个大小就压缩 (2MB)
  THRESHOLD_BYTES: 2 * 1024 * 1024,
  // 压缩目标大小 (1MB)
  TARGET_BYTES: 1 * 1024 * 1024,
  // 初始质量
  INITIAL_QUALITY: 0.8,
  // 最低质量（不会低于这个值）
  MIN_QUALITY: 0.5,
  // 最大尺寸（宽或高不超过这个值）
  MAX_DIMENSION: 2048,
};

/**
 * 压缩图片
 * @param file 原始文件
 * @returns 压缩后的 Blob，如果不需要压缩则返回原文件
 */
export async function compressImage(file: File): Promise<Blob> {
  // 如果文件小于阈值，不需要压缩
  if (file.size <= COMPRESSION_CONFIG.THRESHOLD_BYTES) {
    console.log(`[Compress] File ${file.name} is ${(file.size / 1024 / 1024).toFixed(2)}MB, no compression needed`);
    return file;
  }

  console.log(`[Compress] Starting compression for ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    img.onload = () => {
      // 计算新尺寸（保持比例，限制最大尺寸）
      let { width, height } = img;
      const maxDim = COMPRESSION_CONFIG.MAX_DIMENSION;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        console.log(`[Compress] Resized to ${width}x${height}`);
      }

      canvas.width = width;
      canvas.height = height;

      // 绘制图片
      ctx.drawImage(img, 0, 0, width, height);

      // 尝试不同质量级别压缩
      const tryCompress = (quality: number): void => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }

            console.log(`[Compress] Quality ${(quality * 100).toFixed(0)}% -> ${(blob.size / 1024 / 1024).toFixed(2)}MB`);

            // 如果还是太大且质量还能降低，继续压缩
            if (blob.size > COMPRESSION_CONFIG.TARGET_BYTES && quality > COMPRESSION_CONFIG.MIN_QUALITY) {
              tryCompress(quality - 0.1);
            } else {
              console.log(`[Compress] Final size: ${(blob.size / 1024 / 1024).toFixed(2)}MB (was ${(file.size / 1024 / 1024).toFixed(2)}MB)`);
              resolve(blob);
            }
          },
          'image/jpeg', // 压缩后统一用 JPEG
          quality
        );
      };

      tryCompress(COMPRESSION_CONFIG.INITIAL_QUALITY);
    };

    img.onerror = () => {
      reject(new Error('Failed to load image for compression'));
    };

    // 从 File 创建 URL
    img.src = URL.createObjectURL(file);
  });
}

/**
 * 验证文件（类型和大小）
 */
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
 * 上传用户图片到 Supabase Storage（带自动压缩）
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

    // 3. 自动压缩（如果超过 2MB）
    let fileToUpload: Blob = file;
    let finalMimeType = file.type;
    
    if (file.size > COMPRESSION_CONFIG.THRESHOLD_BYTES) {
      console.log('[Upload] File exceeds 2MB, compressing...');
      try {
        fileToUpload = await compressImage(file);
        finalMimeType = 'image/jpeg'; // 压缩后统一用 JPEG
        console.log(`[Upload] Compression complete: ${(file.size / 1024 / 1024).toFixed(2)}MB -> ${(fileToUpload.size / 1024 / 1024).toFixed(2)}MB`);
      } catch (compressError) {
        console.error('[Upload] Compression failed, using original file:', compressError);
        // 压缩失败就用原文件
      }
    }

    // 4. 生成唯一文件名
    const fileExt = finalMimeType === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop()?.toLowerCase() || 'jpg');
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 11);
    const fileName = `${timestamp}_${randomStr}.${fileExt}`;
    const filePath = `${userId}/${fileName}`;

    // 5. 上传到 Supabase Storage
    const { data, error } = await supabase.storage
      .from('user-uploads')
      .upload(filePath, fileToUpload, {
        contentType: finalMimeType,
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

    // 6. 获取签名URL（私有bucket需要签名URL）
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