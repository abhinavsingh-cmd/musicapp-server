import { useState, useEffect, useRef, ImgHTMLAttributes, memo } from 'react';
import { getCachedImageUrl } from '../utils/downloadManager';
import { Music } from 'lucide-react';

interface CachedImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string;
  fallbackSrc?: string;
}

const CachedImage = memo(function CachedImage({ src, fallbackSrc = '', alt, width, height, className, style, ...rest }: CachedImageProps) {
  const [resolved, setResolved] = useState<string>('');
  const [errored, setErrored] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setErrored(false);
    if (!src) {
      setResolved(fallbackSrc);
      return;
    }

    let active = true;
    getCachedImageUrl(src).then(url => {
      if (active && !cancelledRef.current) {
        setResolved(url || fallbackSrc);
      }
    });

    return () => {
      active = false;
      cancelledRef.current = true;
    };
  }, [src, fallbackSrc]);

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

  if (errored || (!resolved && !src)) {
    return (
      <div className={className} style={fallbackStyle}>
        <Music size={16} className="text-gray-600" />
      </div>
    );
  }

  if (!resolved) {
    return <div className={className} style={fallbackStyle} />;
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
