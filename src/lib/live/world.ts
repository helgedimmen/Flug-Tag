import { destination, distanceKm } from "../geo";
import type { Airport, Landing, Vessel, VesselFix } from "../types";

// The live world model. Replaces the old FlightSim: instead of inventing
// traffic it holds REAL vessels fed by the ADS-B poller (planes) and the AIS
// stream (boats), dead-reckons them forward between feed updates so movement
// stays smooth, detects real landings for airport control, and prunes vessels
// the feeds have gone quiet about. Game state (team ownership, trails)
// survives feed updates because vessels are keyed by their real-world id.

/** Feed silence after which a vessel is dropped. Planes report every few
 *  seconds while airborne; ships at anchor can be minutes between reports. */
export const PLANE_STALE_MS = 90_000;
export const BOAT_STALE_MS = 15 * 60_000;

// Landing detection (real behaviour, not simulated legs):
//  - a tagged plane that transitions to on-ground / very low near an airport
//    has landed there;
//  - a tagged plane that VANISHES from the feed while low near an airport has
//    (almost certainly) landed — coverage near the ground is patchy, so the
//    last fix is often at a few hundred metres.
const LANDED_ALT_M = 150;
const LANDING_NEAR_KM = 8;
const VANISH_ALT_M = 1200;
const VANISH_NEAR_KM = 10;

const TRAIL_MIN_STEP_KM = 0.15;

export interface WorldOptions {
  trailLength: number;
}

/** Pure helper: did this update complete a landing? Exported for tests. */
export function landingAirport(
  prev: Pick<Vessel, "kind" | "altitude" | "onGround">,
  next: Pick<VesselFix, "lat" | "lon" | "altitude" | "onGround">,
  airports: Airport[],
): Airport | null {
  if (prev.kind !== "plane") return null;
  const wasAirborne = !prev.onGround && prev.altitude > LANDED_ALT_M;
  const isDown = next.onGround || next.altitude <= LANDED_ALT_M;
  if (!wasAirborne || !isDown) return null;
  return nearestAirportWithin(next, airports, LANDING_NEAR_KM);
}

function nearestAirportWithin(
  pos: { lat: number; lon: number },
  airports: Airport[],
  maxKm: number,
): Airport | null {
  let best: Airport | null = null;
  let bestD = maxKm;
  for (const a of airports) {
    const d = distanceKm(pos, a);
    if (d <= bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

export class LiveWorld {
  vessels: Map<string, Vessel> = new Map();
  private trailLength: number;

  constructor(opts: WorldOptions) {
    this.trailLength = opts.trailLength;
  }

  /** All vessels as an array (the shape the game rules work on). */
  list(): Vessel[] {
    return [...this.vessels.values()];
  }

  /**
   * Apply one real fix from a feed. Keeps game state (team, trail) for known
   * vessels. Returns a Landing when this update completes one (tagged planes
   * only — neutral landings don't colour an airport).
   */
  applyFix(fix: VesselFix, now: number, airports: Airport[]): Landing | null {
    const existing = this.vessels.get(fix.id);
    let landing: Landing | null = null;

    if (existing) {
      if (existing.teamId) {
        const at = landingAirport(existing, fix, airports);
        if (at) landing = { airportId: at.id, teamId: existing.teamId, t: now };
      }
      existing.callsign = fix.callsign || existing.callsign;
      this.pushTrail(existing, fix.lat, fix.lon);
      existing.lat = fix.lat;
      existing.lon = fix.lon;
      existing.headingDeg = fix.headingDeg;
      existing.speedKmh = fix.speedKmh;
      existing.altitude = fix.altitude;
      existing.onGround = fix.onGround;
      existing.lastSeen = now;
    } else {
      this.vessels.set(fix.id, {
        ...fix,
        lastSeen: now,
        teamId: null,
        trail: [{ lat: fix.lat, lon: fix.lon }],
      });
    }
    return landing;
  }

  /** Apply a whole polling round of aircraft fixes. */
  applyAircraft(fixes: VesselFix[], now: number, airports: Airport[]): Landing[] {
    const landings: Landing[] = [];
    for (const f of fixes) {
      const l = this.applyFix(f, now, airports);
      if (l) landings.push(l);
    }
    return landings;
  }

  /**
   * Advance every vessel by `dtSeconds` along its last known course/speed —
   * keeps motion smooth between feed updates. Parked/anchored vessels stay put.
   */
  tick(dtSeconds: number): void {
    for (const v of this.vessels.values()) {
      if (v.onGround || v.speedKmh < 2) continue;
      const stepKm = v.speedKmh * (dtSeconds / 3600);
      const pos = destination(v, v.headingDeg, stepKm);
      v.lat = pos.lat;
      v.lon = pos.lon;
      this.pushTrail(v, pos.lat, pos.lon);
    }
  }

  /**
   * Drop vessels the feeds have gone quiet about. A tagged plane that vanishes
   * low near an airport counts as landing there. Returns those landings.
   */
  prune(now: number, airports: Airport[]): Landing[] {
    const landings: Landing[] = [];
    for (const [id, v] of this.vessels) {
      const staleMs = v.kind === "plane" ? PLANE_STALE_MS : BOAT_STALE_MS;
      if (now - v.lastSeen <= staleMs) continue;
      if (
        v.kind === "plane" &&
        v.teamId &&
        v.altitude <= VANISH_ALT_M &&
        nearestAirportWithin(v, airports, VANISH_NEAR_KM)
      ) {
        const at = nearestAirportWithin(v, airports, VANISH_NEAR_KM)!;
        landings.push({ airportId: at.id, teamId: v.teamId, t: now });
      }
      this.vessels.delete(id);
    }
    return landings;
  }

  private pushTrail(v: Vessel, lat: number, lon: number): void {
    const last = v.trail[v.trail.length - 1];
    if (last && distanceKm(last, { lat, lon }) < TRAIL_MIN_STEP_KM) return;
    v.trail.push({ lat, lon });
    if (v.trail.length > this.trailLength) v.trail.shift();
  }
}
