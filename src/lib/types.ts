// Core domain types for Flug-Tag.
// The game is "litt som Risk, Pokémon Go og Ingress" built on LIVE traffic
// data: real aircraft (ADS-B) and real ships (AIS) move on the map, players
// TAG vessels that pass nearby, tagged vessels belong to a TEAM and drag a
// coloured trail/territory behind them, and AIRPORTS get coloured by whichever
// team lands the most planes there within a time window.

/** A point on the globe. */
export interface LatLng {
  lat: number;
  lon: number;
}

/** A faction. The local player belongs to exactly one team. */
export interface Team {
  id: string;
  name: string;
  /** CSS colour used for everything this team owns (vessels, trails, airports). */
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

/** What kind of real-world thing a vessel is. */
export type VesselKind = "plane" | "boat";

/**
 * Live state of one vessel — a real aircraft (from ADS-B) or a real ship
 * (from AIS). Positions are refreshed from the feeds and dead-reckoned
 * forward between updates so movement stays smooth.
 */
export interface Vessel {
  /** stable id: `plane-<icao24>` or `boat-<mmsi>` */
  id: string;
  kind: VesselKind;
  /** flight callsign or ship name — what the player sees */
  callsign: string;
  lat: number;
  lon: number;
  /** degrees, 0 = north, clockwise */
  headingDeg: number;
  /** km/h ground speed */
  speedKmh: number;
  /** metres (0 for boats) */
  altitude: number;
  /** planes only: reported on the ground by the feed */
  onGround: boolean;
  /** epoch ms of the last real fix from the feed */
  lastSeen: number;
  /** owning team id, or null when neutral (not yet tagged) */
  teamId: string | null;
  /** recent positions, newest last — drawn as the team-coloured trail */
  trail: LatLng[];
}

/** A normalised position fix from one of the live feeds. */
export interface VesselFix {
  id: string;
  kind: VesselKind;
  callsign: string;
  lat: number;
  lon: number;
  headingDeg: number;
  speedKmh: number;
  altitude: number;
  onGround: boolean;
}

/** How an airport decides who controls it. Configurable per §"flyplass farges". */
export type ControlMode = "most-in-window" | "last";

export interface GameConfig {
  /** km radius around the player within which vessels can be tagged */
  tagRangeKm: number;
  /** airport control rule */
  controlMode: ControlMode;
  /** time window (ms) for "most-in-window" landing counting */
  controlWindowMs: number;
  /** max trail points kept per vessel */
  trailLength: number;
}

export interface ScoreRow {
  teamId: string;
  planes: number;
  boats: number;
  airports: number;
  /** derived total */
  score: number;
}
