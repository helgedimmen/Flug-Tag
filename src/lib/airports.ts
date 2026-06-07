import type { Airport } from "./types";

// A starter set of real Norwegian airports. Coordinates are the published
// field positions. This is the "board" — territories to fight over. Extend
// freely; nothing else hardcodes this list.
export const AIRPORTS: Airport[] = [
  { id: "OSL", name: "Oslo Gardermoen", lat: 60.1939, lon: 11.1004 },
  { id: "BGO", name: "Bergen Flesland", lat: 60.2934, lon: 5.2181 },
  { id: "TRD", name: "Trondheim Værnes", lat: 63.4576, lon: 10.924 },
  { id: "SVG", name: "Stavanger Sola", lat: 58.8767, lon: 5.6378 },
  { id: "TOS", name: "Tromsø", lat: 69.6833, lon: 18.9189 },
  { id: "BOO", name: "Bodø", lat: 67.2692, lon: 14.3653 },
  { id: "AES", name: "Ålesund Vigra", lat: 62.5625, lon: 6.1197 },
  { id: "KRS", name: "Kristiansand Kjevik", lat: 58.2042, lon: 8.0853 },
  { id: "Tef", name: "Sandefjord Torp", lat: 59.1867, lon: 10.2586 },
  { id: "EVE", name: "Harstad/Narvik Evenes", lat: 68.4913, lon: 16.6781 },
];

export const AIRPORT_BY_ID: Record<string, Airport> = Object.fromEntries(
  AIRPORTS.map((a) => [a.id, a]),
);

/** Geographic centre of all airports — used as the map's default view. */
export function airportsCentre(): { lat: number; lon: number } {
  const n = AIRPORTS.length;
  const lat = AIRPORTS.reduce((s, a) => s + a.lat, 0) / n;
  const lon = AIRPORTS.reduce((s, a) => s + a.lon, 0) / n;
  return { lat, lon };
}
