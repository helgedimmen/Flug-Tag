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
import type { Airport, LatLng, Vessel } from "@/lib/types";

export interface TeamField {
  teamId: string;
  polygon: LatLng[];
}

export interface MapUpdate {
  vessels: Vessel[];
  airports: Airport[];
  control: Record<string, string>;
  fields: TeamField[];
  player: LatLng | null;
  tagRangeKm: number;
  taggableIds: Set<string>;
  onTag: (vesselId: string) => void;
}

export interface MapHandle {
  update: (u: MapUpdate) => void;
  /** Pan/zoom the map to the player. */
  recenter: (target: LatLng, zoom?: number) => void;
}

// Distinct silhouettes so planes and boats read at a glance: planes are the
// classic pointed arrow, boats a little hull. Both rotate to their heading.
function vesselIcon(LL: typeof L, v: Vessel, color: string, taggable: boolean) {
  const glyph = v.kind === "plane" ? "▲" : "⬗";
  return LL.divIcon({
    className: `vessel-marker ${v.kind}-marker ${taggable ? "taggable" : ""}`,
    html: `<div class="vessel-icon ${v.kind}-icon" style="color:${color};transform:rotate(${Math.round(v.headingDeg)}deg)">${glyph}</div>`,
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
  const vesselMarkers = useRef<Map<string, L.Marker>>(new Map());
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

      // --- Team fields (area enclosed by a team's tagged vessels) ---
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

      // --- Vessels + trails ---
      const seen = new Set<string>();
      for (const v of u.vessels) {
        seen.add(v.id);
        const color = teamColor(v.teamId);
        const taggable = u.taggableIds.has(v.id);

        // trail
        const latlngs = v.trail.map((t) => [t.lat, t.lon] as [number, number]);
        let line = trailLines.current.get(v.id);
        if (!line) {
          line = LL.polyline(latlngs, { weight: 2, opacity: 0.45 }).addTo(map);
          trailLines.current.set(v.id, line);
        } else {
          line.setLatLngs(latlngs);
        }
        line.setStyle({ color });

        // marker
        let m = vesselMarkers.current.get(v.id);
        if (!m) {
          m = LL.marker([v.lat, v.lon], {
            icon: vesselIcon(LL, v, color, taggable),
          }).addTo(map);
          m.bindTooltip(v.callsign, {
            direction: "top",
            className: "vessel-label",
            offset: [0, -10],
          });
          vesselMarkers.current.set(v.id, m);
        } else {
          m.setLatLng([v.lat, v.lon]);
          m.setIcon(vesselIcon(LL, v, color, taggable));
          m.setTooltipContent(v.callsign);
        }
        // Rebind click each frame so the latest onTag + taggable state apply.
        m.off("click");
        if (taggable) m.on("click", () => u.onTag(v.id));
      }
      // remove vessels that disappeared
      for (const [id, m] of vesselMarkers.current) {
        if (seen.has(id)) continue;
        m.remove();
        vesselMarkers.current.delete(id);
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
          map.setView(ll, 8);
        }
      }
    },
  }));

  return <div ref={elRef} className="map-root" />;
});

export default MapView;
