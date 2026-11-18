// The logos of the social platforms a Source can come from (`public/platforms/`).
// They are not Publisher logos (those ship in a Publisher's package), and
// lucide has no brand icons. Plain images: each SVG keeps its own colours and
// its own ids, so two of them never clash on a page.

function PlatformImage({ src, className }: { src: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" aria-hidden="true" className={`${className} shrink-0 object-contain`} />;
}

export function InstagramLogo({ className = "size-4" }: { className?: string }) {
  return <PlatformImage src="/platforms/instagram.svg" className={className} />;
}

export function TikTokLogo({ className = "size-4" }: { className?: string }) {
  return <PlatformImage src="/platforms/tiktok.svg" className={className} />;
}
