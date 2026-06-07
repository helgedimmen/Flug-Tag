import { describe, expect, it } from "vitest";
import {
  airportControl,
  computeScores,
  pruneLandings,
  taggablePlanes,
  tagPlane,
} from "@/lib/game";
import type { Landing, Plane } from "@/lib/types";

function plane(id: string, lat: number, lon: number, teamId: string | null): Plane {
  return {
    id,
    callsign: id,
    fromId: "OSL",
    toId: "BGO",
    lat,
    lon,
    headingDeg: 0,
    speedKmh: 800,
    altitude: 10000,
    progress: 0.5,
    legKm: 300,
    teamId,
    trail: [],
  };
}

describe("taggablePlanes", () => {
  const player = { lat: 60, lon: 10 };
  it("includes neutral planes in range and excludes far ones", () => {
    const planes = [
      plane("near", 60.1, 10.1, null),
      plane("far", 69, 18, null),
    ];
    const out = taggablePlanes(planes, player, "blue", 120);
    expect(out.map((p) => p.id)).toEqual(["near"]);
  });

  it("excludes planes the player already owns but allows stealing rivals", () => {
    const planes = [
      plane("mine", 60.1, 10.1, "blue"),
      plane("theirs", 60.1, 10.1, "red"),
    ];
    const out = taggablePlanes(planes, player, "blue", 120);
    expect(out.map((p) => p.id)).toEqual(["theirs"]);
  });
});

describe("tagPlane", () => {
  it("assigns ownership and restarts the trail at the tag point", () => {
    const p = plane("x", 60, 10, null);
    p.trail = [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }];
    tagPlane(p, "blue");
    expect(p.teamId).toBe("blue");
    expect(p.trail).toEqual([{ lat: 60, lon: 10 }]);
  });
});

describe("airportControl", () => {
  const now = 1_000_000;
  const landings: Landing[] = [
    { airportId: "OSL", teamId: "blue", t: now - 1000 },
    { airportId: "OSL", teamId: "blue", t: now - 2000 },
    { airportId: "OSL", teamId: "red", t: now - 500 }, // most recent
    { airportId: "BGO", teamId: "green", t: now - 9_999_999 }, // stale
  ];

  it("'most-in-window' picks the team with the most recent-window landings", () => {
    const c = airportControl(landings, "most-in-window", 5000, now);
    expect(c.OSL).toBe("blue"); // 2 vs 1
    expect(c.BGO).toBeUndefined(); // outside window
  });

  it("'last' picks the team of the most recent landing", () => {
    const c = airportControl(landings, "last", 5000, now);
    expect(c.OSL).toBe("red");
  });
});

describe("pruneLandings", () => {
  it("drops events older than the window", () => {
    const now = 10_000;
    const ls: Landing[] = [
      { airportId: "OSL", teamId: "blue", t: 9_000 },
      { airportId: "OSL", teamId: "red", t: 1_000 },
    ];
    const out = pruneLandings(ls, 5000, now);
    expect(out).toHaveLength(1);
    expect(out[0].teamId).toBe("blue");
  });
});

describe("computeScores", () => {
  it("scores planes (10) + airports (50) and sorts descending", () => {
    const planes = [
      plane("a", 0, 0, "blue"),
      plane("b", 0, 0, "blue"),
      plane("c", 0, 0, "red"),
    ];
    const control = { OSL: "blue", BGO: "red", TRD: "blue" };
    const rows = computeScores(planes, control, ["blue", "red", "green"]);
    expect(rows[0].teamId).toBe("blue"); // 2*10 + 2*50 = 120
    expect(rows[0].score).toBe(120);
    const red = rows.find((r) => r.teamId === "red")!;
    expect(red.score).toBe(60); // 1*10 + 1*50
    const green = rows.find((r) => r.teamId === "green")!;
    expect(green.score).toBe(0);
  });
});
