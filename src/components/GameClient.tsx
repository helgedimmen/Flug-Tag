"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MapView, { type MapHandle, type TeamField } from "./MapView";
import { AIRPORTS } from "@/lib/airports";
import { convexHull, distanceKm } from "@/lib/geo";
import {
  DEFAULT_CONFIG,
  airportControl,
  computeScores,
  pruneLandings,
  rivalAiTick,
  tagVessel,
  taggableVessels,
} from "@/lib/game";
import { fetchAdsb } from "@/lib/live/adsb";
import {
  AIS_KEY_STORAGE,
  connectAisStream,
  type AisStatus,
} from "@/lib/live/ais";
import { LiveWorld } from "@/lib/live/world";
import { TEAMS, TEAM_BY_ID } from "@/lib/teams";
import type { Landing, LatLng, Vessel, ScoreRow } from "@/lib/types";

const cfg = DEFAULT_CONFIG;

// Fallback position before geolocation resolves: central Trondheim — a good
// board with Værnes traffic overhead and live fjord traffic (ferries,
// Hurtigruten) on the doorstep.
const PLAYER_DEFAULT: LatLng = { lat: 63.4305, lon: 10.3951 };

// Live-feed tuning.
const ADSB_POLL_MS = 8_000;
const ADSB_RADIUS_NM = 120; // ≈ 220 km of surrounding air traffic
const AIS_BOX_LAT = 2.0; // ± degrees around the player (≈ 220 km N–S)
const AIS_BOX_LON = 4.5; // wider E–W because degrees shrink up north
const AIS_RECONNECT_KM = 150; // player moved this far → resubscribe box
const MAX_PLANES_DRAWN = 120;
const MAX_BOATS_DRAWN = 150;

/** Convex-hull territory for each team that owns ≥3 vessels. */
function computeFields(vessels: Vessel[]): TeamField[] {
  const fields: TeamField[] = [];
  for (const team of TEAMS) {
    const pts = vessels
      .filter((v) => v.teamId === team.id)
      .map((v) => ({ lat: v.lat, lon: v.lon }));
    if (pts.length >= 3) fields.push({ teamId: team.id, polygon: convexHull(pts) });
  }
  return fields;
}

/** Keep the map light: nearest N of each kind (never drops owned vessels). */
function capForMap(vessels: Vessel[], player: LatLng): Vessel[] {
  const rank = (v: Vessel) => (v.teamId ? -1 : distanceKm(player, v));
  const planes = vessels
    .filter((v) => v.kind === "plane")
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_PLANES_DRAWN);
  const boats = vessels
    .filter((v) => v.kind === "boat")
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_BOATS_DRAWN);
  return planes.concat(boats);
}

type AdsbState =
  | { kind: "loading" }
  | { kind: "live"; source: string }
  | { kind: "error" };

