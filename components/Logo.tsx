// The Stabl mark: a green rounded square with a white pulse line. Drawn as SVG
// from the existing icon so it stays sharp at every size, and paired with the
// wordmark in Lora italic, which follows the theme's text color.
export function PulseMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <rect width="100" height="100" rx="22" fill="#1F5138" />
      <polyline
        points="28,53 36,35 43.5,64 52,45 57.5,51 73,50"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <PulseMark className={size === "lg" ? "size-10" : "size-7"} />
      <span className={`font-italic ${size === "lg" ? "text-[2rem]" : "text-[1.5rem]"} leading-none text-text`}>Stabl</span>
    </span>
  );
}
