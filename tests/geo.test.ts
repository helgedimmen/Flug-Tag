import { describe, expect, it } from "vitest";
import { bearingDeg, convexHull, destination, distanceKm, interpolate } from "@/lib/geo";
import { AIRPORT_BY_ID } from "@/lib/airports";

describe("distanceKm", () => {
  it("is ~0 for identical points", () => {
    expect(distanceKm({ lat: 60, lon: 10 }, { lat: 60, lon: 10 })).toBeCloseTo(0, 5);
  });

  it("matches the known OSL→BGO great-circle distance (~300 km)", () => {
    const d = distanceKm(AIRPORT_BY_ID.OSL, AIRPORT_BY_ID.BGO);
    expect(d).toBeGreaterThan(290);
    expect(d).toBeLessThan(340);
  });
});

describe("bearingDeg", () => {
  it("points due east correctly", () => {
    const b = bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(b).toBeCloseTo(90, 1);
  });
});

describe("interpolate", () => {
  it("returns the endpoints at f=0 and f=1", () => {
    const a = AIRPORT_BY_ID.OSL;
    const b = AIRPORT_BY_ID.TOS;
    const start = interpolate(a, b, 0);
    const end = interpolate(a, b, 1);
    expect(distanceKm(start, a)).toBeLessThan(0.5);
    expect(distanceKm(end, b)).toBeLessThan(0.5);
  });

  it("the midpoint lies roughly halfway along the leg", () => {
    const a = AIRPORT_BY_ID.OSL;
    const b = AIRPORT_BY_ID.BGO;
    const mid = interpolate(a, b, 0.5);
    const total = distanceKm(a, b);
    expect(distanceKm(a, mid)).toBeCloseTo(total / 2, 0);
    expect(distanceKm(mid, b)).toBeCloseTo(total / 2, 0);
  });
});

describe("destination", () => {
  it("travels the requested distance along the bearing", () => {
    const start = { lat: 63.43, lon: 10.4 };
    const end = destination(start, 90, 50);
    expect(distanceKm(start, end)).toBeCloseTo(50, 1);
    expect(bearingDeg(start, end)).toBeCloseTo(90, 0);
  });

  it("is a no-op for zero distance", () => {
    expect(destination({ lat: 60, lon: 10 }, 123, 0)).toEqual({ lat: 60, lon: 10 });
  });

  it("round-trips with distance+bearing", () => {
    const a = { lat: 69.68, lon: 18.92 };
    const b = { lat: 58.88, lon: 5.64 };
    const c = destination(a, bearingDeg(a, b), distanceKm(a, b));
    expect(c.lat).toBeCloseTo(b.lat, 3);
    expect(c.lon).toBeCloseTo(b.lon, 3);
  });
});

describe("convexHull", () => {
  it("returns input unchanged for < 3 points", () => {
    const pts = [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }];
    expect(convexHull(pts)).toHaveLength(2);
  });

  it("drops an interior point", () => {
    const square = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 10 },
      { lat: 10, lon: 0 },
      { lat: 10, lon: 10 },
      { lat: 5, lon: 5 }, // interior — must be excluded
    ];
    const hull = convexHull(square);
    expect(hull).toHaveLength(4);
    expect(hull.some((p) => p.lat === 5 && p.lon === 5)).toBe(false);
  });
});
