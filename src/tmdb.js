import { resolveImdbId } from "./subtitles.js";

const BASE = "https://api.themoviedb.org/3";

// Cache for metadata lookups
const metaCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 min cache

function getCached(key) {
  const item = metaCache.get(key);
  if (!item) return null;
  if (Date.now() > item.exp) {
    metaCache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  if (metaCache.size > 500) {
    const oldest = metaCache.keys().next().value;
    metaCache.delete(oldest);
  }
  metaCache.set(key, { data, exp: Date.now() + CACHE_TTL });
}

async function fetchCinemeta(path) {
  const res = await fetch(`https://v3-cinemeta.strem.io${path}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`Cinemeta HTTP ${res.status}`);
  return res.json();
}

async function fallbackMovie(id) {
  const cacheKey = `movie:${id}`;
  const hit = getCached(cacheKey);
  if (hit) return hit;

  const imdbId = await resolveImdbId("movie", id);
  if (!imdbId) throw new Error(`Movie not found for ID ${id}`);

  const data = await fetchCinemeta(`/meta/movie/${imdbId}.json`);
  const meta = data?.meta;
  if (!meta) throw new Error(`No metadata returned for ${imdbId}`);

  const result = {
    id: Number(id) || meta.moviedb_id || 0,
    imdb_id: imdbId,
    title: meta.name,
    original_title: meta.name,
    overview: meta.description || "",
    poster_path: meta.poster || null,
    backdrop_path: meta.background || null,
    release_date: meta.releaseInfo || (meta.year ? `${meta.year}-01-01` : ""),
    runtime: parseInt(meta.runtime, 10) || null,
    vote_average: parseFloat(meta.imdbRating) || 0,
    genres: (meta.genres || meta.genre || []).map((g, i) => ({ id: i + 1, name: g })),
    credits: {
      cast: (meta.cast || []).map((c, i) => ({ id: i + 1, name: c, character: "" })),
      crew: (meta.director || []).map((d, i) => ({ id: i + 100, name: d, job: "Director" })),
    },
    status: "Released",
    videos: {
      results: (meta.trailers || meta.trailerStreams || []).map((t) => ({
        id: t.source || t.ytId,
        key: t.source || t.ytId,
        site: "YouTube",
        type: "Trailer",
      })),
    },
  };

  setCached(cacheKey, result);
  return result;
}

async function fallbackTv(id) {
  const cacheKey = `tv:${id}`;
  const hit = getCached(cacheKey);
  if (hit) return hit;

  const imdbId = await resolveImdbId("tv", id);
  if (!imdbId) throw new Error(`TV show not found for ID ${id}`);

  const data = await fetchCinemeta(`/meta/series/${imdbId}.json`);
  const meta = data?.meta;
  if (!meta) throw new Error(`No metadata returned for ${imdbId}`);

  const seasonsMap = new Map();
  for (const v of meta.videos || []) {
    if (!v.season) continue;
    const s = seasonsMap.get(v.season) || {
      season_number: v.season,
      name: `Season ${v.season}`,
      episode_count: 0,
    };
    s.episode_count++;
    seasonsMap.set(v.season, s);
  }

  const result = {
    id: Number(id) || meta.moviedb_id || 0,
    imdb_id: imdbId,
    name: meta.name,
    original_name: meta.name,
    overview: meta.description || "",
    poster_path: meta.poster || null,
    backdrop_path: meta.background || null,
    first_air_date: meta.releaseInfo || (meta.year ? `${meta.year}-01-01` : ""),
    vote_average: parseFloat(meta.imdbRating) || 0,
    number_of_seasons: seasonsMap.size,
    number_of_episodes: meta.videos?.length || 0,
    seasons: Array.from(seasonsMap.values()).sort((a, b) => a.season_number - b.season_number),
    genres: (meta.genres || meta.genre || []).map((g, i) => ({ id: i + 1, name: g })),
    status: "Returning Series",
  };

  setCached(cacheKey, result);
  return result;
}

async function fallbackSeason(id, seasonNumber) {
  const cacheKey = `tv:${id}:s${seasonNumber}`;
  const hit = getCached(cacheKey);
  if (hit) return hit;

  const imdbId = await resolveImdbId("tv", id);
  if (!imdbId) throw new Error(`TV show not found for ID ${id}`);

  const data = await fetchCinemeta(`/meta/series/${imdbId}.json`);
  const meta = data?.meta;
  if (!meta) throw new Error(`No metadata returned for ${imdbId}`);

  const episodes = (meta.videos || [])
    .filter((v) => v.season === Number(seasonNumber))
    .sort((a, b) => (a.number || a.episode) - (b.number || b.episode))
    .map((v) => ({
      id: v.id,
      season_number: v.season,
      episode_number: v.number || v.episode,
      name: v.name || v.title || `Episode ${v.number || v.episode}`,
      overview: v.description || v.overview || "",
      still_path: v.thumbnail || null,
      air_date: v.released || v.firstAired || null,
      vote_average: parseFloat(v.rating) || 0,
    }));

  const result = {
    id: Number(id) || 0,
    season_number: Number(seasonNumber),
    name: `Season ${seasonNumber}`,
    overview: `Season ${seasonNumber} of ${meta.name}`,
    episodes,
  };

  setCached(cacheKey, result);
  return result;
}

async function fallbackSearch(type, query) {
  const cType = type === "tv" ? "series" : "movie";
  const data = await fetchCinemeta(`/catalog/${cType}/top/search=${encodeURIComponent(query)}.json`);
  const results = (data.metas || []).map((m) => ({
    id: m.moviedb_id || m.id,
    imdb_id: m.imdb_id || m.id,
    title: m.name,
    name: m.name,
    overview: m.description || "",
    poster_path: m.poster || null,
    backdrop_path: m.background || null,
    release_date: m.releaseInfo || m.year || "",
    first_air_date: m.releaseInfo || m.year || "",
    media_type: m.type === "series" ? "tv" : "movie",
  }));
  return { page: 1, results, total_results: results.length, total_pages: 1 };
}

async function fallbackTrending(type) {
  const cType = type === "tv" ? "series" : "movie";
  const data = await fetchCinemeta(`/catalog/${cType}/top.json`);
  const results = (data.metas || []).map((m) => ({
    id: m.moviedb_id || m.id,
    imdb_id: m.imdb_id || m.id,
    title: m.name,
    name: m.name,
    overview: m.description || "",
    poster_path: m.poster || null,
    backdrop_path: m.background || null,
    release_date: m.releaseInfo || m.year || "",
    first_air_date: m.releaseInfo || m.year || "",
    media_type: m.type === "series" ? "tv" : "movie",
  }));
  return { page: 1, results, total_results: results.length, total_pages: 1 };
}

async function fallbackTmdb(path, params = {}) {
  // Movie detail: /movie/:id
  const movieMatch = path.match(/^\/movie\/(\d+|tt\d+)/);
  if (movieMatch) return await fallbackMovie(movieMatch[1]);

  // TV Season: /tv/:id/season/:season
  const seasonMatch = path.match(/^\/tv\/(\d+|tt\d+)\/season\/(\d+)/);
  if (seasonMatch) return await fallbackSeason(seasonMatch[1], seasonMatch[2]);

  // TV detail: /tv/:id
  const tvMatch = path.match(/^\/tv\/(\d+|tt\d+)/);
  if (tvMatch) return await fallbackTv(tvMatch[1]);

  // Search: /search/:type
  if (path.startsWith("/search/")) {
    const type = path.split("/")[2] || "movie";
    return await fallbackSearch(type, params.query || "");
  }

  // Trending: /trending/:type/:window
  if (path.startsWith("/trending/")) {
    const type = path.split("/")[2] || "movie";
    return await fallbackTrending(type);
  }

  throw new Error(`Endpoint not supported in zero-key fallback mode: ${path}`);
}

export async function tmdb(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    return await fallbackTmdb(path, params);
  }

  const url = new URL(BASE + path);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // If official TMDB API fails or quota exceeded, fall back
      return await fallbackTmdb(path, params);
    }
    return await res.json();
  } catch (err) {
    return await fallbackTmdb(path, params);
  }
}
