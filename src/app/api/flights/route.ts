import { fetchLiveAircraft, openSkyConfigured } from "@/lib/opensky";

// Live-data endpoint. The game runs on the in-browser simulation by default, so
// this only does real work once OpenSky credentials are set (see
// src/lib/opensky.ts). Without them it returns `{ source: "none" }`.
//
// Declared `force-static` so the app can also be exported as a fully static site
// (GitHub Pages) — in that mode this is baked at build time using the default
// mainland-Norway bounding box.
export const dynamic = "force-static";

// Default bbox: mainland Norway.
const NORWAY = { lamin: 57.5, lomin: 4.0, lamax: 71.5, lomax: 31.5 };

export async function GET() {
  if (!openSkyConfigured()) {
    return Response.json({
      source: "none",
      reason: "OpenSky credentials not configured; using local simulation.",
      aircraft: [],
    });
  }
  try {
    const aircraft = await fetchLiveAircraft(NORWAY);
    return Response.json({ source: "opensky", aircraft });
  } catch (err) {
    return Response.json(
      { source: "error", reason: String(err), aircraft: [] },
      { status: 502 },
    );
  }
}
