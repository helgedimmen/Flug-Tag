import { NextRequest } from "next/server";
import { fetchLiveAircraft, openSkyConfigured } from "@/lib/opensky";

// Live-data endpoint. Default game runs on the in-browser simulation, so this
// only does real work once OpenSky credentials are set (see src/lib/opensky.ts).
// Without them it returns `{ source: "none" }` and the client stays on the sim.
//
// GET /api/flights?lamin=&lomin=&lamax=&lomax=
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!openSkyConfigured()) {
    return Response.json({
      source: "none",
      reason: "OpenSky credentials not configured; using local simulation.",
      aircraft: [],
    });
  }

  const sp = req.nextUrl.searchParams;
  const num = (k: string, d: number) => {
    const v = Number(sp.get(k));
    return Number.isFinite(v) ? v : d;
  };
  // Default bbox: mainland Norway.
  const bbox = {
    lamin: num("lamin", 57.5),
    lomin: num("lomin", 4.0),
    lamax: num("lamax", 71.5),
    lomax: num("lomax", 31.5),
  };

  try {
    const aircraft = await fetchLiveAircraft(bbox);
    return Response.json({ source: "opensky", aircraft });
  } catch (err) {
    return Response.json(
      { source: "error", reason: String(err), aircraft: [] },
      { status: 502 },
    );
  }
}
