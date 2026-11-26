import { getAllLiveChannels, getLiveCategories, getDirectIptvStreams } from "./livetv.js";
import { getSportsChannels, getLiveMatches } from "./sports.js";
import { Hono } from "hono";
import { animeExtract } from "./anime.js";
import { africanExtract } from "./african.js";
import { tmdb } from "./tmdb.js";
import { PROVIDERS, childUrl, scrapeAll, upstreamHeaders } from "./providers.js";
import { movieboxSearch } from "./moviebox.js";
import { streamwishExtractUrl } from "./streamwish.js";
import { voeExtractUrl } from "./voe.js";
import { getSubtitles, srtToVtt } from "./subtitles.js";

const app = new Hono();

// Sync Cloudflare Worker environment variables (c.env) into process.env
app.use("*", async (c, next) => {
  if (c.env) {
    globalThis.process = globalThis.process || { env: {} };
    globalThis.process.env = { ...globalThis.process.env, ...c.env };
  }
  await next();
});

// CORS domain locking middleware
app.use("*", async (c, next) => {
  const allowedOrigins = (c.env?.ALLOWED_ORIGINS || (typeof process !== "undefined" && process.env?.ALLOWED_ORIGINS) || "*")
    .split(",")
    .map((o) => o.trim().toLowerCase());
  const origin = c.req.header("Origin");

  if (!origin || allowedOrigins.includes("*") || (origin && allowedOrigins.includes(origin.toLowerCase()))) {
    c.header("Access-Control-Allow-Origin", origin || "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, Range");
    c.header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
  } else if (origin) {
    return c.json({ error: "Origin not allowed by CORS domain policy" }, 403);
  }

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }
  await next();
});

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    runtime: "cloudflare-workers",
    timestamp: new Date().toISOString(),
  });
});

// API Key authentication middleware
app.use("/api/*", async (c, next) => {
  const expectedApiKey = c.env?.API_KEY || (typeof process !== "undefined" && process.env?.API_KEY);
  if (!expectedApiKey) return next();

  const headerKey = c.req.header("x-api-key");
  const authHeader = c.req.header("authorization");
  let bearerKey = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    bearerKey = authHeader.slice(7).trim();
  }
  const queryKey = c.req.query("api_key") || c.req.query("key");
  const providedKey = headerKey || bearerKey || queryKey;

  if (!providedKey || providedKey !== expectedApiKey) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Missing or invalid API key. Provide via 'x-api-key' header, 'Authorization: Bearer <key>', or '?api_key=' parameter.",
      },
      401
    );
  }
  await next();
});

// 1. Sources endpoint
app.get("/api/sources", (c) => {
  return c.json({
    custom: PROVIDERS.map(({ id, name }) => ({ id, name })),
    features: {
      sports: true,
      liveChannels: true,
      subtitles: true,
      tmdbFallback: true,
      proxy: true,
      embedResolver: true,
      cloudflareWorkers: true,
    },
  });
});

