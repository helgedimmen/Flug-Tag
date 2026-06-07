import { describe, expect, it } from "vitest";
import { FlightSim } from "@/lib/simulation";
import { AIRPORT_BY_ID } from "@/lib/airports";
import { distanceKm } from "@/lib/geo";

describe("FlightSim", () => {
  it("spawns the requested number of planes between distinct airports", () => {
    const sim = new FlightSim({ planeCount: 10, timeScale: 1, trailLength: 5 });
    expect(sim.planes).toHaveLength(10);
    for (const p of sim.planes) expect(p.fromId).not.toBe(p.toId);
  });

  it("keeps planes near the great-circle leg as they advance", () => {
    const sim = new FlightSim({ planeCount: 5, timeScale: 30, trailLength: 50 });
    for (let i = 0; i < 100; i++) sim.tick(0.1, Date.now());
    for (const p of sim.planes) {
      const from = AIRPORT_BY_ID[p.fromId];
      const to = AIRPORT_BY_ID[p.toId];
      // current position should never be further from one endpoint than the leg
      expect(distanceKm(from, p)).toBeLessThanOrEqual(p.legKm + 1);
      expect(distanceKm(to, p)).toBeLessThanOrEqual(p.legKm + 1);
    }
  });

  it("only emits landings for owned planes and tags them to the destination", () => {
    const sim = new FlightSim({ planeCount: 6, timeScale: 100, trailLength: 10 });
    for (const p of sim.planes) p.teamId = "blue";
    let landings = 0;
    for (let i = 0; i < 400; i++) {
      const evs = sim.tick(0.2, Date.now());
      for (const e of evs) {
        expect(e.teamId).toBe("blue");
        expect(AIRPORT_BY_ID[e.airportId]).toBeDefined();
        landings++;
      }
    }
    expect(landings).toBeGreaterThan(0);
  });

  it("emits no landings while every plane is neutral", () => {
    const sim = new FlightSim({ planeCount: 6, timeScale: 100, trailLength: 10 });
    let landings = 0;
    for (let i = 0; i < 200; i++) landings += sim.tick(0.2, Date.now()).length;
    expect(landings).toBe(0);
  });

  it("caps trail length", () => {
    const sim = new FlightSim({ planeCount: 3, timeScale: 5, trailLength: 8 });
    for (let i = 0; i < 200; i++) sim.tick(0.1, Date.now());
    for (const p of sim.planes) expect(p.trail.length).toBeLessThanOrEqual(8);
  });
});
