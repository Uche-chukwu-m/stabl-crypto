import { ImageResponse } from "next/og";

// PWA icons, drawn from the same SVG as the in app mark. "maskable" leaves the
// safe zone Android needs by filling the bleed with brand green.
const SIZES = { "192": 192, "512": 512, maskable: 512 } as const;

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = SIZES[size as keyof typeof SIZES];
  if (!px) return new Response(null, { status: 404 });
  const maskable = size === "maskable";
  return new ImageResponse(
    (
      <div style={{ width: px, height: px, display: "flex", background: maskable ? "#1F5138" : "transparent" }}>
        <svg viewBox={maskable ? "-20 -20 140 140" : "0 0 100 100"} width={px} height={px}>
          <rect width="100" height="100" rx={maskable ? 0 : 22} fill="#1F5138" />
          <polyline
            points="28,53 36,35 43.5,64 52,45 57.5,51 73,50"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { width: px, height: px },
  );
}
