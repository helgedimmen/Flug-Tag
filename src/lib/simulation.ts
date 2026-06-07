import { AIRPORTS, AIRPORT_BY_ID } from "./airports";
import { bearingDeg, distanceKm, interpolate } from "./geo";
import type { Airport, Landing, Plane } from "./types";

// Local flight simulation. This is the DEFAULT data source: it produces planes
// that fly between real airports, so the game is fully playable with no network
// and no API key. The real-data path (OpenSky) plugs in behind the same `Plane`
// shape later — see src/lib/opensky.ts and /api/flights.

const AIRLINE_PREFIXES = ["SK", "DY", "WF", "NOZ", "WIF"]; // SAS, Norwegian, Widerøe…

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeCallsign(): string {
  const prefix = randomItem(AIRLINE_PREFIXES);
  const num = Math.floor(100 + Math.random() * 8900);
  return `${prefix}${num}`;
}

function pickDifferentAirport(notId: string): Airport {
  let a = randomItem(AIRPORTS);
  while (a.id === notId) a = randomItem(AIRPORTS);
  return a;
}

/** Altitude profile (m) over a leg: climb, cruise ~10 km, descend. */
function altitudeFor(progress: number): number {
  const cruise = 10500;
  if (progress < 0.15) return Math.round((progress / 0.15) * cruise);
  if (progress > 0.85) return Math.round(((1 - progress) / 0.15) * cruise);
  return cruise;
}

function newLeg(plane: Plane, fromId: string): void {
  const from = AIRPORT_BY_ID[fromId];
  const to = pickDifferentAirport(fromId);
  plane.fromId = from.id;
  plane.toId = to.id;
  plane.progress = 0;
  plane.legKm = distanceKm(from, to);
  plane.lat = from.lat;
  plane.lon = from.lon;
  plane.headingDeg = bearingDeg(from, to);
  plane.altitude = 0;
  plane.trail = [{ lat: from.lat, lon: from.lon }];
}

export interface SimOptions {
  /** how many simulated aircraft to keep airborne */
  planeCount: number;
  /** wall-clock acceleration so legs complete in seconds, not minutes */
  timeScale: number;
  /** max trail points kept per plane */
  trailLength: number;
}

export const DEFAULT_SIM: SimOptions = {
  planeCount: 22,
  timeScale: 45,
  trailLength: 40,
};

export class FlightSim {
  planes: Plane[] = [];
  private opts: SimOptions;
  private seq = 0;

  constructor(opts: SimOptions = DEFAULT_SIM) {
    this.opts = opts;
    for (let i = 0; i < opts.planeCount; i++) this.planes.push(this.spawn());
  }

  private spawn(): Plane {
    const from = randomItem(AIRPORTS);
    const plane: Plane = {
      id: `sim-${this.seq++}`,
      callsign: makeCallsign(),
      fromId: from.id,
      toId: from.id,
      lat: from.lat,
      lon: from.lon,
      headingDeg: 0,
      speedKmh: 720 + Math.random() * 160,
      altitude: 0,
      progress: 0,
      legKm: 0,
      teamId: null,
      trail: [],
    };
    newLeg(plane, from.id);
    // Stagger starts so they aren't all bunched at airports on frame 1.
    plane.progress = Math.random() * 0.8;
    return plane;
  }

  /**
   * Advance the simulation by `dtSeconds` of wall-clock time.
   * Returns the landing events that occurred this tick (owned planes only —
   * neutral landings don't colour an airport).
   */
  tick(dtSeconds: number, now: number): Landing[] {
    const landings: Landing[] = [];
    for (const p of this.planes) {
      const from = AIRPORT_BY_ID[p.fromId];
      const to = AIRPORT_BY_ID[p.toId];
      const stepKm = p.speedKmh * (dtSeconds / 3600) * this.opts.timeScale;
      const traveled = p.progress * p.legKm + stepKm;

      if (traveled >= p.legKm) {
        // Touchdown at `to`.
        if (p.teamId)
          landings.push({ airportId: to.id, teamId: p.teamId, t: now });
        newLeg(p, to.id);
        continue;
      }

      p.progress = traveled / p.legKm;
      const pos = interpolate(from, to, p.progress);
      p.lat = pos.lat;
      p.lon = pos.lon;
      p.headingDeg = bearingDeg(pos, to);
      p.altitude = altitudeFor(p.progress);

      p.trail.push({ lat: pos.lat, lon: pos.lon });
      if (p.trail.length > this.opts.trailLength) p.trail.shift();
    }
    return landings;
  }
}