// 2. Metadata: Search
app.get("/api/search/:type", async (c) => {
  const type = c.req.param("type");
  const query = c.req.query("query");
  const page = c.req.query("page");
  if (!query) return c.json({ error: "query required" }, 400);

  try {
    if (type === "multi") {
      return c.json(await tmdb("/search/multi", { query, page }));
    }
    return c.json(await tmdb(`/search/${type}`, { query, page }));
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 3. Metadata: Trending
app.get("/api/trending/:type/:window", async (c) => {
  const type = c.req.param("type");
  const window = c.req.param("window");
  try {
    return c.json(await tmdb(`/trending/${type}/${window}`, { page: c.req.query("page") }));
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 4. Metadata: Movie details
app.get("/api/movie/:id", async (c) => {
  try {
    return c.json(
      await tmdb(`/movie/${c.req.param("id")}`, {
        append_to_response: "credits,similar,videos",
      })
    );
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 5. Metadata: TV details
// --- LIVE TV ENDPOINTS ---
// Categories
const wCategoriesHandler = async (c) => {
  try {
    const categories = await getLiveCategories();
    return c.json({ categories });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
};
app.get("/api/livetv/categories", wCategoriesHandler);
app.get("/api/tv/categories", wCategoriesHandler);

// Channels list (Movies, Kids, News, Entertainment, Sports, Docs, International)
const wChannelsHandler = async (c) => {
  const category = c.req.query("category");
  const subcategory = c.req.query("subcategory");
  const q = c.req.query("q");
  try {
    const channels = await getAllLiveChannels({ category, subcategory, q });
    return c.json({ count: channels.length, category: category || "all", channels });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
};
app.get("/api/livetv/channels", wChannelsHandler);
app.get("/api/tv/channels", wChannelsHandler);

// Direct HLS (.m3u8) Public Streams
const wIptvHandler = async (c) => {
  const country = c.req.query("country");
  const q = c.req.query("q");
  const limit = c.req.query("limit");
  try {
    const streams = await getDirectIptvStreams({ country, q, limit });
    return c.json({ count: streams.length, streams });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
};
app.get("/api/livetv/iptv", wIptvHandler);
app.get("/api/tv/iptv", wIptvHandler);

// Single Live TV Channel info
const wChannelByIdHandler = async (c) => {
  const id = c.req.param("id");
  try {
    const channels = await getAllLiveChannels();
    const ch = channels.find((x) => x.id === id);
    if (!ch) return c.json({ error: "Channel not found" }, 404);
    return c.json({ channel: ch });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
};
app.get("/api/livetv/channel/:id", wChannelByIdHandler);
app.get("/api/tv/channel/:id", wChannelByIdHandler);

app.get("/api/tv/:id", async (c) => {
  try {
    return c.json(
      await tmdb(`/tv/${c.req.param("id")}`, {
        append_to_response: "credits,similar,videos",
      })
    );
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 6. Metadata: TV Season details
app.get("/api/tv/:id/season/:season", async (c) => {
  try {
    return c.json(
      await tmdb(`/tv/${c.req.param("id")}/season/${c.req.param("season")}`)
    );
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 7. Subtitles lookup
app.get("/api/subtitles/movie/:id", async (c) => {
  try {
    return c.json(await getSubtitles(c.req.param("id"), "movie"));
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/subtitles/tv/:id/:season/:episode", async (c) => {
  try {
    return c.json(
      await getSubtitles(
        c.req.param("id"),
        "tv",
        c.req.param("season"),
        c.req.param("episode")
      )
    );
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 8. Subtitle SRT to VTT converter
app.get("/api/subtitles/vtt", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "url parameter required" }, 400);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return c.body(null, res.status);
    const srtText = await res.text();
    const vtt = srtToVtt(srtText);
    return new Response(vtt, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 9. Core Streaming Routes
app.get("/api/stream/movie/:tmdbId", async (c) => {
  try {
    const streams = await scrapeAll("movie", c.req.param("tmdbId"));
    return c.json({ count: streams.length, streams });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/stream/tv/:tmdbId/:season/:episode", async (c) => {
  try {
    const streams = await scrapeAll(
      "show",
      c.req.param("tmdbId"),
      c.req.param("season"),
      c.req.param("episode")
    );
    return c.json({ count: streams.length, streams });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/stream/anime/:title/:episode", async (c) => {
  try {
    const streams = await animeExtract(c.req.param("title"), c.req.param("episode"));
    return c.json({ count: streams.length, streams });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/stream/african/:title", async (c) => {
  try {
    const streams = await africanExtract(c.req.param("title"));
    return c.json({ count: streams.length, streams });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 10. MovieBox direct search
// Live Football & Sports Matches
app.get("/api/sports/matches", async (c) => {
  const sport = c.req.query("sport") || "football";
  try {
    const matches = await getLiveMatches(sport);
    return c.json({ count: matches.length, sport, matches });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 24/7 Live Sports TV Channels (SuperSport, Sky Sports, TNT, etc.)
app.get("/api/sports/channels", async (c) => {
  const filter = c.req.query("filter") || c.req.query("category") || "all";
  try {
    const channels = await getSportsChannels(filter);
    return c.json({ count: channels.length, filter, channels });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/moviebox/search", async (c) => {
  const q = c.req.query("q") || c.req.query("query");
  if (!q) return c.json({ error: "query required" }, 400);
  try {
    const results = await movieboxSearch(q);
    return c.json({ count: results.length, results });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 11. Cinemeta Catalog
app.get("/api/catalog/top/:type", async (c) => {
  const type = c.req.param("type") === "series" ? "series" : "movie";
  try {
    const url = `https://v3-cinemeta.strem.io/catalog/${type}/top.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return c.json({ error: "Cinemeta error" }, res.status);
    const data = await res.json();
    return c.json(data);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.get("/api/catalog/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "q parameter required" }, 400);
  try {
    const [moviesRes, seriesRes] = await Promise.allSettled([
      fetch(`https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(q)}.json`, { signal: AbortSignal.timeout(6000) }).then(r => r.json()),
      fetch(`https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(q)}.json`, { signal: AbortSignal.timeout(6000) }).then(r => r.json()),
    ]);
    const movies = moviesRes.status === "fulfilled" ? (moviesRes.value.metas || []) : [];
    const series = seriesRes.status === "fulfilled" ? (seriesRes.value.metas || []) : [];
    return c.json({ query: q, count: movies.length + series.length, movies, series });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 12. IMDb suggestions
app.get("/api/imdb/search", async (c) => {
  const q = c.req.query("q");
  if (!q || q.length < 2) return c.json({ error: "q parameter required (min 2 chars)" }, 400);
  try {
    const prefix = q.trim().toLowerCase().charAt(0);
    const cleanQ = q.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
    const url = `https://v3.sg.media-imdb.com/suggestion/${prefix}/${cleanQ}.json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return c.json({ error: "IMDb suggestion error" }, res.status);
    const data = await res.json();
    return c.json(data);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 13. Embed resolver
app.get("/api/resolve/embed", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "url required" }, 400);
  try {
    let result = null;
    if (url.includes("streamwish")) {
      result = await streamwishExtractUrl(url);
    } else if (url.includes("voe.")) {
      result = await voeExtractUrl(url);
    } else {
      return c.json({ error: "Unsupported embed host" }, 400);
    }
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 14. HLS / Media Proxy for CORS
const BLOCKED_HEADERS = new Set(["host", "content-length", "connection", "range"]);
const PASS_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges"];

function parseHeaders(raw) {
  if (!raw) return {};
  try {
    const h = JSON.parse(raw);
    return Object.fromEntries(
      Object.entries(h).filter(
        ([k, v]) => (typeof v === "string" || v === null) && !BLOCKED_HEADERS.has(k.toLowerCase())
      )
    );
  } catch {
    return {};
  }
}

function isSafeUrl(targetUrl) {
  try {
    const u = new URL(targetUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host.startsWith("127.") ||
      host === "0.0.0.0" ||
      host === "169.254.169.254" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

app.get("/api/proxy", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "url required" }, 400);
  if (!isSafeUrl(url)) return c.json({ error: "Access to private or invalid URL denied" }, 403);

  const rawHeaders = c.req.query("headers");
  const headers = upstreamHeaders(url, parseHeaders(rawHeaders));
  const rangeHeader = c.req.header("range");
  if (rangeHeader) {
    headers.Range = rangeHeader;
  }

  try {
    const r = await fetch(url, { headers });
    if (!r.ok) return c.body(null, r.status);

    const ct = r.headers.get("content-type") || "";
    const isPlaylist = ct.includes("mpegurl") || url.includes(".m3u8");

    if (isPlaylist) {
      let text = await r.text();
      const hostToken = new URL(url).searchParams.get("token");
      const hq = rawHeaders ? `&headers=${encodeURIComponent(rawHeaders)}` : "";
      const wrap = (ref) =>
        `/api/proxy?url=${encodeURIComponent(childUrl(ref, r.url || url, hostToken))}${hq}`;
      text = text
        .replace(/^(?!#)(\S+)$/gm, (line) => wrap(line))
        .replace(/URI="([^"]+)"/g, (_m, ref) => `URI="${wrap(ref)}"`);
      return new Response(text, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    for (const h of PASS_HEADERS) {
      const v = r.headers.get(h);
      if (v) responseHeaders.set(h, v);
    }
    if (!ct) responseHeaders.set("Content-Type", "application/octet-stream");

    return new Response(r.body, {
      status: r.status,
      headers: responseHeaders,
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
