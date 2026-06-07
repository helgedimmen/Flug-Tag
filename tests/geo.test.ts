import { describe, expect, it } from "vitest";
import { bearingDeg, convexHull, distanceKm, interpolate } from "@/lib/geo";
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
