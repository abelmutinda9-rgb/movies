import { searchMusic, getLyrics } from "../music.js";
import { generateClientToken, verifyClientToken, expressSecurityMiddleware } from "../security.js";
import { getAllLiveChannels, getLiveCategories, getDirectIptvStreams } from "../livetv.js";
import { getSportsChannels, getLiveMatches } from "../sports.js";
import { animeExtract } from "../anime.js";
import { africanExtract } from "../african.js";
import { Router } from "express";
import { Readable } from "stream";
import { tmdb } from "../tmdb.js";
import { PROVIDERS, childUrl, scrapeAll, upstreamHeaders } from "../providers.js";
import { listPstream, pstreamTasks } from "../pstream.js";
import { movieboxSearch } from "../moviebox.js";
import { streamwishExtractUrl } from "../streamwish.js";
import { voeExtractUrl } from "../voe.js";
import { getSubtitles, srtToVtt } from "../subtitles.js";

const router = Router();

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

router.get("/sources", (_req, res) => {
  res.json({
    custom: PROVIDERS.map(({ id, name }) => ({ id, name })),
    features: {
      music: true,
      syncedLyrics: true,
      endpointSecurity: true,
      sports: true,
      liveChannels: true,
      subtitles: true,
      tmdbFallback: true,
      proxy: true,
      embedResolver: true,
    },
    ...listPstream(),
  });
});

