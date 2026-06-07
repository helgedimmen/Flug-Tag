import type { NextConfig } from "next";

// When building for GitHub Pages we emit a fully static site under `out/`.
// The game is entirely client-side (Leaflet + the local flight sim), so it runs
// happily as static files. A project Pages site is served from a sub-path
// (https://<user>.github.io/Flug-Tag/), so set basePath/assetPrefix to match.
const isPages = process.env.GITHUB_PAGES === "true";
const repo = "Flug-Tag";

const nextConfig: NextConfig = isPages
  ? {
      output: "export",
      basePath: `/${repo}`,
      assetPrefix: `/${repo}/`,
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {};

export default nextConfig;
