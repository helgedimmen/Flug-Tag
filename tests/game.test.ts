import { describe, expect, it } from "vitest";
import {
  airportControl,
  computeScores,
  pruneLandings,
  taggableVessels,
  tagVessel,
} from "@/lib/game";
import type { Landing, Vessel, VesselKind } from "@/lib/types";

function vessel(
  id: string,
  lat: number,
  lon: number,
  teamId: string | null,
  kind: VesselKind = "plane",
): Vessel {
  return {
    id,
    kind,
    callsign: id,
    lat,
    lon,
    headingDeg: 0,
    speedKmh: kind === "plane" ? 800 : 30,
    altitude: kind === "plane" ? 10000 : 0,
    onGround: false,
    lastSeen: 0,
    teamId,
    trail: [],
  };
}

describe("taggableVessels", () => {
  const player = { lat: 60, lon: 10 };
  it("includes neutral vessels in range and excludes far ones", () => {
    const vessels = [
      vessel("near", 60.1, 10.1, null),
      vessel("boat", 60.2, 10.0, null, "boat"),
      vessel("far", 69, 18, null),
    ];
    const out = taggableVessels(vessels, player, "blue", 120);
    expect(out.map((v) => v.id)).toEqual(["near", "boat"]);
  });

  it("excludes vessels the player already owns but allows stealing rivals", () => {
    const vessels = [
      vessel("mine", 60.1, 10.1, "blue"),
      vessel("theirs", 60.1, 10.1, "red"),
    ];
    const out = taggableVessels(vessels, player, "blue", 120);
    expect(out.map((v) => v.id)).toEqual(["theirs"]);
  });
});

describe("tagVessel", () => {
  it("assigns ownership and restarts the trail at the tag point", () => {
    const v = vessel("x", 60, 10, null);
    v.trail = [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }];
    tagVessel(v, "blue");
    expect(v.teamId).toBe("blue");
    expect(v.trail).toEqual([{ lat: 60, lon: 10 }]);
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
  it("scores planes (10) + boats (10) + airports (50), sorted descending", () => {
    const vessels = [
      vessel("a", 0, 0, "blue"),
      vessel("b", 0, 0, "blue"),
      vessel("s", 0, 0, "blue", "boat"),
      vessel("c", 0, 0, "red"),
    ];
    const control = { OSL: "blue", BGO: "red", TRD: "blue" };
    const rows = computeScores(vessels, control, ["blue", "red", "green"]);
    expect(rows[0].teamId).toBe("blue"); // 2*10 + 1*10 + 2*50 = 130
    expect(rows[0].score).toBe(130);
    expect(rows[0].planes).toBe(2);
    expect(rows[0].boats).toBe(1);
    const red = rows.find((r) => r.teamId === "red")!;
    expect(red.score).toBe(60); // 1*10 + 1*50
    const green = rows.find((r) => r.teamId === "green")!;
    expect(green.score).toBe(0);
  });
});
