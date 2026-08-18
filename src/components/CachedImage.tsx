import { useState, useEffect, useRef, ImgHTMLAttributes, memo } from 'react';
import { getCachedImageUrl } from '../utils/downloadManager';
import { Music } from 'lucide-react';

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Synthesize a YouTube thumbnail URL from a video id.
 * Returns the url when the id is valid, empty string otherwise.
 */
function ytThumbnail(youtubeId?: string | null): string {
  if (youtubeId && YT_ID_RE.test(youtubeId)) {
    return `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`;
  }
  return '';
}

interface CachedImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string;
  fallbackSrc?: string;
  /** YouTube video id — used to synthesize a thumbnail when src is empty. */
  youtubeId?: string | null;
}

const CachedImage = memo(function CachedImage({ src, fallbackSrc = '', youtubeId, alt, width, height, className, style, ...rest }: CachedImageProps) {
  // Resolve the effective source: prefer the explicit src, fall back to a
  // synthesized YouTube thumbnail, then to the caller-provided fallbackSrc.
  const effectiveSrc = src || ytThumbnail(youtubeId) || fallbackSrc;
  const [resolved, setResolved] = useState<string>('');
  const [errored, setErrored] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setErrored(false);
    if (!effectiveSrc) {
      setResolved('');
      return;
    }

    let active = true;
    getCachedImageUrl(effectiveSrc).then(url => {
      if (active && !cancelledRef.current) {
        setResolved(url || effectiveSrc);
      }
    });

    return () => {
      active = false;
      cancelledRef.current = true;
    };
  }, [effectiveSrc]);

  const fallbackStyle: React.CSSProperties = {
    background: 'var(--color-surface, #1a1a2e)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: width || undefined,
    height: height || undefined,
    ...((style as React.CSSProperties) || {}),
  };

  if (errored || !resolved) {
    return (
      <div className={className} style={fallbackStyle}>
        <Music size={16} className="text-gray-600" />
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt || ''}
      loading="lazy"
      decoding="async"
      width={width}
      height={height}
      className={className}
      style={style}
      onError={() => setErrored(true)}
      {...rest}
    />
  );
});

export default CachedImage;
