import { distanceKm } from "./geo";
import { rivalTeams } from "./teams";
import type {
  ControlMode,
  GameConfig,
  Landing,
  LatLng,
  Plane,
  ScoreRow,
} from "./types";

export const DEFAULT_CONFIG: GameConfig = {
  tagRangeKm: 120,
  controlMode: "most-in-window",
  controlWindowMs: 5 * 60 * 1000,
  trailLength: 40,
};

/** Points awarded for various holdings — keeps scoring deterministic. */
const PTS_PER_PLANE = 10;
const PTS_PER_AIRPORT = 50;

/** Planes the player could tag right now: within range and not already theirs. */
export function taggablePlanes(
  planes: Plane[],
  player: LatLng,
  playerTeamId: string,
  rangeKm: number,
): Plane[] {
  return planes.filter(
    (p) =>
      p.teamId !== playerTeamId && distanceKm(player, p) <= rangeKm,
  );
}

/** Claim a plane for a team. Mutates the plane (and resets its trail so the
 *  colour change reads cleanly from the tag point onward). */
export function tagPlane(plane: Plane, teamId: string): void {
  plane.teamId = teamId;
  plane.trail = [{ lat: plane.lat, lon: plane.lon }];
}

/**
 * Stand-in for other players until real multiplayer lands: rival factions
 * occasionally claim neutral planes, so airports change hands and the map
 * stays contested in single-player. Mutates planes in place.
 */
export function rivalAiTick(
  planes: Plane[],
  playerTeamId: string,
  claimChancePerTick = 0.04,
): void {
  const rivals = rivalTeams(playerTeamId);
  for (const p of planes) {
    if (p.teamId) continue;
    if (Math.random() < claimChancePerTick) {
      const team = rivals[Math.floor(Math.random() * rivals.length)];
      tagPlane(p, team.id);
    }
  }
}

/** Drop landing events older than the control window to bound memory. */
export function pruneLandings(
  landings: Landing[],
  windowMs: number,
  now: number,
): Landing[] {
  const cutoff = now - windowMs;
  return landings.filter((l) => l.t >= cutoff);
}

/**
 * Decide who controls each airport.
 *  - "most-in-window": team with the most landings inside the time window.
 *  - "last": team of the most recent landing.
 * Returns airportId → controlling teamId (airports with no landings are absent).
 */
export function airportControl(
  landings: Landing[],
  mode: ControlMode,
  windowMs: number,
  now: number,
): Record<string, string> {
  const control: Record<string, string> = {};

  if (mode === "last") {
    const latest: Record<string, Landing> = {};
    for (const l of landings) {
      const cur = latest[l.airportId];
      if (!cur || l.t > cur.t) latest[l.airportId] = l;
    }
    for (const [airportId, l] of Object.entries(latest))
      control[airportId] = l.teamId;
    return control;
  }

  // most-in-window
  const cutoff = now - windowMs;
  const counts: Record<string, Record<string, number>> = {};
  for (const l of landings) {
    if (l.t < cutoff) continue;
    (counts[l.airportId] ??= {})[l.teamId] =
      ((counts[l.airportId] ??= {})[l.teamId] ?? 0) + 1;
  }
  for (const [airportId, byTeam] of Object.entries(counts)) {
    let bestTeam: string | null = null;
    let best = 0;
    for (const [teamId, c] of Object.entries(byTeam)) {
      if (c > best) {
        best = c;
        bestTeam = teamId;
      }
    }
    if (bestTeam) control[airportId] = bestTeam;
  }
  return control;
}

/** Scoreboard: planes owned + airports controlled per team. */
export function computeScores(
  planes: Plane[],
  control: Record<string, string>,
  teamIds: string[],
): ScoreRow[] {
  const rows: Record<string, ScoreRow> = {};
  for (const id of teamIds)
    rows[id] = { teamId: id, planes: 0, airports: 0, score: 0 };

  for (const p of planes) if (p.teamId && rows[p.teamId]) rows[p.teamId].planes++;
  for (const teamId of Object.values(control))
    if (rows[teamId]) rows[teamId].airports++;

  for (const r of Object.values(rows))
    r.score = r.planes * PTS_PER_PLANE + r.airports * PTS_PER_AIRPORT;

  return Object.values(rows).sort((a, b) => b.score - a.score);
}