export default function GameClient() {
  const [playerTeamId, setPlayerTeamId] = useState("blue");
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [taggableCount, setTaggableCount] = useState(0);
  const [counts, setCounts] = useState({ planes: 0, boats: 0 });
  const [geoStatus, setGeoStatus] = useState("Finner posisjon …");
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);
  const [adsbState, setAdsbState] = useState<AdsbState>({ kind: "loading" });
  const [aisStatus, setAisStatus] = useState<AisStatus>("off");
  // AIS key: baked in at build time (GitHub secret) or saved in the browser.
  // Lazy init so it's resolved before the first effects run; the server render
  // (no window) sees null, which renders the same "boats off" HUD state.
  const [aisKey, setAisKey] = useState<string | null>(() => {
    const baked = process.env.NEXT_PUBLIC_AISSTREAM_KEY || null;
    if (typeof window === "undefined") return baked;
    try {
      return localStorage.getItem(AIS_KEY_STORAGE) || baked;
    } catch {
      return baked;
    }
  });
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  // bumped to force the AIS subscription to re-centre on the player
  const [aisEpoch, setAisEpoch] = useState(0);

  const mapRef = useRef<MapHandle>(null);
  const worldRef = useRef<LiveWorld>(new LiveWorld({ trailLength: cfg.trailLength }));
  const landingsRef = useRef<Landing[]>([]);
  const playerRef = useRef<LatLng>(PLAYER_DEFAULT);
  const teamRef = useRef(playerTeamId);
  const taggableRef = useRef<Vessel[]>([]);
  const aisCentreRef = useRef<LatLng | null>(null);
  useEffect(() => {
    teamRef.current = playerTeamId;
  }, [playerTeamId]);

  const flash = useCallback((msg: string) => {
    setToast({ msg, key: Date.now() });
  }, []);

  const tagById = useCallback(
    (id: string) => {
      const v = worldRef.current.vessels.get(id);
      if (!v) return;
      if (v.teamId === teamRef.current) return;
      tagVessel(v, teamRef.current);
      flash(`Tagget ${v.callsign} ${v.kind === "plane" ? "✈" : "🚢"}`);
    },
    [flash],
  );

  const tagNearest = useCallback(() => {
    const list = taggableRef.current;
    if (list.length === 0) {
      flash("Ingenting innen rekkevidde");
      return;
    }
    const player = playerRef.current;
    let best = list[0];
    let bestD = distanceKm(player, best);
    for (const v of list) {
      const d = distanceKm(player, v);
      if (d < bestD) {
        best = v;
        bestD = d;
      }
    }
    tagById(best.id);
  }, [flash, tagById]);

  // --- Geolocation: real position when allowed, Trondheim as fallback. ---
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      const t = setTimeout(() => setGeoStatus("Ingen GPS — bruker Trondheim"), 0);
      return () => clearTimeout(t);
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        playerRef.current = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        };
        setGeoStatus("GPS aktiv");
        // If the boat subscription is centred far from where the player
        // actually is, re-subscribe around them.
        const c = aisCentreRef.current;
        if (c && distanceKm(c, playerRef.current) > AIS_RECONNECT_KM)
          setAisEpoch((e) => e + 1);
      },
      () => setGeoStatus("GPS avslått — bruker Trondheim"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // --- LIVE planes: poll the keyless ADS-B aggregators around the player. ---
  useEffect(() => {
    let stopped = false;
    let inFlight = false;

    const poll = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const p = playerRef.current;
        const { fixes, source } = await fetchAdsb(p.lat, p.lon, ADSB_RADIUS_NM);
        if (stopped) return;
        const now = Date.now();
        const landings = worldRef.current.applyAircraft(fixes, now, AIRPORTS);
        if (landings.length) landingsRef.current.push(...landings);
        setAdsbState({ kind: "live", source });
      } catch {
        if (!stopped) setAdsbState({ kind: "error" });
      } finally {
        inFlight = false;
      }
    };

    poll();
    const id = setInterval(poll, ADSB_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  // --- LIVE boats: aisstream.io subscription in a box around the player. ---
  useEffect(() => {
    // No key → stay in the initial "off" state (the connection's own close()
    // resets it if a live subscription is torn down).
    if (!aisKey) return;
    const centre = playerRef.current;
    aisCentreRef.current = centre;
    const conn = connectAisStream(
      aisKey,
      {
        latMin: centre.lat - AIS_BOX_LAT,
        latMax: centre.lat + AIS_BOX_LAT,
        lonMin: centre.lon - AIS_BOX_LON,
        lonMax: centre.lon + AIS_BOX_LON,
      },
      (fix) => {
        const landings = worldRef.current.applyFix(fix, Date.now(), AIRPORTS);
        if (landings) landingsRef.current.push(landings);
      },
      setAisStatus,
    );
    return () => conn.close();
  }, [aisKey, aisEpoch]);

  // --- The game loop: dead-reckon, rules, draw. ---
  useEffect(() => {
    const world = worldRef.current;
    let raf = 0;
    let last = performance.now();
    let rivalAcc = 0;
    let pruneAcc = 0;
    let mapAcc = 0;
    let hudAcc = 0;

    const step = (now: number) => {
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      const stamp = Date.now();

      world.tick(dt);

      rivalAcc += dt;
      if (rivalAcc >= 2) {
        rivalAiTick(world.list(), teamRef.current, 0.002);
        rivalAcc = 0;
      }

      pruneAcc += dt;
      if (pruneAcc >= 5) {
        pruneAcc = 0;
        const landings = world.prune(stamp, AIRPORTS);
        if (landings.length) landingsRef.current.push(...landings);
      }

      landingsRef.current = pruneLandings(
        landingsRef.current,
        cfg.controlWindowMs,
        stamp,
      );
      const control = airportControl(
        landingsRef.current,
        cfg.controlMode,
        cfg.controlWindowMs,
        stamp,
      );

      const vessels = world.list();
      const taggable = taggableVessels(
        vessels,
        playerRef.current,
        teamRef.current,
        cfg.tagRangeKm,
      );
      taggableRef.current = taggable;

      mapAcc += dt;
      if (mapAcc >= 1 / 15) {
        mapAcc = 0;
        mapRef.current?.update({
          vessels: capForMap(vessels, playerRef.current),
          airports: AIRPORTS,
          control,
          fields: computeFields(vessels),
          player: playerRef.current,
          tagRangeKm: cfg.tagRangeKm,
          taggableIds: new Set(taggable.map((v) => v.id)),
          onTag: tagById,
        });
      }

      hudAcc += dt;
      if (hudAcc >= 0.3) {
        hudAcc = 0;
        setScores(computeScores(vessels, control, TEAMS.map((t) => t.id)));
        setTaggableCount(taggable.length);
        setCounts({
          planes: vessels.filter((v) => v.kind === "plane").length,
          boats: vessels.filter((v) => v.kind === "boat").length,
        });
      }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [tagById]);

  // --- Auto-dismiss the toast. ---
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(id);
  }, [toast]);

  // --- Keyboard: space / Enter taps the tag button. ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showKeyDialog) return;
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        tagNearest();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tagNearest, showKeyDialog]);

  const saveKey = useCallback(() => {
    const k = keyDraft.trim();
    if (!k) return;
    try {
      localStorage.setItem(AIS_KEY_STORAGE, k);
    } catch {
      // private mode — key still works for this session
    }
    setAisKey(k);
    setShowKeyDialog(false);
    flash("Kobler til båtdata …");
  }, [keyDraft, flash]);

  const me = TEAM_BY_ID[playerTeamId];

  const planeStatus =
    adsbState.kind === "live"
      ? `✈ ${counts.planes} fly · live (${adsbState.source})`
      : adsbState.kind === "loading"
        ? "✈ henter fly …"
        : "✈ flydata nede — prøver igjen";

  const boatStatus =
    aisStatus === "live"
      ? `🚢 ${counts.boats} båter · live`
      : aisStatus === "connecting"
        ? "🚢 kobler til …"
        : aisStatus === "error"
          ? "🚢 båtdata-feil — prøver igjen"
          : null;

  return (
    <>
      <MapView ref={mapRef} />

      <div className="hud hud-top">
        <div className="panel">
          <div className="brand">
            ✈ Flug-Tag <small>ekte fly · ekte båter · sanntid</small>
          </div>
          <div className="team-pick">
            {TEAMS.map((t) => (
              <button
                key={t.id}
                className={t.id === playerTeamId ? "active" : ""}
                style={
                  t.id === playerTeamId
                    ? { background: t.color, borderColor: t.color }
                    : undefined
                }
                onClick={() => setPlayerTeamId(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
          <div className="status">
            {planeStatus}
            <br />
            {boatStatus ?? (
              <button className="linklike" onClick={() => setShowKeyDialog(true)}>
                🚢 båter av — legg inn gratis nøkkel
              </button>
            )}
            <br />
            {geoStatus} · {taggableCount} innen rekkevidde
          </div>
        </div>

        <div className="panel scoreboard">
          {scores.map((row) => {
            const team = TEAM_BY_ID[row.teamId];
            return (
              <div
                key={row.teamId}
                className={`score-row ${row.teamId === playerTeamId ? "you" : ""}`}
              >
                <span className="dot" style={{ background: team.color }} />
                <span>{team.name}</span>
                <span className="sub">
                  {row.planes}✈ {row.boats}🚢 {row.airports}⌖
                </span>
                <span className="pts">{row.score}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="hud hud-bottom">
        {toast && (
          <div className="toast show" key={toast.key}>
            {toast.msg}
          </div>
        )}
        <button
          className="tag-btn"
          style={{ background: me.color }}
          disabled={taggableCount === 0}
          onClick={tagNearest}
        >
          TAGG {taggableCount > 0 ? `(${taggableCount})` : ""}
        </button>
        <div className="controls-hint">
          Trykk på et blinkende fly eller en båt — eller knappen / mellomrom
        </div>
      </div>

      {showKeyDialog && (
        <div className="dialog-backdrop" onClick={() => setShowKeyDialog(false)}>
          <div className="panel dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Båter trenger en (gratis) nøkkel</h3>
            <p>
              Flydata er helt åpne, men skipsdata (AIS) krever en gratis nøkkel
              fra{" "}
              <a href="https://aisstream.io" target="_blank" rel="noreferrer">
                aisstream.io
              </a>{" "}
              — logg inn med GitHub-kontoen din, lag en «API Key», og lim den
              inn her. Den lagres kun i din nettleser.
            </p>
            <input
              type="text"
              placeholder="aisstream.io API-nøkkel"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveKey();
              }}
              autoFocus
            />
            <div className="dialog-actions">
              <button className="secondary" onClick={() => setShowKeyDialog(false)}>
                Avbryt
              </button>
              <button className="primary" onClick={saveKey} disabled={!keyDraft.trim()}>
                Aktiver båter
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
