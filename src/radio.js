/**
 * Live Radio Directory & Streaming Module
 * Connects to the Radio Browser global directory (>50,000 public stations)
 */

const BASE_MIRRORS = [
  "https://de1.api.radio-browser.info/json",
  "https://nl1.api.radio-browser.info/json",
  "https://at1.api.radio-browser.info/json",
];

const USER_AGENT = "MoviesLiveRadio/1.0.0 (https://github.com/abelmutinda9-rgb/movies)";

const _cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
  const item = _cache.get(key);
  if (item && Date.now() < item.exp) return item.data;
  return null;
}

function setCached(key, data) {
  _cache.set(key, { data, exp: Date.now() + CACHE_TTL_MS });
}

async function fetchFromMirrors(endpoint) {
  let lastError = null;
  for (const base of BASE_MIRRORS) {
    try {
      const res = await fetch(`${base}${endpoint}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("All Radio Browser mirrors failed");
}

function formatStation(st) {
  return {
    id: st.stationuuid,
    name: st.name?.trim() || "Unknown Station",
    streamUrl: st.url_resolved || st.url,
    homepage: st.homepage || null,
    favicon: st.favicon || null,
    country: st.country || "",
    countryCode: (st.countrycode || "").toUpperCase(),
    language: st.language || "",
    tags: st.tags ? st.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    codec: st.codec || "MP3",
    bitrate: st.bitrate || 128,
    votes: st.votes || 0,
  };
}

/**
 * Get top globally voted live radio stations
 */
export async function getTopRadioStations(limit = 60) {
  const cacheKey = `top:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const data = await fetchFromMirrors(`/stations/topvote/${limit}`);
  const stations = (data || []).filter((s) => s.url_resolved || s.url).map(formatStation);
  setCached(cacheKey, stations);
  return stations;
}

/**
 * Get live radio stations by country (ISO 2-letter code, e.g. KE, ZA, US, GB, NG)
 */
export async function getRadioStationsByCountry(countryCode = "KE", limit = 60) {
  const code = countryCode.toUpperCase();
  const cacheKey = `country:${code}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const data = await fetchFromMirrors(`/stations/bycountrycodeexact/${encodeURIComponent(code)}?limit=${limit}&order=votes&reverse=true`);
  const stations = (data || []).filter((s) => s.url_resolved || s.url).map(formatStation);
  setCached(cacheKey, stations);
  return stations;
}

/**
 * Search live radio stations by name or tag
 */
export async function searchRadioStations(query, limit = 50) {
  if (!query || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  const cacheKey = `search:${q}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const data = await fetchFromMirrors(`/stations/byname/${encodeURIComponent(q)}?limit=${limit}`);
  const stations = (data || []).filter((s) => s.url_resolved || s.url).map(formatStation);
  setCached(cacheKey, stations);
  return stations;
}
