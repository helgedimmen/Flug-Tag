import "server-only";

// Real flight-data source: OpenSky Network. This is the future replacement for
// the local simulation. It stays OFF unless credentials are configured, because
// OpenSky now requires OAuth2 (anonymous access returns 403) and the sandbox we
// develop in has no key. When you deploy with credentials, the client can be
// pointed at /api/flights instead of the local sim — same `LiveAircraft` shape.
//
// Env:
//   OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET  → OAuth2 client-credentials
// Docs: https://openskynetwork.github.io/opensky-api/

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all";

export interface LiveAircraft {
  icao24: string;
  callsign: string;
  lat: number;
  lon: number;
  altitude: number; // metres
  velocity: number; // m/s
  headingDeg: number;
  onGround: boolean;
}

export interface BBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

export function openSkyConfigured(): boolean {
  return Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.OPENSKY_CLIENT_ID!,
    client_secret: process.env.OPENSKY_CLIENT_SECRET!,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`OpenSky token failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    // refresh a minute early
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

/** Fetch live aircraft states within a bounding box and normalise them. */
export async function fetchLiveAircraft(bbox: BBox): Promise<LiveAircraft[]> {
  const token = await getToken();
  const url = new URL(STATES_URL);
  url.searchParams.set("lamin", String(bbox.lamin));
  url.searchParams.set("lomin", String(bbox.lomin));
  url.searchParams.set("lamax", String(bbox.lamax));
  url.searchParams.set("lomax", String(bbox.lomax));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    // live data — never cache
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OpenSky states failed: ${res.status}`);
  const json = (await res.json()) as { states: unknown[][] | null };

  return (json.states ?? [])
    .map((s) => ({
      icao24: String(s[0] ?? "").trim(),
      callsign: String(s[1] ?? "").trim(),
      lon: Number(s[5]),
      lat: Number(s[6]),
      altitude: Number(s[7] ?? s[13] ?? 0),
      velocity: Number(s[9] ?? 0),
      headingDeg: Number(s[10] ?? 0),
      onGround: Boolean(s[8]),
    }))
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon));
}
