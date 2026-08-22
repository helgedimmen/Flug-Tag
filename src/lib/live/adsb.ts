import type { VesselFix } from "../types";

// LIVE aircraft: the community ADS-B aggregators. All three expose the same
// readsb "reapi" JSON shape, are free, keyless, and answer browser requests
// (CORS) — which is what lets a static GitHub Pages site use them directly.
// We try them in order and stick with the first one that answers, so a single
// aggregator having a bad day doesn't take the game down.
//
//   docs: https://api.adsb.lol/docs · https://airplanes.live/api-guide/
//         https://github.com/adsbfi/opendata

export interface AdsbSource {
  name: string;
  /** radius is in NAUTICAL MILES (the reapi convention), max 250. */
  url: (lat: number, lon: number, radiusNm: number) => string;
}

export const ADSB_SOURCES: AdsbSource[] = [
  {
    name: "adsb.lol",
    url: (lat, lon, r) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${r}`,
  },
  {
    name: "adsb.fi",
    url: (lat, lon, r) =>
      `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${r}`,
  },
  {
    name: "airplanes.live",
    url: (lat, lon, r) =>
      `https://api.airplanes.live/v2/point/${lat}/${lon}/${r}`,
  },
];

/** One aircraft entry as the reapi endpoints return it (fields we read). */
interface ReapiAircraft {
  hex?: string;
  flight?: string;
  r?: string; // registration — fallback display name
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number; // knots
  track?: number;
  true_heading?: number;
  mag_heading?: number;
}

const FT_TO_M = 0.3048;
const KT_TO_KMH = 1.852;

/**
 * Normalise a reapi response (`{ ac: [...] }`) into VesselFixes.
 * Entries without a usable position are dropped.
 */
export function normalizeAdsb(json: unknown): VesselFix[] {
  const ac = (json as { ac?: ReapiAircraft[] } | null)?.ac;
  if (!Array.isArray(ac)) return [];

  const fixes: VesselFix[] = [];
  for (const a of ac) {
    const lat = Number(a.lat);
    const lon = Number(a.lon);
    const hex = String(a.hex ?? "").trim();
    if (!hex || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const onGround = a.alt_baro === "ground";
    const altFt = onGround ? 0 : Number(a.alt_baro ?? a.alt_geom ?? 0);
    const heading = Number(a.track ?? a.true_heading ?? a.mag_heading ?? 0);

    fixes.push({
      id: `plane-${hex}`,
      kind: "plane",
      callsign: String(a.flight ?? "").trim() || String(a.r ?? "").trim() || hex.toUpperCase(),
      lat,
      lon,
      headingDeg: Number.isFinite(heading) ? heading : 0,
      speedKmh: Math.max(0, Number(a.gs ?? 0)) * KT_TO_KMH,
      altitude: Math.max(0, (Number.isFinite(altFt) ? altFt : 0) * FT_TO_M),
      onGround,
    });
  }
  return fixes;
}

/** Result of one polling round. */
export interface AdsbResult {
  fixes: VesselFix[];
  /** which aggregator answered */
  source: string;
}

// Remember which source worked last so we don't re-probe the dead ones on
// every poll. Reset to the top of the list after repeated failures.
let preferredIdx = 0;

/**
 * Fetch live aircraft around a point, trying each aggregator in turn.
 * Throws only when every source fails.
 */
export async function fetchAdsb(
  lat: number,
  lon: number,
  radiusNm: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AdsbResult> {
  const n = ADSB_SOURCES.length;
  let lastErr: unknown = null;
  for (let i = 0; i < n; i++) {
    const idx = (preferredIdx + i) % n;
    const src = ADSB_SOURCES[idx];
    try {
      const res = await fetchImpl(src.url(lat, lon, radiusNm), {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${src.name}: HTTP ${res.status}`);
      const fixes = normalizeAdsb(await res.json());
      preferredIdx = idx;
      return { fixes, source: src.name };
    } catch (err) {
      lastErr = err;
    }
  }
  preferredIdx = 0;
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
