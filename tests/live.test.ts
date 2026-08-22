import { describe, expect, it } from "vitest";
import { fetchAdsb, normalizeAdsb } from "@/lib/live/adsb";
import { normalizeAisMessage } from "@/lib/live/ais";
import { LiveWorld, PLANE_STALE_MS, landingAirport } from "@/lib/live/world";
import { distanceKm } from "@/lib/geo";
import type { Airport, VesselFix } from "@/lib/types";

// ---------------------------------------------------------------------------
// ADS-B (planes) — normalising the reapi JSON the aggregators return.
// ---------------------------------------------------------------------------

const REAPI_SAMPLE = {
  ac: [
    {
      hex: "478742",
      flight: "SAS123  ",
      lat: 63.5,
      lon: 10.9,
      alt_baro: 10000, // feet
      gs: 400, // knots
      track: 90,
    },
    {
      hex: "47ab12",
      r: "LN-ABC",
      lat: 63.4,
      lon: 10.4,
      alt_baro: "ground" as const,
      gs: 5,
    },
    // no position → dropped
    { hex: "beef01", flight: "GHOST" },
  ],
};

describe("normalizeAdsb", () => {
  it("converts units, trims callsigns, flags ground, drops position-less", () => {
    const fixes = normalizeAdsb(REAPI_SAMPLE);
    expect(fixes).toHaveLength(2);

    const sas = fixes[0];
    expect(sas.id).toBe("plane-478742");
    expect(sas.kind).toBe("plane");
    expect(sas.callsign).toBe("SAS123");
    expect(sas.altitude).toBeCloseTo(3048, 0); // 10000 ft → m
    expect(sas.speedKmh).toBeCloseTo(740.8, 1); // 400 kt → km/h
    expect(sas.onGround).toBe(false);

    const ground = fixes[1];
    expect(ground.onGround).toBe(true);
    expect(ground.altitude).toBe(0);
    expect(ground.callsign).toBe("LN-ABC"); // registration fallback
  });

  it("tolerates junk", () => {
    expect(normalizeAdsb(null)).toEqual([]);
    expect(normalizeAdsb({})).toEqual([]);
    expect(normalizeAdsb({ ac: "nope" })).toEqual([]);
  });
});

describe("fetchAdsb", () => {
  it("falls back to the next source when one fails", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      if (calls.length === 1) throw new Error("down");
      return {
        ok: true,
        json: async () => REAPI_SAMPLE,
      } as Response;
    }) as typeof fetch;

    const res = await fetchAdsb(63.4, 10.4, 100, fakeFetch);
    expect(res.fixes).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toBe(calls[1]);
  });
});

// ---------------------------------------------------------------------------
// AIS (boats) — normalising aisstream.io messages.
// ---------------------------------------------------------------------------

const AIS_SAMPLE = {
  MessageType: "PositionReport",
  MetaData: { MMSI: 257123456, ShipName: "MS TRONDHEIMSFJORD ", time_utc: "…" },
  Message: {
    PositionReport: {
      Latitude: 63.43,
      Longitude: 10.38,
      Sog: 12, // knots
      Cog: 245.5,
      TrueHeading: 246,
    },
  },
};

describe("normalizeAisMessage", () => {
  it("maps a PositionReport to a boat fix", () => {
    const fix = normalizeAisMessage(AIS_SAMPLE);
    expect(fix).not.toBeNull();
    expect(fix!.id).toBe("boat-257123456");
    expect(fix!.kind).toBe("boat");
    expect(fix!.callsign).toBe("MS TRONDHEIMSFJORD");
    expect(fix!.speedKmh).toBeCloseTo(22.2, 1); // 12 kt
    expect(fix!.headingDeg).toBe(246);
    expect(fix!.altitude).toBe(0);
  });

  it("treats AIS 'not available' sentinels as unknown", () => {
    const fix = normalizeAisMessage({
      ...AIS_SAMPLE,
      Message: {
        PositionReport: {
          Latitude: 63.43,
          Longitude: 10.38,
          Sog: 102.3, // N/A
          Cog: 360, // N/A
          TrueHeading: 511, // N/A
        },
      },
    });
    expect(fix!.speedKmh).toBe(0);
    expect(fix!.headingDeg).toBe(0);
  });

  it("ignores non-position messages and junk", () => {
    expect(normalizeAisMessage({ MessageType: "ShipStaticData" })).toBeNull();
    expect(normalizeAisMessage(null)).toBeNull();
    expect(normalizeAisMessage({})).toBeNull();
  });

  it("names anonymous ships by MMSI", () => {
    const fix = normalizeAisMessage({
      ...AIS_SAMPLE,
      MetaData: { MMSI: 999 },
    });
    expect(fix!.callsign).toBe("MMSI 999");
  });
});

