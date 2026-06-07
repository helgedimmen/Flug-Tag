"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MapView, { type MapHandle, type TeamField } from "./MapView";
import { AIRPORT_BY_ID, AIRPORTS } from "@/lib/airports";
import { convexHull, distanceKm } from "@/lib/geo";
import {
  DEFAULT_CONFIG,
  airportControl,
  computeScores,
  pruneLandings,
  rivalAiTick,
  tagPlane,
  taggablePlanes,
} from "@/lib/game";
import { FlightSim } from "@/lib/simulation";
import { TEAMS, TEAM_BY_ID } from "@/lib/teams";
import type { Landing, LatLng, Plane, ScoreRow } from "@/lib/types";

const cfg = DEFAULT_CONFIG;
const PLAYER_DEFAULT = AIRPORT_BY_ID.OSL; // before geolocation resolves

/** Convex-hull territory for each team that owns ≥3 planes. */
function computeFields(planes: Plane[]): TeamField[] {
  const fields: TeamField[] = [];
  for (const team of TEAMS) {
    const pts = planes
      .filter((p) => p.teamId === team.id)
      .map((p) => ({ lat: p.lat, lon: p.lon }));
    if (pts.length >= 3) fields.push({ teamId: team.id, polygon: convexHull(pts) });
  }
  return fields;
}

export default function GameClient() {
  const [playerTeamId, setPlayerTeamId] = useState("blue");
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [taggableCount, setTaggableCount] = useState(0);
  const [geoStatus, setGeoStatus] = useState("Finner posisjon …");
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);

  const mapRef = useRef<MapHandle>(null);
  const simRef = useRef<FlightSim | null>(null);
  const landingsRef = useRef<Landing[]>([]);
  const playerRef = useRef<LatLng>({
    lat: PLAYER_DEFAULT.lat,
    lon: PLAYER_DEFAULT.lon,
  });
  const teamRef = useRef(playerTeamId);
  const taggableRef = useRef<Plane[]>([]);
  useEffect(() => {
    teamRef.current = playerTeamId;
  }, [playerTeamId]);

  const flash = useCallback((msg: string) => {
    setToast({ msg, key: Date.now() });
  }, []);

  const tagById = useCallback(
    (id: string) => {
      const sim = simRef.current;
      if (!sim) return;
      const plane = sim.planes.find((p) => p.id === id);
      if (!plane) return;
      if (plane.teamId === teamRef.current) return;
      tagPlane(plane, teamRef.current);
      flash(`Tagget ${plane.callsign} ✈`);
    },
    [flash],
  );

  const tagNearest = useCallback(() => {
    const list = taggableRef.current;
    if (list.length === 0) {
      flash("Ingen fly innen rekkevidde");
      return;
    }
    const player = playerRef.current;
    let best = list[0];
    let bestD = distanceKm(player, best);
    for (const p of list) {
      const d = distanceKm(player, p);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    tagById(best.id);
  }, [flash, tagById]);

  // --- Geolocation: real position when allowed, OSL as fallback. ---
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      const t = setTimeout(() => setGeoStatus("Ingen GPS — bruker Oslo"), 0);
      return () => clearTimeout(t);
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        playerRef.current = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        };
        setGeoStatus("GPS aktiv");
      },
      () => setGeoStatus("GPS avslått — bruker Oslo"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // --- The game loop. ---
  useEffect(() => {
    const sim = new FlightSim();
    simRef.current = sim;

    let raf = 0;
    let last = performance.now();
    let rivalAcc = 0;
    let mapAcc = 0;
    let hudAcc = 0;

    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const stamp = Date.now();
      const newLandings = sim.tick(dt, stamp);
      if (newLandings.length) landingsRef.current.push(...newLandings);

      rivalAcc += dt;
      if (rivalAcc >= 1) {
        rivalAiTick(sim.planes, teamRef.current);
        rivalAcc = 0;
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

      const taggable = taggablePlanes(
        sim.planes,
        playerRef.current,
        teamRef.current,
        cfg.tagRangeKm,
      );
      taggableRef.current = taggable;

      mapAcc += dt;
      if (mapAcc >= 1 / 15) {
        mapAcc = 0;
        mapRef.current?.update({
          planes: sim.planes,
          airports: AIRPORTS,
          control,
          fields: computeFields(sim.planes),
          player: playerRef.current,
          tagRangeKm: cfg.tagRangeKm,
          taggableIds: new Set(taggable.map((p) => p.id)),
          onTag: tagById,
        });
      }

      hudAcc += dt;
      if (hudAcc >= 0.3) {
        hudAcc = 0;
        setScores(computeScores(sim.planes, control, TEAMS.map((t) => t.id)));
        setTaggableCount(taggable.length);
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
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        tagNearest();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tagNearest]);

  const me = TEAM_BY_ID[playerTeamId];

  return (
    <>
      <MapView ref={mapRef} />

      <div className="hud hud-top">
        <div className="panel">
          <div className="brand">
            ✈ Flug-Tag <small>sanntid · simulert flydata</small>
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
            {geoStatus} · {taggableCount} fly innen rekkevidde
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
                  {row.planes}✈ {row.airports}⌖
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
          Trykk på et blinkende fly, eller bruk knappen / mellomrom
        </div>
      </div>
    </>
  );
}
