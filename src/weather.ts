// v1.3 Living World: real weather (optional, off until enabled) and seasons/events in the characters' context.
// The only network call in the app: Open-Meteo (free, no key), and only with the Options switch on AND the Me profile
// town shared ("characters can know this"). Cached for 30 minutes; offline falls back to the simulated weather in places.ts.
import { profile } from "./profile";
import type { UserProfile } from "./profile";
import { setLiveWeather, seasonOf } from "./places";
import { setSelfieWorldTag } from "./selfie";
import { addWorldContext, worldCfg, worldKv } from "./world";
import type { WorldCfg } from "./world";
import { eventNotice } from "./seasonal";
import type { Character } from "./types";

export interface Geo { query: string; name: string; lat: number; lon: number; country: string; }
export interface Weather { tempC: number; code: number; isDay: boolean; wind: number; fetchedAt: number; lat: number; place: string; query: string; }
export const WEATHER_KEY = "weather_cache";
export const GEO_KEY = "weather_geo";
export const WEATHER_TTL = 30 * 60_000;     // refetch after 30 min
export const WEATHER_STALE = 3 * 3_600_000;  // still used (offline) up to 3 h old

// WMO weather codes -> words (https://open-meteo.com/en/docs)
const WMO: [number[], string, string, boolean][] = [
  [[0], "\u2600\uFE0F", "clear and sunny", false], [[1], "\u{1F324}\uFE0F", "mostly sunny", false], [[2], "\u26C5", "partly cloudy", false], [[3], "\u2601\uFE0F", "overcast and grey", false],
  [[45, 48], "\u{1F32B}\uFE0F", "foggy", false], [[51, 53, 55, 56, 57], "\u{1F326}\uFE0F", "drizzly", true], [[61, 80], "\u{1F326}\uFE0F", "light rain", true],
  [[63, 81], "\u{1F327}\uFE0F", "rainy", true], [[65, 82], "\u{1F327}\uFE0F", "pouring with rain", true], [[66, 67], "\u{1F327}\uFE0F", "freezing rain", true],
  [[71, 85], "\u{1F328}\uFE0F", "light snow", true], [[73, 75, 77, 86], "\u2744\uFE0F", "snowing", true], [[95, 96, 99], "\u26C8\uFE0F", "thundery", true],
];
export function describeWeather(code: number, isDay = true): { emoji: string; text: string; wet: boolean } {
  const hit = WMO.find(([codes]) => codes.includes(code));
  const [, e, t, wet] = hit ?? [[], "\u2601\uFE0F", "cloudy", false];
  if (!isDay && (code === 0 || code === 1)) return { emoji: "\u{1F319}", text: "clear and starry", wet: false };
  return { emoji: e, text: t, wet };
}
/** Season for the date, flipped in the southern hemisphere. */
export function seasonFor(d: Date, lat?: number): string {
  const s = seasonOf(d);
  if (lat === undefined || lat >= 0) return s;
  return ({ winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" } as Record<string, string>)[s];
}

export const geocodeUrl = (q: string) => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
export const forecastUrl = (lat: number, lon: number) => `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,weather_code,is_day,wind_speed_10m&timezone=auto`;
/** "Exampletown, Somewhere" -> "Exampletown" (the geocoder wants a place name). */
export const placeQuery = (town: string) => town.split(/[,(/]/)[0].trim().slice(0, 80);
export function parseGeo(j: any, query: string): Geo | null {
  const r = j?.results?.[0];
  if (!r || typeof r.latitude !== "number" || typeof r.longitude !== "number") return null;
  return { query, name: String(r.name ?? query), lat: r.latitude, lon: r.longitude, country: String(r.country ?? "") };
}
export function parseForecast(j: any, geo: Geo, now = Date.now()): Weather | null {
  const c = j?.current;
  if (!c || typeof c.temperature_2m !== "number") return null;
  return { tempC: Math.round(c.temperature_2m), code: Number(c.weather_code) || 0, isDay: c.is_day !== 0, wind: Math.round(Number(c.wind_speed_10m) || 0), fetchedAt: now, lat: geo.lat, place: geo.name, query: geo.query };
}
export function weatherAllowed(cfg: Pick<WorldCfg, "weather">, p: UserProfile): string {
  const t = p.fields.town;
  return cfg.weather && t.share && t.value.trim() ? placeQuery(t.value) : "";
}

let current: Weather | null = null;
export const currentWeather = () => current;
export const setWeatherForTest = (w: Weather | null) => { current = w; };
type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<any> }>;
async function getJson(f: Fetch, url: string): Promise<any> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = setTimeout(() => ctl?.abort(), 8000);
  try { const r = await f(url, ctl ? { signal: ctl.signal } : undefined); if (!r.ok) throw new Error("weather service unavailable"); return await r.json(); }
  finally { clearTimeout(t); }
}
/** Refreshes the cached weather (at most every 30 min). Returns the weather in use, or null (off / not shared / offline too long). */
export async function refreshWeather(f: Fetch = (u, i) => fetch(u, i), now = Date.now(), cfg = worldCfg(), p = profile()): Promise<Weather | null> {
  const q = weatherAllowed(cfg, p);
  if (!q) { current = null; return null; }
  const cached = current?.query === q ? current : await worldKv.get<Weather>(WEATHER_KEY).catch(() => null);
  if (cached && cached.query === q && now - cached.fetchedAt < WEATHER_TTL) { current = cached; return current; }
  try {
    let geo = await worldKv.get<Geo>(GEO_KEY).catch(() => null);
    if (!geo || geo.query !== q) {
      geo = parseGeo(await getJson(f, geocodeUrl(q)), q);
      if (!geo) throw new Error(`couldn't find "${q}"`);
      await worldKv.set(GEO_KEY, geo);
    }
    const w = parseForecast(await getJson(f, forecastUrl(geo.lat, geo.lon)), geo, now);
    if (!w) throw new Error("no current weather in the reply");
    current = w;
    await worldKv.set(WEATHER_KEY, w);
    return w;
  } catch (e) {
    console.info("[weather] offline or unavailable, using the last known / simulated weather:", e);
    current = cached && cached.query === q && now - cached.fetchedAt < WEATHER_STALE ? cached : null;
    return current;
  }
}
const fresh = (now: number) => current && now - current.fetchedAt < WEATHER_STALE ? current : null;
export function weatherText(w: Weather): string { const d = describeWeather(w.code, w.isDay); return `${d.text}, ${w.tempC}\u00B0C${w.wind >= 30 ? ", windy" : ""}`; }

/** Context line for prompts: season (+ real weather when on, + a seasonal event). Never names the town. */
export function worldNowLine(user: string, now = new Date(), w = fresh(now.getTime()), together = false): string {
  const season = seasonFor(now, w?.lat);
  const parts = [`It's ${season}.`];
  if (w && !together) parts.push(`The real weather where ${user || "the user"} lives right now: ${weatherText(w)} (you can mention it naturally, e.g. if it's raining).`);
  const ev = worldCfg().seasonal ? eventNotice(now) : "";
  if (ev) parts.push(ev);
  return parts.join(" ");
}
/** Simulated-weather replacement for scene cards (places.ts) while real weather is fresh. */
export function liveWeatherFor(d: Date) {
  const w = fresh(d.getTime());
  if (!w) return null;
  const x = describeWeather(w.code, w.isDay);
  return { emoji: x.emoji, text: x.text, temp: w.tempC, wet: x.wet };
}
const OUTDOOR = /\b(park|garden|beach|street|outside|outdoors|balcony|walk|forest|woods|hill|lake|river|field|market|city|bench|square|seaside|pier|campus|bus stop|patio|terrace)\b/i;
/** Photo tag for outdoor selfies: real weather, or a light season touch. Indoor shots get nothing. */
export function photoWorldTag(where: string, now = new Date(), w = fresh(now.getTime())): string {
  if (!OUTDOOR.test(where)) return "";
  const season = seasonFor(now, w?.lat);
  const s = season === "autumn" ? "autumn leaves" : season === "winter" ? "wintry" : season === "spring" ? "spring blossom" : "summer";
  if (!w) return s;
  const d = describeWeather(w.code, w.isDay);
  const sky = d.wet ? (/snow/.test(d.text) ? "falling snow" : "rainy weather, wet pavement") : /fog/.test(d.text) ? "foggy" : /overcast|cloudy/.test(d.text) ? "overcast sky" : w.isDay ? "sunny" : "";
  return [s, sky].filter(Boolean).join(", ");
}

/** Hooks the live weather into prompts, scene cards and photos (call once at start-up). */
let installed = false;
export function installWeather(userName: () => string) {
  if (installed) return;
  installed = true;
  addWorldContext((_c: Character, now: Date, together: boolean) => worldNowLine(userName(), now, undefined, together));
  setLiveWeather(liveWeatherFor);
  setSelfieWorldTag((where, now) => photoWorldTag(where, now));
}
