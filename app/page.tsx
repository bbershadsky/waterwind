"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const RadarMap = dynamic(() => import("../components/RadarMap"), {
  ssr: false,
  loading: () => <div className="radar-panel"><div className="empty">Loading radar map…</div></div>,
});

type Location = { name: string; lat: number; lon: number };
type Theme = { bg: string; panel: string; ink: string; line: string; accent: string };
type Brief = {
  location: Location;
  nearAbino: boolean;
  current: { temperature: number; feels: number; humidity: number; precipitation: number; condition: string; wind: number; gust: number; direction: number | null; compass: string; cloud: number } | null;
  marine: { height: number | null; period: number | null; compass: string; direction: number | null; waterTemperature: number | null; alignment: string } | null;
  nextHours: Array<{ time: string; temperature: number; rain: number; wind: number; gust: number; compass: string; direction: number | null; condition: string; wave: number | null; period: number | null; waveDirection: number | null; alignment: string }>;
  daily: { time: string[]; sunrise: string[]; sunset: string[]; precipitation_sum: number[]; wind_speed_10m_max: number[]; wind_gusts_10m_max: number[] } | null;
  alerts: Array<{ headline: string; severity: string }>;
  guidance: { rank: string; detail: string };
  buoys: Array<{ label: string; distance: number; wind: number | null; gust: number | null; wave: number | null; water: number | null; updatedMinutes: number | null; direction: number | null }>;
  errors: string[];
};

const DEFAULT_LOCATION: Location = { name: "Abino Bay, Lake Erie", lat: 42.854444, lon: -79.078333 };
const DEFAULT_THEME: Theme = { bg: "#081f28", panel: "#103744", ink: "#e8f0ec", line: "#8faea0", accent: "#e06d35" };
const THEMES: Record<string, Theme> = {
  "deep-water": DEFAULT_THEME,
  "sunken-purple": { bg: "#201735", panel: "#39235c", ink: "#fff7c7", line: "#d4c5ff", accent: "#f1d34a" },
  "night-storm": { bg: "#151827", panel: "#24283a", ink: "#e4e7ee", line: "#a3afc7", accent: "#ee874b" },
};

const money = (value: number | null | undefined, suffix = "") => value === null || value === undefined ? "—" : `${Math.round(value * 10) / 10}${suffix}`;
const hourLabel = (time: string) => new Date(time).toLocaleTimeString([], { hour: "numeric" });
const dayLabel = (time: string) => new Date(`${time}T12:00:00`).toLocaleDateString([], { weekday: "short" });
const arrowStyle = (degrees: number | null | undefined) => degrees === null || degrees === undefined ? undefined : { transform: `rotate(${degrees}deg)` };

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.style.setProperty("--bg", theme.bg);
  root.style.setProperty("--panel", theme.panel);
  root.style.setProperty("--ink", theme.ink);
  root.style.setProperty("--line", theme.line);
  root.style.setProperty("--signal", theme.accent);
}