// ---------------------------------------------------------------------------
// LiveWorld — ownership survives updates, dead reckoning, landings, pruning.
// ---------------------------------------------------------------------------

const TRD: Airport = { id: "TRD", name: "Værnes", lat: 63.4576, lon: 10.924 };

function planeFix(over: Partial<VesselFix> = {}): VesselFix {
  return {
    id: "plane-abc123",
    kind: "plane",
    callsign: "TEST1",
    lat: 63.6,
    lon: 10.9,
    headingDeg: 180,
    speedKmh: 800,
    altitude: 3000,
    onGround: false,
    ...over,
  };
}

describe("LiveWorld", () => {
  it("keeps team ownership and trail across feed updates", () => {
    const w = new LiveWorld({ trailLength: 10 });
    w.applyFix(planeFix(), 1000, [TRD]);
    const v = w.vessels.get("plane-abc123")!;
    v.teamId = "blue";

    w.applyFix(planeFix({ lat: 63.7 }), 9000, [TRD]);
    const after = w.vessels.get("plane-abc123")!;
    expect(after.teamId).toBe("blue");
    expect(after.lat).toBe(63.7);
    expect(after.trail.length).toBeGreaterThan(1);
  });

  it("dead-reckons moving vessels the right distance and direction", () => {
    const w = new LiveWorld({ trailLength: 10 });
    w.applyFix(planeFix({ headingDeg: 90, speedKmh: 720 }), 0, []);
    const before = { ...w.vessels.get("plane-abc123")! };

    w.tick(10); // 10 s at 720 km/h → 2 km east
    const after = w.vessels.get("plane-abc123")!;
    const moved = distanceKm(before, after);
    expect(moved).toBeCloseTo(2, 1);
    expect(after.lon).toBeGreaterThan(before.lon);
    expect(after.lat).toBeCloseTo(before.lat, 2);
  });

  it("leaves parked/anchored vessels alone", () => {
    const w = new LiveWorld({ trailLength: 10 });
    w.applyFix(planeFix({ id: "boat-1", kind: "boat", speedKmh: 0 }), 0, []);
    const before = { ...w.vessels.get("boat-1")! };
    w.tick(60);
    const after = w.vessels.get("boat-1")!;
    expect(after.lat).toBe(before.lat);
    expect(after.lon).toBe(before.lon);
  });

  it("detects a landing when an owned plane touches down near an airport", () => {
    const w = new LiveWorld({ trailLength: 10 });
    w.applyFix(planeFix({ lat: 63.5, lon: 10.9, altitude: 800 }), 0, [TRD]);
    w.vessels.get("plane-abc123")!.teamId = "red";

    const landing = w.applyFix(
      planeFix({ lat: 63.457, lon: 10.92, altitude: 0, onGround: true }),
      5000,
      [TRD],
    );
    expect(landing).toEqual({ airportId: "TRD", teamId: "red", t: 5000 });
  });

  it("does not count neutral touch-downs or far-from-airport descents", () => {
    const w = new LiveWorld({ trailLength: 10 });
    // neutral plane lands → no event
    w.applyFix(planeFix({ altitude: 800 }), 0, [TRD]);
    const neutral = w.applyFix(
      planeFix({ lat: 63.457, lon: 10.92, altitude: 0, onGround: true }),
      1,
      [TRD],
    );
    expect(neutral).toBeNull();

    // owned plane goes low 200+ km from any airport → no event
    expect(
      landingAirport(
        { kind: "plane", altitude: 900, onGround: false },
        { lat: 60.0, lon: 5.0, altitude: 50, onGround: true },
        [TRD],
      ),
    ).toBeNull();
  });

  it("prunes stale planes; an owned one vanishing low near an airport lands", () => {
    const w = new LiveWorld({ trailLength: 10 });
    w.applyFix(planeFix({ lat: 63.5, lon: 10.9, altitude: 600 }), 0, [TRD]);
    w.vessels.get("plane-abc123")!.teamId = "blue";
    w.applyFix(planeFix({ id: "plane-high", lat: 64, lon: 11, altitude: 11000 }), 0, [TRD]);

    const landings = w.prune(PLANE_STALE_MS + 1000, [TRD]);
    expect(w.vessels.size).toBe(0);
    expect(landings).toEqual([
      { airportId: "TRD", teamId: "blue", t: PLANE_STALE_MS + 1000 },
    ]);
  });
});
