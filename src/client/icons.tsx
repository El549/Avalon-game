import type { SVGProps } from "react";

export function RoundTableMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      <circle cx="32" cy="32" r="24" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="32" r="15" stroke="currentColor" strokeWidth="1.5" opacity=".65" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <path key={angle} d="M32 5v9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" transform={`rotate(${angle} 32 32)`} />
      ))}
      <circle cx="32" cy="32" r="3" fill="currentColor" />
    </svg>
  );
}

export function CrownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="m3 8 4 3 5-7 5 7 4-3-2 10H5L3 8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M5 21h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function SwordIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="m14 4 6-2-2 6L8 18l-2-2L16 6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m5 15 4 4M4 20l2-2M8 22l2-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function BrokenCrownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="m3 8 4 3 3-5 2 5 2-4 3 4 4-3-2 10H5L3 8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M5 21h14M12 3v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function FingerprintIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <path d="M7 15a9 9 0 0 1 18 0c0 7-2 11-5 14M11 28c2-4 2-7 2-13a3 3 0 0 1 6 0c0 5 0 8-2 12M5 22c1-2 1-4 1-7M26 23c1-3 1-5 1-8M10 8a8 8 0 0 1 12 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M2.8 12s3.3-6 9.2-6 9.2 6 9.2 6-3.3 6-9.2 6-9.2-6-9.2-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
