import type { VesselFix } from "../types";

// LIVE ships: aisstream.io — a free, community AIS feed delivered over
// WebSocket, which browsers can open directly (no CORS involved), so it works
// from a static GitHub Pages site. It DOES need a (free) API key: sign in at
// https://aisstream.io with a GitHub account and create one. The key is read
// from NEXT_PUBLIC_AISSTREAM_KEY at build time (GitHub secret) or pasted into
// the game and kept in localStorage. Without a key the game simply runs
// planes-only.
//
//   docs: https://aisstream.io/documentation

export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
export const AIS_KEY_STORAGE = "flugtag_aisstream_key";

const KT_TO_KMH = 1.852;

// AIS "not available" sentinels.
const SOG_NA = 102.3; // speed over ground
const COG_NA = 360; // course over ground
const HDG_NA = 511; // true heading

/** The slice of an aisstream.io message we read. */
interface AisMessage {
  MessageType?: string;
  MetaData?: {
    MMSI?: number;
    ShipName?: string;
    latitude?: number;
    longitude?: number;
  };
  Message?: {
    PositionReport?: {
      Latitude?: number;
      Longitude?: number;
      Sog?: number; // knots
      Cog?: number; // degrees
      TrueHeading?: number; // degrees
    };
  };
}

/**
 * Normalise one aisstream.io message into a VesselFix.
 * Returns null for non-position messages or messages without a usable fix.
 */
export function normalizeAisMessage(raw: unknown): VesselFix | null {
  const msg = raw as AisMessage | null;
  if (!msg || msg.MessageType !== "PositionReport") return null;

  const pr = msg.Message?.PositionReport;
  const meta = msg.MetaData;
  const mmsi = Number(meta?.MMSI);
  const lat = Number(pr?.Latitude ?? meta?.latitude);
  const lon = Number(pr?.Longitude ?? meta?.longitude);
  if (!Number.isFinite(mmsi) || mmsi <= 0) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const sog = Number(pr?.Sog);
  const speedKmh =
    Number.isFinite(sog) && sog !== SOG_NA ? Math.max(0, sog) * KT_TO_KMH : 0;

  const hdg = Number(pr?.TrueHeading);
  const cog = Number(pr?.Cog);
  const headingDeg =
    Number.isFinite(hdg) && hdg !== HDG_NA
      ? hdg
      : Number.isFinite(cog) && cog !== COG_NA
        ? cog
        : 0;

  const name = String(meta?.ShipName ?? "").trim();
  return {
    id: `boat-${mmsi}`,
    kind: "boat",
    callsign: name || `MMSI ${mmsi}`,
    lat,
    lon,
    headingDeg,
    speedKmh,
    altitude: 0,
    onGround: false,
  };
}

export type AisStatus =
  | "off" // no key configured
  | "connecting"
  | "live"
  | "error"; // failed — will keep retrying

export interface AisBBox {
  latMin: number;
  lonMin: number;
  latMax: number;
  lonMax: number;
}

export interface AisConnection {
  close: () => void;
}

/**
 * Open (and keep open) an aisstream.io subscription for a bounding box.
 * Reconnects with backoff on failure. Call `.close()` to stop for good.
 */
export function connectAisStream(
  apiKey: string,
  bbox: AisBBox,
  onFix: (fix: VesselFix) => void,
  onStatus: (status: AisStatus) => void,
): AisConnection {
  let ws: WebSocket | null = null;
  let closed = false;
  let retryMs = 2000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) return;
    onStatus("connecting");
    ws = new WebSocket(AISSTREAM_URL);

    ws.onopen = () => {
      // aisstream bounding boxes are [[lat, lon], [lat, lon]] corner pairs.
      ws?.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [
            [
              [bbox.latMin, bbox.lonMin],
              [bbox.latMax, bbox.lonMax],
            ],
          ],
          FilterMessageTypes: ["PositionReport"],
        }),
      );
      retryMs = 2000;
      onStatus("live");
    };

    ws.onmessage = (ev) => {
      try {
        const fix = normalizeAisMessage(JSON.parse(String(ev.data)));
        if (fix) onFix(fix);
      } catch {
        // ignore malformed frames
      }
    };

    // A rejected key closes the socket server-side; treat close and error the
    // same: report + retry with backoff (capped), unless we closed on purpose.
    ws.onclose = () => {
      if (closed) return;
      onStatus("error");
      retryTimer = setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 60_000);
    };
    ws.onerror = () => {
      // onclose fires next and handles the retry.
    };
  };

  open();

  return {
    close: () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
      onStatus("off");
    },
  };
}
