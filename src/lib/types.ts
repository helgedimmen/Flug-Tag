// Core domain types for Flug-Tag.
// The game is "litt som Risk, Pokémon Go og Ingress" built on flight data:
// real(-ish) aircraft fly between airports, players TAG planes that pass
// overhead, tagged planes belong to a TEAM and drag a coloured trail/territory
// behind them, and AIRPORTS get coloured by whichever team lands the most
// planes there within a time window.

/** A point on the globe. */
export interface LatLng {
  lat: number;
  lon: number;
}

/** A faction. The local player belongs to exactly one team. */
export interface Team {
  id: string;
  name: string;
  /** CSS colour used for everything this team owns (planes, trails, airports). */
  color: string;
}

/** A real-world airport node. Acts as a Risk-style territory. */
export interface Airport {
  id: string; // IATA-ish code, e.g. "OSL"
  name: string;
  lat: number;
  lon: number;
}

/** A single "plane landed here" event, used to decide airport control. */
export interface Landing {
  airportId: string;
  teamId: string;
  /** epoch ms */
  t: number;
}

/** Live state of one aircraft. */
export interface Plane {
  id: string;
  callsign: string;
  fromId: string;
  toId: string;
  lat: number;
  lon: number;
  /** degrees, 0 = north, clockwise */
  headingDeg: number;
  /** km/h ground speed */
  speedKmh: number;
  /** metres */
  altitude: number;
  /** 0..1 along the great-circle leg from `fromId` to `toId` */
  progress: number;
  /** total great-circle distance of the current leg, km */
  legKm: number;
  /** owning team id, or null when neutral (not yet tagged) */
  teamId: string | null;
  /** recent positions, newest last — drawn as the team-coloured trail */
  trail: LatLng[];
}

/** How an airport decides who controls it. Configurable per §"flyplass farges". */
export type ControlMode = "most-in-window" | "last";

export interface GameConfig {
  /** km radius around the player within which planes can be tagged */
  tagRangeKm: number;
  /** airport control rule */
  controlMode: ControlMode;
  /** time window (ms) for "most-in-window" landing counting */
  controlWindowMs: number;
  /** max trail points kept per plane */
  trailLength: number;
}

export interface ScoreRow {
  teamId: string;
  planes: number;
  airports: number;
  /** derived total */
  score: number;
}