export default function Home() {
  const [location, setLocation] = useState<Location>(DEFAULT_LOCATION);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [locationDraft, setLocationDraft] = useState(DEFAULT_LOCATION);
  const [themeDraft, setThemeDraft] = useState(DEFAULT_THEME);
  const [clock, setClock] = useState("");
  const [unit, setUnit] = useState<"C" | "F">("C");

  useEffect(() => {
    try {
      const savedLocation = JSON.parse(localStorage.getItem("waterwind.location.v1") ?? "null") as Location | null;
      const savedTheme = JSON.parse(localStorage.getItem("waterwind.theme.v1") ?? "null") as Theme | null;
      const savedUnit = localStorage.getItem("waterwind.unit.v1");
      if (savedLocation) { setLocation(savedLocation); setLocationDraft(savedLocation); }
      if (savedTheme) { setTheme(savedTheme); setThemeDraft(savedTheme); applyTheme(savedTheme); }
      if (savedUnit === "C" || savedUnit === "F") setUnit(savedUnit);
    } catch { /* Invalid local preferences fall back to defaults. */ }
    const updateClock = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/brief?lat=${location.lat}&lon=${location.lon}`)
      .then((response) => response.json())
      .then((data: Brief) => { if (!cancelled) setBrief(data); })
      .catch(() => { if (!cancelled) setBrief({ ...({} as Brief), errors: ["Could not reach the weather service."], nextHours: [], alerts: [], buoys: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [location]);

  const saveSettings = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextLocation = { ...locationDraft, lat: Number(locationDraft.lat), lon: Number(locationDraft.lon) };
    setLocation(nextLocation);
    setTheme(themeDraft);
    applyTheme(themeDraft);
    localStorage.setItem("waterwind.location.v1", JSON.stringify(nextLocation));
    localStorage.setItem("waterwind.theme.v1", JSON.stringify(themeDraft));
    setSettingsOpen(false);
  };
  const useDeviceLocation = () => {
    navigator.geolocation?.getCurrentPosition(({ coords }) => {
      setLocationDraft({ name: "Current location", lat: Number(coords.latitude.toFixed(5)), lon: Number(coords.longitude.toFixed(5)) });
    });
  };
  const formatTemp = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    const converted = unit === "F" ? value * 9 / 5 + 32 : value;
    return `${Math.round(converted * 10) / 10}°${unit}`;
  };
  const formatWind = (value: number | null | undefined) => money(value === null || value === undefined ? value : unit === "F" ? value * 0.621371 : value, unit === "F" ? " mph" : " km/h");
  const formatWave = (value: number | null | undefined) => money(value === null || value === undefined ? value : unit === "F" ? value * 3.28084 : value, unit === "F" ? " ft" : " m");
  const formatRain = (value: number | null | undefined) => money(value === null || value === undefined ? value : unit === "F" ? value * 0.0393701 : value, unit === "F" ? " in" : " mm");
  const guidanceText = brief?.guidance?.rank === "DANGEROUS"
    ? `31+ ${unit === "F" ? "mph" : "km/h"} wind or ${unit === "F" ? "4.9+ ft" : "1.5+ m"} waves. High risk on exposed water; seek shelter immediately.`
    : brief?.guidance?.rank === "DEMANDING"
      ? `13–30 ${unit === "F" ? "mph" : "km/h"} wind or ${unit === "F" ? "1.6–4.9 ft" : "0.5–1.5 m"} waves. Challenging surface conditions; watch cross waves.`
      : `0–12 ${unit === "F" ? "mph" : "km/h"} wind and waves under ${unit === "F" ? "1.6 ft" : "0.5 m"}. Calm surface conditions.`;
  const toggleUnit = () => {
    const nextUnit = unit === "C" ? "F" : "C";
    setUnit(nextUnit);
    localStorage.setItem("waterwind.unit.v1", nextUnit);
  };
  const chartData = useMemo(() => (brief?.nextHours ?? []).map((hour) => ({
    ...hour,
    label: hourLabel(hour.time),
    wind: Math.round((unit === "F" ? hour.wind * 0.621371 : hour.wind) * 10) / 10,
    gust: Math.round((unit === "F" ? hour.gust * 0.621371 : hour.gust) * 10) / 10,
    wave: Math.round((unit === "F" ? (hour.wave ?? 0) * 3.28084 : hour.wave ?? 0) * 10) / 10,
    rain: Math.round(hour.rain),
  })), [brief, unit]);
  const hourCount = brief?.nextHours?.length ?? 0;

  if (loading && !brief) return <main className="loading">Reading the water…</main>;
  const current = brief?.current;
  const rank = brief?.guidance?.rank.toLowerCase() ?? "good";

  return (
    <main className="app-shell">
      <div className="wrap">
        <header className="topbar">
          <div>
            <div className="eyebrow">WATERWIND / LIVE MARINE BOARD</div>
            <h1>{location.name}</h1>
            <div className="location-name">{clock} local · {location.lat.toFixed(4)}°, {location.lon.toFixed(4)}°</div>
          </div>
          <div className="controls">
            <button className="unit-toggle" aria-label={`Switch to degrees ${unit === "C" ? "Fahrenheit" : "Celsius"}`} aria-pressed={unit === "F"} onClick={toggleUnit}><span className={unit === "C" ? "active" : ""}>°C</span><span className={unit === "F" ? "active" : ""}>°F</span></button>
            <button className="button" onClick={() => { setLocationDraft(location); setThemeDraft(theme); setSettingsOpen(true); }}>Settings</button>
          </div>
        </header>

        {brief?.errors?.length ? <div className="error">FEED NOTES: {brief.errors.join(" · ")}</div> : null}
        <section className="hero" aria-label="Current conditions">
          <div className="hero-main">
            <div className="label">Now / {current?.condition ?? "Unavailable"}</div>
            <div className="temp">{formatTemp(current?.temperature)}</div>
            <div className="condition">Feels {formatTemp(current?.feels)} · {current?.condition}</div>
          </div>
          <div className="hero-stats">
            <div><div className="label">Wind direction</div><div className="stat-value"><span className="direction-arrow" style={arrowStyle(current?.direction)}>↑</span> {formatWind(current?.wind)} <small>{current?.compass}</small></div></div>
            <div><div className="label">Gusts</div><div className="stat-value">{formatWind(current?.gust)}</div></div>
            <div><div className="label">Humidity</div><div className="stat-value">{money(current?.humidity, "%")}</div></div>
            <div><div className="label">Rain now</div><div className="stat-value">{formatRain(current?.precipitation)}</div></div>
            <div><div className="label">Cloud</div><div className="stat-value">{money(current?.cloud, "%")}</div></div>
            <div><div className="label">Wave / period</div><div className="stat-value"><span className="direction-arrow wave-arrow" style={arrowStyle(brief?.marine?.direction)}>↑</span> {formatWave(brief?.marine?.height)} <small>/ {money(brief?.marine?.period, " s")}</small></div></div>
            <div><div className="label">Water temperature</div><div className="stat-value">{formatTemp(brief?.marine?.waterTemperature)}</div></div>
          </div>
          <div className={`rating ${rank}`} aria-label={`Water rating ${brief?.guidance?.rank}`}>
            <div><div className="label">Water call / wind + wave</div><div className="rating-word">{brief?.guidance?.rank ?? "—"}</div></div>
            <div className="rating-detail">{guidanceText}</div>
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2>Next {hourCount || 12} hours</h2><span className="label">gusts · wave period · alignment · {unit === "F" ? "mph · ft · in" : "km/h · m · mm"}</span></div>
          <div className="hours">
            {(brief?.nextHours ?? []).map((hour) => <article className="hour" key={hour.time}>
              <div className="hour-time">{hourLabel(hour.time)}</div>
              <div className="hour-temp"><span className="direction-arrow" style={arrowStyle(hour.direction)}>↑</span> {money(hour.gust)}<small>GUST</small></div>
              <div className="hour-sky">{hour.condition} · {formatTemp(hour.temperature)}</div>
              <div className="hour-meta"><span>WIND {formatWind(hour.wind)} {hour.compass}</span><span>RAIN {money(hour.rain, "%")}</span><span>WAVE {formatWave(hour.wave)} / {money(hour.period, " s")}</span><span className={`alignment ${hour.alignment}`}>{hour.alignment}</span></div>
            </article>)}
          </div>
          {chartData.length ? <div className="chart-box"><div className="chart-title">Safety graph / next {hourCount} hours · wind and gusts</div><ResponsiveContainer width="100%" height={220}><ComposedChart data={chartData} margin={{ top: 12, right: 8, left: -22, bottom: 0 }}><CartesianGrid stroke="var(--line)" opacity={.3} vertical={false} /><XAxis dataKey="label" stroke="var(--muted)" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={8} /><YAxis yAxisId="wind" stroke="var(--muted)" tick={{ fontSize: 9 }} /><YAxis yAxisId="rain" orientation="right" stroke="var(--signal)" tick={{ fontSize: 9 }} domain={[0, 100]} /><Tooltip contentStyle={{ background: "var(--bg)", border: "2px solid var(--line)", fontSize: 11 }} formatter={(value: number | string, name: string) => {
            const number = typeof value === "number" ? value : Number(value);
            if (!Number.isFinite(number)) return ["—", name];
            if (name.startsWith("rain")) return [`${Math.round(number)}%`, name];
            return [`${Math.round(number * 10) / 10}`, name];
          }} labelFormatter={(label) => String(label)} /><Line yAxisId="wind" type="monotone" dataKey="wind" stroke="var(--good)" strokeWidth={3} dot={{ r: 3, fill: "var(--good)" }} name={`wind ${unit === "F" ? "mph" : "km/h"}`} /><Line yAxisId="wind" type="monotone" dataKey="gust" stroke="var(--ink)" strokeWidth={3} strokeDasharray="4 3" dot={false} name={`gust ${unit === "F" ? "mph" : "km/h"}`} /><Line yAxisId="wind" type="monotone" dataKey="wave" stroke="var(--signal)" strokeWidth={2} dot={{ r: 2 }} name={`wave ${unit === "F" ? "ft" : "m"}`} /><Bar yAxisId="rain" dataKey="rain" fill="var(--signal)" opacity={.55} name="rain %" /></ComposedChart></ResponsiveContainer></div> : <div className="empty">Hourly feed unavailable.</div>}
        </section>
        <section className="section">
          <div className="section-head"><h2>Radar / recent precipitation</h2><span className="label">timelapse · centered on pin</span></div>
          <RadarMap lat={location.lat} lon={location.lon} label={location.name} unit={unit} />
        </section>

        {brief?.alerts?.length ? <section className="section"><div className="panel alerts"><div className="label">Active alerts / local feed</div>{brief.alerts.map((alert, index) => <div className="alert-row" key={`${alert.headline}-${index}`}><span>{alert.headline}</span><span className="label">{alert.severity}</span></div>)}</div></section> : null}

        <section className="section lower-grid">
          <div className="panel"><div className="section-head"><h2>Day ahead</h2><span className="label">model outlook</span></div>
            <div className="daily-head" aria-hidden="true"><span>Day</span><span>Rain</span><span>Wind</span><span>Gust</span></div>
            {brief?.daily?.time?.map((day, index) => <div className="daily-row" key={day}><strong>{dayLabel(day)}</strong><span>{formatRain(brief.daily?.precipitation_sum[index])}</span><span>{formatWind(brief.daily?.wind_speed_10m_max[index])}</span><span>{formatWind(brief.daily?.wind_gusts_10m_max[index])}</span></div>)}
          </div>
          <div className="panel"><div className="section-head"><h2>{brief?.nearAbino ? "Nearby buoys" : "Marine readout"}</h2><span className="label">{brief?.nearAbino ? "live stations" : "open-meteo"}</span></div>
            {brief?.buoys?.length ? <>
              <div className="buoy-head" aria-hidden="true"><span>Station</span><span>Dir</span><span>Wind</span><span>Gust</span><span>Wave / water</span></div>
              {brief.buoys.map((buoy) => <div className="buoy-row" key={buoy.label}><strong>{buoy.label}<small className="buoy-age">updated {buoy.updatedMinutes === null ? "—" : `${buoy.updatedMinutes} min ago`}</small></strong><span className="buoy-dir"><span className="direction-arrow" style={arrowStyle(buoy.direction)}>↑</span></span><span>{formatWind(buoy.wind)}</span><span>{formatWind(buoy.gust)}</span><span>{formatWave(buoy.wave)} / {formatTemp(buoy.water)}</span></div>)}
            </> : <div className="empty">Wave {formatWave(brief?.marine?.height)} · period {money(brief?.marine?.period, " s")} · water {formatTemp(brief?.marine?.waterTemperature)} · {brief?.marine?.alignment ?? "alignment unavailable"}.</div>}
          </div>
        </section>
        <footer className="sourcebar">SOURCES / <a href="https://open-meteo.com/" target="_blank">OPEN-METEO</a> · <a href="https://weather.gc.ca/" target="_blank">ENVIRONMENT CANADA</a> · <a href="https://www.ndbc.noaa.gov/" target="_blank">NDBC</a></footer>
      </div>

      {settingsOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="section-head"><h2 id="settings-title">Board settings</h2><button className="button" onClick={() => setSettingsOpen(false)}>Close</button></div>
        <form onSubmit={saveSettings}>
          <div className="label">Preferred location</div>
          <label className="field"><span className="label">Name</span><input value={locationDraft.name} onChange={(event) => setLocationDraft({ ...locationDraft, name: event.target.value })} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><label className="field"><span className="label">Latitude</span><input type="number" step="any" required value={locationDraft.lat} onChange={(event) => setLocationDraft({ ...locationDraft, lat: Number(event.target.value) })} /></label><label className="field"><span className="label">Longitude</span><input type="number" step="any" required value={locationDraft.lon} onChange={(event) => setLocationDraft({ ...locationDraft, lon: Number(event.target.value) })} /></label></div>
          <button type="button" className="button" onClick={useDeviceLocation}>Use device location</button>
          <div className="label">Color theme / saved on this device</div>
          <div className="theme-swatches">{Object.entries(THEMES).map(([name, colors]) => <button type="button" className={`swatch ${themeDraft.bg === colors.bg ? "active" : ""}`} style={{ background: colors.bg, color: colors.ink, borderColor: colors.line }} key={name} onClick={() => setThemeDraft(colors)}>{name}</button>)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}><label className="field"><span className="label">Background</span><input type="color" value={themeDraft.bg} onChange={(event) => setThemeDraft({ ...themeDraft, bg: event.target.value })} /></label><label className="field"><span className="label">Panel</span><input type="color" value={themeDraft.panel} onChange={(event) => setThemeDraft({ ...themeDraft, panel: event.target.value })} /></label><label className="field"><span className="label">Accent</span><input type="color" value={themeDraft.accent} onChange={(event) => setThemeDraft({ ...themeDraft, accent: event.target.value })} /></label></div>
          <div className="modal-actions"><button type="button" className="button" onClick={() => { setThemeDraft(DEFAULT_THEME); applyTheme(DEFAULT_THEME); }}>Default colors</button><button type="submit" className="button">Save board</button></div>
        </form>
      </section></div> : null}
    </main>
  );
}
