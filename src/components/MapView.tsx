"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { airportsCentre } from "@/lib/airports";
import { NEUTRAL_COLOR, teamColor } from "@/lib/teams";
import type { Airport, LatLng, Plane } from "@/lib/types";

export interface TeamField {
  teamId: string;
  polygon: LatLng[];
}

export interface MapUpdate {
  planes: Plane[];
  airports: Airport[];
  control: Record<string, string>;
  fields: TeamField[];
  player: LatLng | null;
  tagRangeKm: number;
  taggableIds: Set<string>;
  onTag: (planeId: string) => void;
}

export interface MapHandle {
  update: (u: MapUpdate) => void;
  /** Pan/zoom the map to the player. */
  recenter: (target: LatLng, zoom?: number) => void;
}

function planeIcon(LL: typeof L, color: string, headingDeg: number, taggable: boolean) {
  return LL.divIcon({
    className: `plane-marker ${taggable ? "taggable" : ""}`,
    html: `<div class="plane-icon" style="color:${color};transform:rotate(${headingDeg}deg)">▲</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

const MapView = forwardRef<MapHandle, object>(function MapView(_props, ref) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const LRef = useRef<typeof L | null>(null);
  const didCenterRef = useRef(false);

  // Persistent layer caches keyed by id so we update in place (smooth) rather
  // than tearing down and rebuilding every frame.
  const planeMarkers = useRef<Map<string, L.Marker>>(new Map());
  const trailLines = useRef<Map<string, L.Polyline>>(new Map());
  const airportMarkers = useRef<Map<string, L.CircleMarker>>(new Map());
  const fieldsLayer = useRef<L.LayerGroup | null>(null);
  const playerMarker = useRef<L.CircleMarker | null>(null);
  const rangeCircle = useRef<L.Circle | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const LL = (await import("leaflet")).default;
      if (cancelled || !elRef.current || mapRef.current) return;
      LRef.current = LL;

      const centre = airportsCentre();
      const map = LL.map(elRef.current, {
        center: [centre.lat, centre.lon],
        zoom: 5,
        zoomControl: false,
        attributionControl: false,
      });
      LL.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
      }).addTo(map);
      fieldsLayer.current = LL.layerGroup().addTo(map);
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    recenter(target, zoom) {
      const map = mapRef.current;
      if (map) map.setView([target.lat, target.lon], zoom ?? map.getZoom());
    },
    update(u) {
      const LL = LRef.current;
      const map = mapRef.current;
      if (!LL || !map) return;

      // --- Airports (territories) ---
      for (const a of u.airports) {
        const owner = u.control[a.id] ?? null;
        const color = owner ? teamColor(owner) : NEUTRAL_COLOR;
        let m = airportMarkers.current.get(a.id);
        if (!m) {
          m = LL.circleMarker([a.lat, a.lon], {
            radius: 7,
            weight: 2,
          }).addTo(map);
          m.bindTooltip(a.id, {
            permanent: true,
            direction: "top",
            className: "airport-label",
            offset: [0, -6],
          });
          airportMarkers.current.set(a.id, m);
        }
        m.setStyle({
          color,
          fillColor: color,
          fillOpacity: owner ? 0.85 : 0.35,
        });
      }

      // --- Team fields (area enclosed by a team's tagged planes) ---
      const fl = fieldsLayer.current!;
      fl.clearLayers();
      for (const f of u.fields) {
        if (f.polygon.length < 3) continue;
        const color = teamColor(f.teamId);
        LL.polygon(
          f.polygon.map((p) => [p.lat, p.lon] as [number, number]),
          { color, weight: 1, opacity: 0.4, fillColor: color, fillOpacity: 0.1 },
        ).addTo(fl);
      }

      // --- Planes + trails ---
      const seen = new Set<string>();
      for (const p of u.planes) {
        seen.add(p.id);
        const color = teamColor(p.teamId);
        const taggable = u.taggableIds.has(p.id);

        // trail
        const latlngs = p.trail.map((t) => [t.lat, t.lon] as [number, number]);
        let line = trailLines.current.get(p.id);
        if (!line) {
          line = LL.polyline(latlngs, { weight: 2, opacity: 0.45 }).addTo(map);
          trailLines.current.set(p.id, line);
        } else {
          line.setLatLngs(latlngs);
        }
        line.setStyle({ color });

        // marker
        let m = planeMarkers.current.get(p.id);
        if (!m) {
          m = LL.marker([p.lat, p.lon], {
            icon: planeIcon(LL, color, p.headingDeg, taggable),
          }).addTo(map);
          planeMarkers.current.set(p.id, m);
        } else {
          m.setLatLng([p.lat, p.lon]);
          m.setIcon(planeIcon(LL, color, p.headingDeg, taggable));
        }
        // Rebind click each frame so the latest onTag + taggable state apply.
        m.off("click");
        if (taggable) m.on("click", () => u.onTag(p.id));
      }
      // remove planes that disappeared
      for (const [id, m] of planeMarkers.current) {
        if (seen.has(id)) continue;
        m.remove();
        planeMarkers.current.delete(id);
        trailLines.current.get(id)?.remove();
        trailLines.current.delete(id);
      }

      // --- Player + tag range ---
      if (u.player) {
        const ll: [number, number] = [u.player.lat, u.player.lon];
        if (!playerMarker.current) {
          playerMarker.current = LL.circleMarker(ll, {
            radius: 6,
            color: "#ffffff",
            weight: 2,
            fillColor: "#ffffff",
            fillOpacity: 1,
          }).addTo(map);
          rangeCircle.current = LL.circle(ll, {
            radius: u.tagRangeKm * 1000,
            color: "#ffffff",
            weight: 1,
            opacity: 0.35,
            fillOpacity: 0.04,
            dashArray: "5 6",
          }).addTo(map);
        } else {
          playerMarker.current.setLatLng(ll);
          rangeCircle.current?.setLatLng(ll);
          rangeCircle.current?.setRadius(u.tagRangeKm * 1000);
        }
        if (!didCenterRef.current) {
          didCenterRef.current = true;
          map.setView(ll, 6);
        }
      }
    },
  }));

  return <div ref={elRef} className="map-root" />;
});

export default MapView;
