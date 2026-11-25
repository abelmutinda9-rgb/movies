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

const router = Router();

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

router.get("/sources", (_req, res) => {
  res.json({
    custom: PROVIDERS.map(({ id, name }) => ({ id, name })),
    ...listPstream(),
  });
});

router.get("/search/:type", async (req, res) => {
  const { type } = req.params;
  const { query, page } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });

  if (type === "multi") {
    res.json(await tmdb("/search/multi", { query, page }));
  } else {
    res.json(await tmdb(`/search/${type}`, { query, page }));
  }
});

router.get("/trending/:type/:window", async (req, res) => {
  const { type, window } = req.params;
  res.json(await tmdb(`/trending/${type}/${window}`, { page: req.query.page }));
});

router.get("/movie/:id", async (req, res) => {
  res.json(
    await tmdb(`/movie/${req.params.id}`, {
      append_to_response: "credits,similar,videos",
    }),
  );
});

router.get("/tv/:id", async (req, res) => {
  res.json(
    await tmdb(`/tv/${req.params.id}`, {
      append_to_response: "credits,similar,videos",
    }),
  );
});

router.get("/tv/:id/season/:season", async (req, res) => {
  res.json(await tmdb(`/tv/${req.params.id}/season/${req.params.season}`));
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
