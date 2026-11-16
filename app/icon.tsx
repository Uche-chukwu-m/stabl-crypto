import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <svg viewBox="0 0 100 100" width="64" height="64">
        <rect width="100" height="100" rx="22" fill="#1F5138" />
        <polyline points="28,53 36,35 43.5,64 52,45 57.5,51 73,50" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    size,
  );
}
