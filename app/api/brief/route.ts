import { NextRequest, NextResponse } from "next/server";

const ABINO = { lat: 42.854444, lon: -79.078333 };
const DISTANCE_LIMIT_KM = 80;

function distanceKm(lat: number, lon: number) {
  const rad = Math.PI / 180;
  const a = Math.sin((lat - ABINO.lat) * rad / 2) ** 2
    + Math.cos(ABINO.lat * rad) * Math.cos(lat * rad) * Math.sin((lon - ABINO.lon) * rad / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function compass(degrees: number | null) {
  if (degrees === null || Number.isNaN(degrees)) return "—";
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.floor(((degrees % 360) + 11.25) / 22.5) % 16];
}

function directionRelationship(wind: number | null, wave: number | null) {
  if (wind === null || wave === null) return "alignment unavailable";
  const difference = Math.abs(((wind - wave + 540) % 360) - 180);
  if (difference >= 135) return "opposing";
  if (difference <= 45) return "aligned";
  return "crossing";
}

function sky(code: number | null) {
  const labels: Record<number, string> = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog", 51: "Drizzle", 53: "Drizzle", 55: "Dense drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Showers", 81: "Showers", 82: "Heavy showers", 95: "Thunderstorm", 96: "Thunderstorm + hail", 99: "Thunderstorm + hail" };
  return code === null ? "Unavailable" : labels[code] ?? `WMO ${code}`;
}

async function json(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "Waterwind/1.0" }, signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function buoy(id: string, label: string, distance: number) {
  const response = await fetch(`https://www.ndbc.noaa.gov/data/realtime2/${id}.txt`, { headers: { "User-Agent": "Waterwind/1.0" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`NDBC ${id}: ${response.status}`);
  const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
  const row = lines[2]?.trim().split(/\s+/) ?? [];
  const value = (index: number) => row[index] && row[index] !== "MM" ? Number(row[index]) : null;
  const ms = value(6);
  const gust = value(7);
  const observedAt = row.length ? new Date(Date.UTC(Number(row[0]), Number(row[1]) - 1, Number(row[2]), Number(row[3]), Number(row[4]))) : null;
  const updatedMinutes = observedAt && !Number.isNaN(observedAt.getTime()) ? Math.max(0, Math.round((Date.now() - observedAt.getTime()) / 60000)) : null;
  return { id, label, distance, observed: observedAt ? `${row[0]}-${row[1]}-${row[2]} ${row[3]}:${row[4]} UTC` : "—", observedAt: observedAt?.toISOString() ?? null, updatedMinutes, wind: ms === null ? null : Math.round(ms * 3.6 * 10) / 10, gust: gust === null ? null : Math.round(gust * 3.6 * 10) / 10, wave: value(8), period: value(9), air: value(13), water: value(14), direction: value(5) };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat") ?? ABINO.lat);
  const lon = Number(params.get("lon") ?? ABINO.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const timezone = "UTC";
  const nearAbino = distanceKm(lat, lon) <= DISTANCE_LIMIT_KM;
  const errors: string[] = [];
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code&daily=sunrise,sunset,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max&forecast_days=5&timezone=${timezone}&wind_speed_unit=kmh`;
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_direction,wave_period,wind_wave_height,sea_surface_temperature&hourly=wave_height,wave_direction,wave_period,wind_wave_height,sea_surface_temperature&forecast_days=5&timezone=${timezone}&length_unit=metric&cell_selection=sea`;

  const [wxResult, marineResult, alertsResult] = await Promise.allSettled([
    json(forecastUrl),
    json(marineUrl),
    json(`https://api.weather.gc.ca/collections/weather-alerts/items?f=json&bbox=${lon - 0.35},${lat - 0.25},${lon + 0.35},${lat + 0.25}&limit=25`),
  ]);
  const wx = wxResult.status === "fulfilled" ? wxResult.value : null;
  const marine = marineResult.status === "fulfilled" ? marineResult.value : null;
  const alertDoc = alertsResult.status === "fulfilled" ? alertsResult.value : null;
  if (!wx) errors.push("Forecast unavailable");
  if (!marine) errors.push("Marine forecast unavailable");
  if (!alertDoc) errors.push("Weather alerts unavailable");

  const toUtcMs = (value: string) => {
    if (!value) return Number.NaN;
    if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) return Date.parse(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00Z`);
    return Date.parse(value.includes("T") ? `${value}Z` : `${value}:00Z`);
  };

  const now = wx?.current;
  const current = now ? { time: now.time, temperature: now.temperature_2m, feels: now.apparent_temperature, humidity: now.relative_humidity_2m, precipitation: now.precipitation, cloud: now.cloud_cover, code: now.weather_code, condition: sky(now.weather_code), wind: now.wind_speed_10m, direction: now.wind_direction_10m, compass: compass(now.wind_direction_10m), gust: now.wind_gusts_10m } : null;
  const marineCurrent = marine?.current ? { height: marine.current.wave_height, direction: marine.current.wave_direction, compass: compass(marine.current.wave_direction), period: marine.current.wave_period, windWave: marine.current.wind_wave_height, waterTemperature: marine.current.sea_surface_temperature, alignment: directionRelationship(now?.wind_direction_10m ?? null, marine.current.wave_direction) } : null;
  const nextHours = (wx?.hourly?.time ?? []).map((time: string, index: number) => {
    const marineIndex = marine?.hourly?.time?.indexOf(time) ?? -1;
    return { time: time.includes("T") && !/Z$|[+-]\d{2}:\d{2}$/.test(time) ? `${time}Z` : time, temperature: wx.hourly.temperature_2m[index], rain: wx.hourly.precipitation_probability[index], precipitation: wx.hourly.precipitation[index], wind: wx.hourly.wind_speed_10m[index], gust: wx.hourly.wind_gusts_10m[index], direction: wx.hourly.wind_direction_10m[index], compass: compass(wx.hourly.wind_direction_10m[index]), code: wx.hourly.weather_code[index], condition: sky(wx.hourly.weather_code[index]), wave: marineIndex >= 0 ? marine.hourly.wave_height[marineIndex] : null, period: marineIndex >= 0 ? marine.hourly.wave_period[marineIndex] : null, waveDirection: marineIndex >= 0 ? marine.hourly.wave_direction[marineIndex] : null, alignment: marineIndex >= 0 ? directionRelationship(wx.hourly.wind_direction_10m[index], marine.hourly.wave_direction[marineIndex]) : "alignment unavailable" };
  }).filter((hour: { time: string }) => toUtcMs(hour.time) >= Date.now() - 30 * 60_000).slice(0, 12);
  const alerts = (alertDoc?.features ?? []).map((feature: { properties?: Record<string, unknown> }) => feature.properties ?? {}).map((item: Record<string, unknown>) => ({ headline: String(item.headline ?? item.name ?? "Weather alert"), severity: String(item.severity ?? "alert") }));
  const rawWind = Math.max(current?.wind ?? 0, current?.gust ?? 0);
  const rawWave = marineCurrent?.height ?? Math.max(...nextHours.map((hour: { wave: number | null }) => hour.wave ?? 0), 0);
  const warning = alerts.some((alert: { headline: string }) => /marine|thunder|warning|storm/i.test(alert.headline));
  const guidance = warning || rawWind >= 31 || rawWave >= 1.5 ? { rank: "DANGEROUS", detail: "31+ km/h wind or 1.5+ m waves. High risk on exposed water; seek shelter immediately." } : rawWind >= 13 || rawWave >= 0.5 ? { rank: "DEMANDING", detail: "13–30 km/h wind or 0.5–1.5 m waves. Challenging surface conditions; watch cross waves." } : { rank: "IDEAL", detail: "0–12 km/h wind and waves under 0.5 m. Calm surface conditions." };

  let buoys: unknown[] = [];
  let marineEc: unknown = null;
  if (nearAbino) {
    const buoyResults = await Promise.allSettled([buoy("45142", "Port Colborne", 21.5), buoy("4403586", "Buffalo nearshore", 14.2)]);
    buoys = buoyResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    try {
      const doc = await json("https://api.weather.gc.ca/collections/marineweather-realtime/items/m0000052?f=json");
      marineEc = doc.properties ?? null;
    } catch {
      errors.push("Environment Canada marine unavailable");
    }
  }

  const buoyWaterTemperature = (buoys as Array<{ water: number | null }>).find((item) => item.water !== null)?.water ?? null;
  return NextResponse.json({ location: { lat, lon }, nearAbino, current, marine: marineCurrent ? { ...marineCurrent, waterTemperature: buoyWaterTemperature ?? marineCurrent.waterTemperature } : null, nextHours, daily: wx?.daily ?? null, alerts, guidance, buoys, marineEc, errors }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
