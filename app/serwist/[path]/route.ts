import { createSerwistRoute } from "@serwist/turbopack";

// Serves the service worker at /serwist/sw.js (Serwist's Turbopack route).
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now());

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  useNativeEsbuild: true,
  additionalPrecacheEntries: [
    { url: "/replay", revision },
    { url: "/offline", revision },
  ],
});
