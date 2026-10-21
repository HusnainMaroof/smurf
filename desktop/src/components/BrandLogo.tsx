import { LegacyIcon } from './ui/LegacyIcon';

import { smurfMarkUrl } from '../assets/brand';

/** Inline Smurf mark: white "S" monogram on a blue rounded square. */
export function SmurfMark({ className = 'w-8 h-8', title = 'Smurf' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <linearGradient id="smurf-mark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2F6BFF" />
          <stop offset="1" stopColor="#1A3FB8" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#smurf-mark-bg)" />
      <path
        transform="translate(0 -16)"
        d="M338 176c-16-26-46-42-84-42c-50 0-86 27-86 66c0 40 34 56 88 68c56 12 92 28 92 72c0 42-38 70-92 70c-44 0-78-18-94-48"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="54"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type BrandLogoProps = {
  src?: string | null;
  alt: string;
  className?: string;
  imgClassName?: string;
  fallbackIcon?: string;
  rounded?: 'full' | 'lg' | 'none';
};

const ROUNDED_CLASS = {
  full: 'rounded-full',
  lg: 'rounded-lg',
  none: '',
} as const;

export function BrandLogo({
  src,
  alt,
  className = 'w-9 h-9 flex items-center justify-center flex-shrink-0 bg-surface-container',
  imgClassName = 'w-[70%] h-[70%] object-contain',
  fallbackIcon = 'smart_toy',
  rounded = 'full',
}: BrandLogoProps) {
  const roundedClass = ROUNDED_CLASS[rounded];
  const isSmurfMark = src === smurfMarkUrl;
  if (src) {
    return (
      <div className={`${className} overflow-hidden ${roundedClass} flex items-center justify-center`}>
        <img
          src={src}
          alt={alt || (isSmurfMark ? 'Smurf' : '')}
          className={isSmurfMark ? 'w-full h-full object-cover block' : `${imgClassName} block`}
        />
      </div>
    );
  }
  return (
    <div className={`${className} ${roundedClass} flex items-center justify-center`}>
      <LegacyIcon name={fallbackIcon} className="text-[18px] text-on-surface-variant" />
    </div>
  );
}
