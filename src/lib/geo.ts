import type { LatLng } from "./types";

const R_EARTH_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in km between two points. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees (0=N, clockwise) from a → b. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Point at fraction `f` (0..1) along the great circle from a → b.
 * Spherical linear interpolation (slerp) so long Norwegian legs curve
 * naturally rather than cutting straight across the lat/lon grid.
 */
export function interpolate(a: LatLng, b: LatLng, f: number): LatLng {
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);

  const d = distanceKm(a, b) / R_EARTH_KM; // angular distance (radians)
  if (d === 0) return { lat: a.lat, lon: a.lon };

  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);

  const x =
    A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y =
    A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lon = Math.atan2(y, x);
  return { lat: toDeg(lat), lon: toDeg(lon) };
}

/**
 * Destination point: start at `a`, travel `km` along `bearing` (degrees,
 * 0 = north, clockwise) on a great circle. Used to dead-reckon live vessels
 * forward between feed updates.
 */
export function destination(a: LatLng, bearing: number, km: number): LatLng {
  if (km === 0) return { lat: a.lat, lon: a.lon };
  const d = km / R_EARTH_KM; // angular distance
  const brg = toRad(bearing);
  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    lat: toDeg(lat2),
    lon: ((toDeg(lon2) + 540) % 360) - 180, // normalise to [-180, 180)
  };
}

/**
 * Convex hull (Andrew's monotone chain) of a set of points, treated as planar
 * — fine at country scale. Returns the hull in order, or the input unchanged
 * when there are fewer than 3 points. Used to draw a team's "field": the
 * territory enclosed by its tagged planes (Ingress-style area between units).
 */
export function convexHull(points: LatLng[]): LatLng[] {
  if (points.length < 3) return points.slice();
  const pts = points
    .slice()
    .sort((p, q) => (p.lon === q.lon ? p.lat - q.lat : p.lon - q.lon));

  const cross = (o: LatLng, a: LatLng, b: LatLng) =>
    (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);

  const lower: LatLng[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  const upper: LatLng[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
