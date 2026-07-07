export interface VideoResult {
  id: string;
  type: string;
  model: string;
  resolution: string;
  prompt: string;
  duration: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  timestamp: string;
  bgColor: string;
  videoUrl?: string;
  sourceImage?: string;
}

export const generateFakeVideo = async (imageUrl: string, durationSeconds: number): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width || 640;
      canvas.height = img.height || 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve('');
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks: BlobPart[] = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve(URL.createObjectURL(blob));
      };
      
      recorder.start();
      
      const drawInterval = setInterval(() => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }, 1000 / 30);
      
      setTimeout(() => {
        clearInterval(drawInterval);
        recorder.stop();
      }, 2500); // fixed 2.5s loading time
    };
    img.onerror = () => resolve('');
    img.src = imageUrl;
  });
};
