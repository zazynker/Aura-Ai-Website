import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface MediaLightboxProps {
  url: string | null;
  type: 'image' | 'video';
  alt?: string;
  onClose: () => void;
}

export const MediaLightbox: React.FC<MediaLightboxProps> = ({
  url,
  type,
  alt = 'Media preview',
  onClose,
}) => {
  useEffect(() => {
    if (!url) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [url, onClose]);

  if (!url) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 rounded-full bg-white/15 p-2 text-white transition-colors hover:bg-white/25"
        aria-label="Close preview"
        title="Close preview"
      >
        <X className="h-6 w-6" />
      </button>

      <div
        className="flex max-h-[90vh] max-w-[94vw] items-center justify-center overflow-hidden rounded-2xl bg-black shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {type === 'video' ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            preload="metadata"
            className="max-h-[90vh] max-w-[94vw] object-contain"
          />
        ) : (
          <img
            src={url}
            alt={alt}
            className="max-h-[90vh] max-w-[94vw] object-contain"
          />
        )}
      </div>
    </div>
  );
};
