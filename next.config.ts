import type { NextConfig } from "next";

// Static export so the game can be served by any static host (Cloudflare Pages,
// Netlify, S3, …). The game is entirely client-side (Leaflet + the local flight
// sim), so it runs as static files. PAGES_BASE_PATH is only needed when serving
// under a subpath; Cloudflare Pages serves at the root, so it's normally empty.
const base = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: base || undefined,
  assetPrefix: base || undefined,
  images: { unoptimized: true },
};

export default nextConfig;
