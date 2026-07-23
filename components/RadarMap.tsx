"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

type RadarFrame = { time: number; path: string };

type RadarMapProps = {
  lat: number;
  lon: number;
  label: string;
  unit: "C" | "F";
};

/** Default view: ~20 km diameter at mid-latitudes in the map pane. */
const LOCAL_ZOOM = 11;

function formatSpan(km: number, unit: "C" | "F") {
  if (!Number.isFinite(km) || km <= 0) return unit === "F" ? "~— mi" : "~— km";
  if (unit === "F") {
    const miles = km * 0.621371;
    const rounded = miles >= 100 ? Math.round(miles) : Math.round(miles * 10) / 10;
    return `~${rounded} mi`;
  }
  const rounded = km >= 100 ? Math.round(km) : Math.round(km * 10) / 10;
  return `~${rounded} km`;
}

export default function RadarMap({ lat, lon, label, unit }: RadarMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const radarLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const pendingLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const markerRef = useRef<import("leaflet").CircleMarker | null>(null);
  const swapTokenRef = useRef(0);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [host, setHost] = useState("");
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [spanKm, setSpanKm] = useState(20);
  const [error, setError] = useState("");

  const updateSpan = () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    const center = map.getCenter();
    const widthM = map.distance(
      { lat: center.lat, lng: bounds.getWest() },
      { lat: center.lat, lng: bounds.getEast() },
    );
    const heightM = map.distance(
      { lat: bounds.getNorth(), lng: center.lng },
      { lat: bounds.getSouth(), lng: center.lng },
    );
    setSpanKm(Math.min(widthM, heightM) / 1000);
  };

  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([lat, lon], LOCAL_ZOOM, { animate: true });
    requestAnimationFrame(updateSpan);
  };

  useEffect(() => {
    let cancelled = false;
    fetch("https://api.rainviewer.com/public/weather-maps.json")
      .then((response) => response.json())
      .then((data: { host?: string; radar?: { past?: RadarFrame[]; nowcast?: RadarFrame[] } }) => {
        if (cancelled) return;
        const past = data.radar?.past ?? [];
        const nowcast = data.radar?.nowcast ?? [];
        const nextFrames = [...past, ...nowcast];
        if (!data.host || nextFrames.length === 0) {
          setError("Radar frames unavailable.");
          return;
        }
        setHost(data.host);
        setFrames(nextFrames);
        setFrameIndex(Math.max(0, past.length - 1));
        setError("");
      })
      .catch(() => {
        if (!cancelled) setError("Radar feed unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    let onViewChange: (() => void) | null = null;

    void (async () => {
      const leaflet = await import("leaflet");
      if (disposed || !containerRef.current) return;

      const map = leaflet.map(containerRef.current, {
        center: [lat, lon],
        zoom: LOCAL_ZOOM,
        minZoom: 6,
        maxZoom: 13,
        zoomControl: true,
        attributionControl: true,
      });

      leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      markerRef.current = leaflet.circleMarker([lat, lon], {
        radius: 8,
        color: "#f1d34a",
        weight: 2,
        fillColor: "#e06d35",
        fillOpacity: 0.95,
      }).addTo(map).bindTooltip(label, { permanent: false, direction: "top" });

      onViewChange = () => updateSpan();
      map.on("zoom move zoomend moveend", onViewChange);

      mapRef.current = map;
      setMapReady(true);
      requestAnimationFrame(() => {
        map.invalidateSize();
        updateSpan();
      });
    })();

    return () => {
      disposed = true;
      setMapReady(false);
      pendingLayerRef.current = null;
      if (onViewChange) mapRef.current?.off("zoom move zoomend moveend", onViewChange);
      mapRef.current?.remove();
      mapRef.current = null;
      radarLayerRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setView([lat, lon], LOCAL_ZOOM, { animate: false });
    markerRef.current?.setLatLng([lat, lon]);
    markerRef.current?.bindTooltip(label, { permanent: false, direction: "top" });
    requestAnimationFrame(() => {
      map.invalidateSize();
      updateSpan();
    });
  }, [lat, lon, label, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !host || frames.length === 0) return;

    let cancelled = false;
    const token = ++swapTokenRef.current;

    void (async () => {
      const leaflet = await import("leaflet");
      const frame = frames[Math.min(frameIndex, frames.length - 1)];
      if (!frame || !mapRef.current || cancelled) return;

      if (pendingLayerRef.current) {
        mapRef.current.removeLayer(pendingLayerRef.current);
        pendingLayerRef.current = null;
      }

      const nextLayer = leaflet.tileLayer(`${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
        opacity: 0,
        zIndex: 10,
        maxZoom: 13,
        maxNativeZoom: 7,
        attribution: '<a href="https://www.rainviewer.com/">RainViewer</a>',
      });

      const commit = () => {
        if (cancelled || swapTokenRef.current !== token || !mapRef.current) {
          mapRef.current?.removeLayer(nextLayer);
          return;
        }
        nextLayer.setOpacity(0.7);
        if (radarLayerRef.current && radarLayerRef.current !== nextLayer) {
          mapRef.current.removeLayer(radarLayerRef.current);
        }
        radarLayerRef.current = nextLayer;
        pendingLayerRef.current = null;
      };

      pendingLayerRef.current = nextLayer;
      nextLayer.addTo(mapRef.current);

      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        commit();
      };

      nextLayer.once("load", settle);
      const fallback = window.setTimeout(settle, 900);
      (nextLayer as import("leaflet").TileLayer & { _waterwindFallback?: number })._waterwindFallback = fallback;
    })();

    return () => {
      cancelled = true;
      const pending = pendingLayerRef.current as (import("leaflet").TileLayer & { _waterwindFallback?: number }) | null;
      if (pending?._waterwindFallback) window.clearTimeout(pending._waterwindFallback);
    };
  }, [host, frames, frameIndex, mapReady]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setFrameIndex((index) => (index + 1) % frames.length);
    }, 900);
    return () => window.clearInterval(timer);
  }, [playing, frames.length]);

  const active = frames[Math.min(frameIndex, Math.max(frames.length - 1, 0))];
  const stamp = active
    ? new Date(active.time * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "—";
  const spanLabel = formatSpan(spanKm, unit);

  return (
    <div className="radar-panel">
      <div className="radar-toolbar">
        <button type="button" className="button" onClick={() => setPlaying((value) => !value)} disabled={frames.length < 2}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          className="radar-slider"
          type="range"
          min={0}
          max={Math.max(frames.length - 1, 0)}
          value={Math.min(frameIndex, Math.max(frames.length - 1, 0))}
          onChange={(event) => {
            setPlaying(false);
            setFrameIndex(Number(event.target.value));
          }}
          aria-label="Radar timeline"
          disabled={frames.length < 2}
        />
        <span className="label">{stamp}</span>
        <button
          type="button"
          className="button radar-span"
          onClick={recenter}
          title="Recenter on forecast point"
          aria-label={`Visible span ${spanLabel}. Recenter on forecast point.`}
        >
          <span className="radar-target" aria-hidden="true">⌖</span>
          <span>{spanLabel}</span>
        </button>
      </div>
      <div ref={containerRef} className="radar-map" role="img" aria-label={`Animated radar centered on ${label}`} />
      {error ? <div className="empty">{error}</div> : null}
      <div className="radar-caption">
        RADAR TIMELAPSE / <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RAINVIEWER</a>
        {" · "}MAP / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OPENSTREETMAP</a>
        {" · "}CLICK {spanLabel.toUpperCase()} OR ⌖ TO RECENTER · RECENT OBSERVATIONS, NOT A FORECAST
      </div>
    </div>
  );
}