router.get("/search/:type", async (req, res) => {
  const { type } = req.params;
  const { query, page } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });

  try {
    if (type === "multi") {
      res.json(await tmdb("/search/multi", { query, page }));
    } else {
      res.json(await tmdb(`/search/${type}`, { query, page }));
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/trending/:type/:window", async (req, res) => {
  const { type, window } = req.params;
  try {
    res.json(await tmdb(`/trending/${type}/${window}`, { page: req.query.page }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/movie/:id", async (req, res) => {
  try {
    res.json(
      await tmdb(`/movie/${req.params.id}`, {
        append_to_response: "credits,similar,videos",
      }),
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- LIVE TV ENDPOINTS ---
// Categories
const getCategoriesHandler = async (_req, res) => {
  try {
    const categories = await getLiveCategories();
    res.json({ categories });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
router.get("/livetv/categories", getCategoriesHandler);
router.get("/tv/categories", getCategoriesHandler);

// Channels list (Movies, Kids, News, Entertainment, Sports, Docs, International)
const getChannelsHandler = async (req, res) => {
  const { category, subcategory, q } = req.query;
  try {
    const channels = await getAllLiveChannels({ category, subcategory, q });
    res.json({ count: channels.length, category: category || "all", channels });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
router.get("/livetv/channels", getChannelsHandler);
router.get("/tv/channels", getChannelsHandler);

// Direct HLS (.m3u8) Public Streams
const getIptvHandler = async (req, res) => {
  const { country, q, limit } = req.query;
  try {
    const streams = await getDirectIptvStreams({ country, q, limit });
    res.json({ count: streams.length, streams });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
router.get("/livetv/iptv", getIptvHandler);
router.get("/tv/iptv", getIptvHandler);

// Single Live TV Channel info
const getChannelByIdHandler = async (req, res) => {
  const { id } = req.params;
  try {
    const channels = await getAllLiveChannels();
    const ch = channels.find((c) => c.id === id);
    if (!ch) return res.status(404).json({ error: "Channel not found" });
    res.json({ channel: ch });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
router.get("/livetv/channel/:id", getChannelByIdHandler);
router.get("/tv/channel/:id", getChannelByIdHandler);


// --- SECURITY / AUTH ENDPOINTS ---
router.post("/auth/token", (req, res) => {
  const { appId } = req.body || {};
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const token = generateClientToken(appId || "streaming-client", clientIp);
  res.json({ token, expiresIn: 300 });
});

router.get("/auth/verify", (req, res) => {
  const token = req.headers["x-app-token"] || req.query.token;
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const result = verifyClientToken(token, clientIp);
  res.json(result);
});

// Apply optional security check
router.use(expressSecurityMiddleware);

// --- MUSIC & LYRICS ENDPOINTS ---
router.get("/music/search", async (req, res) => {
  const { q, page, limit } = req.query;
  if (!q) return res.status(400).json({ error: "Search query required ('q')" });
  try {
    const data = await searchMusic(q, parseInt(page || "1", 10), parseInt(limit || "20", 10));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/music/lyrics", async (req, res) => {
  const { track, artist, duration, album } = req.query;
  if (!track) return res.status(400).json({ error: "Track name required ('track')" });
  try {
    const dur = parseInt(duration || "0", 10);
    const lyrics = await getLyrics(track, artist || "", dur, album || "");
    res.json(lyrics);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// One-shot search + 320kbps stream + synced lyrics
router.get("/music/play", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Query required ('q')" });
  try {
    const searchRes = await searchMusic(q, 1, 1);
    const song = searchRes.results?.[0];
    if (!song) return res.status(404).json({ error: "Song not found" });

    const lyrics = await getLyrics(song.title, song.artist, song.duration, song.album);
    res.json({
      song,
      lyrics,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/tv/:id", async (req, res) => {
  try {
    res.json(
      await tmdb(`/tv/${req.params.id}`, {
        append_to_response: "credits,similar,videos",
      }),
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/tv/:id/season/:season", async (req, res) => {
  try {
    res.json(await tmdb(`/tv/${req.params.id}/season/${req.params.season}`));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Subtitles endpoints
router.get("/subtitles/movie/:id", async (req, res) => {
  try {
    const subtitles = await getSubtitles("movie", req.params.id);
    res.json({ subtitles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/subtitles/tv/:id/:season/:episode", async (req, res) => {
  const { id, season, episode } = req.params;
  try {
    const subtitles = await getSubtitles("tv", id, Number(season), Number(episode));
    res.json({ subtitles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// VTT subtitle converter / proxy for CORS and player compatibility
router.get("/subtitles/vtt", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("url required");
  if (!isSafeUrl(url)) return res.status(403).send("invalid URL");

  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!upstream.ok) return res.status(upstream.status).send("Failed to fetch subtitle");

    const text = await upstream.text();
    const vtt = srtToVtt(text);
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(vtt);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// Cache for settled streams
const streamCache = new Map();
const CACHE_CAP = 200;

function cacheKey(type, id, season, episode) {
  return `${type}:${id}:${season ?? ""}:${episode ?? ""}`;
}

async function scrape(type, tmdbId, season, episode) {
  const key = cacheKey(type, tmdbId, season, episode);
  if (streamCache.has(key)) return streamCache.get(key);

  const custom = PROVIDERS.filter((p) => p.id !== "anime" && p.id !== "african");
  const pkg = await pstreamTasks(type, tmdbId, season, episode);
  const tasks = [...custom, ...pkg];

  const onSettled = (full) => {
    if (streamCache.size >= CACHE_CAP) {
      const oldest = streamCache.keys().next().value;
      streamCache.delete(oldest);
    }
    if (full.length) streamCache.set(key, full);
  };

  return scrapeAll(type, tmdbId, season, episode, tasks, onSettled);
}

router.get("/stream/movie/:tmdbId", async (req, res) => {
  try {
    const streams = await scrape("movie", req.params.tmdbId);
    res.json({ streams });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/stream/tv/:tmdbId/:season/:episode", async (req, res) => {
  const { tmdbId, season, episode } = req.params;
  try {
    const streams = await scrape("tv", tmdbId, Number(season), Number(episode));
    res.json({ streams });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/stream/anime/:title/:episode", async (req, res) => {
  const { title, episode } = req.params;
  try {
    const streams = await animeExtract("tv", null, 1, episode, title);
    res.json({ streams });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/stream/african/:title", async (req, res) => {
  const { title } = req.params;
  try {
    const streams = await africanExtract("movie", null, 1, 1, title);
    res.json({ streams });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// MovieBox direct search
// Live Football & Sports Matches
router.get("/sports/matches", async (req, res) => {
  const sport = req.query.sport || "football";
  try {
    const matches = await getLiveMatches(sport);
    res.json({ count: matches.length, sport, matches });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 24/7 Live Sports TV Channels (SuperSport, Sky Sports, TNT, etc.)
router.get("/sports/channels", async (req, res) => {
  const filter = req.query.filter || req.query.category || "all";
  try {
    const channels = await getSportsChannels(filter);
    res.json({ count: channels.length, filter, channels });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/moviebox/search", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });
  try {
    const results = await movieboxSearch(query);
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Cinemeta Global CDN Catalog (Zero-key alternative to TMDB)
router.get("/catalog/top/:type", async (req, res) => {
  const type = req.params.type === "tv" || req.params.type === "series" ? "series" : "movie";
  try {
    const upstream = await fetch(`https://cinemeta-catalogs.strem.io/top/catalog/${type}/top.json`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(7000),
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: "Catalog fetch failed" });
    const data = await upstream.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/catalog/search", async (req, res) => {
  const { query, type = "movie" } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });
  const cType = type === "tv" || type === "series" ? "series" : "movie";
  try {
    const upstream = await fetch(
      `https://v3-cinemeta.strem.io/catalog/${cType}/top/search=${encodeURIComponent(query)}.json`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(7000),
      }
    );
    if (!upstream.ok) return res.status(upstream.status).json({ error: "Search failed" });
    const data = await upstream.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Amazon / IMDb public suggestion CDN (Zero-key posters & titles)
router.get("/imdb/search", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });
  try {
    const firstChar = query.trim()[0].toLowerCase();
    const targetUrl = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstChar)}/${encodeURIComponent(query)}.json`;
    const upstream = await fetch(targetUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: "IMDb search failed" });
    const data = await upstream.json();
    const results = (data?.d || []).map((item) => ({
      id: item.id,
      title: item.l,
      type: item.q,
      year: item.y,
      stars: item.s,
      poster: item.i?.imageUrl || null,
      width: item.i?.width || null,
      height: item.i?.height || null,
    }));
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Embed unpacker for StreamWish and VOE links
router.get("/resolve/embed", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    let result = null;
    if (/streamwish|flaswish|sfastwish|strwish/i.test(url)) {
      result = await streamwishExtractUrl(url);
    } else if (/voe\.(sx|net)/i.test(url)) {
      result = await voeExtractUrl(url);
    } else {
      result = (await streamwishExtractUrl(url)) || (await voeExtractUrl(url));
    }
    if (!result) return res.status(404).json({ error: "Could not extract stream from embed" });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const BLOCKED_HEADERS = new Set(["host", "content-length", "connection", "range"]);
const PASS_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges"];
const MAX_CHUNK = 8 * 1024 * 1024;

function parseHeaders(raw) {
  if (!raw) return {};
  try {
    const h = JSON.parse(raw);
    return Object.fromEntries(
      Object.entries(h).filter(
        ([k, v]) => (typeof v === "string" || v === null) && !BLOCKED_HEADERS.has(k.toLowerCase()),
      ),
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

// Proxy endpoint — solves CORS for HLS streams and media
router.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "url required" });

  if (!isSafeUrl(url)) {
    return res.status(403).json({ error: "Access to private or invalid URL denied" });
  }

  const ac = new AbortController();
  res.on("close", () => ac.abort());

  try {
    const headers = upstreamHeaders(url, parseHeaders(req.query.headers));
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), start + MAX_CHUNK - 1) : start + MAX_CHUNK - 1;
      headers.Range = `bytes=${start}-${end}`;
    } else if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const r = await fetch(url, { headers, signal: ac.signal });
    if (!r.ok) return res.status(r.status).end();

    const ct = r.headers.get("content-type") || "";
    res.setHeader("Access-Control-Allow-Origin", "*");

    const reader = r.body?.getReader();
    const first = reader ? await reader.read() : { done: true };
    const head = first.value ? new TextDecoder().decode(first.value.subarray(0, 16)) : "";
    const isPlaylist = ct.includes("mpegurl") || head.trimStart().startsWith("#EXTM3U");

    if (isPlaylist) {
      const chunks = first.value ? [first.value] : [];
      for (let c = await reader.read(); !c.done; c = await reader.read()) chunks.push(c.value);
      let text = new TextDecoder().decode(Buffer.concat(chunks));
      const hostToken = new URL(url).searchParams.get("token");
      const hq = req.query.headers ? `&headers=${encodeURIComponent(req.query.headers)}` : "";
      const wrap = (ref) =>
        `/api/proxy?url=${encodeURIComponent(childUrl(ref, r.url || url, hostToken))}${hq}`;
      text = text
        .replace(/^(?!#)(\S+)$/gm, (line) => wrap(line))
        .replace(/URI="([^"]+)"/g, (_m, ref) => `URI="${wrap(ref)}"`);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.send(text);
    }

    res.status(r.status);
    for (const h of PASS_HEADERS) {
      const v = r.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!ct) res.setHeader("Content-Type", "application/octet-stream");
    if (first.done) return res.end();
    res.write(first.value);
    const rest = new ReadableStream({
      async pull(ctrl) {
        const c = await reader.read();
        c.done ? ctrl.close() : ctrl.enqueue(c.value);
      },
      cancel: () => reader.cancel(),
    });
    Readable.fromWeb(rest).on("error", () => res.destroy()).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else res.destroy();
  }
});

export default router;
