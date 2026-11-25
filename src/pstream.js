import {
  makeProviders,
  makeStandardFetcher,
  targets,
} from "../node_modules/@p-stream/providers/src/index.ts";
import { tmdb } from "./tmdb.js";

const providers = makeProviders({
  fetcher: makeStandardFetcher(fetch),
  target: targets.NATIVE,
  consistentIpForRequests: true,
});

// Sources whose backends are gone; skipping them saves a wasted request burst per lookup.
const EXCLUDED = new Map([
  ["mbp-api", "mbp-api.ruixinhong20.workers.dev answers 500 Internal Server Error to every search/details call"],
  ["turbovidSource", "turbovid.eu no longer resolves (NXDOMAIN)"],
  ["rgshows", "api.rgshows.ru is a for-sale page; api.rgshows.me is a parked domain (parklogic redirector)"],
  ["tugaflix", "tugaflix.love is a parked domain (parklogic redirector)"],
  ["wecima", "wecima.tube is a parked domain (parklogic redirector)"],
  ["primewire", "primesrc.me /api/v1/l link lookup requires a Cloudflare Turnstile token (403 cf-mitigated)"],
  ["pelisplushd", "ww3.pelisplus.to serves a self-signed example.com certificate and drops connections"],
  ["zunime", "backend.xaiby.sbs is a parked domain"],
  ["animetsu", "backend.animetsu.to is a parked domain; animetsu.cc no longer resolves"],
]);

const EMBED_TIMEOUT = 10000;
const EMBED_GRACE = 1500;

function collectEmbeds(tasks) {
  return new Promise((resolve) => {
    const out = [];
    let pending = tasks.length;
    let grace = null;
    const done = () => {
      clearTimeout(cap);
      clearTimeout(grace);
      resolve(out.slice());
    };
    const cap = setTimeout(done, EMBED_TIMEOUT);
    for (const task of tasks) {
      task
        .then((streams) => {
          out.push(...streams);
          if (streams.length && !grace) grace = setTimeout(done, EMBED_GRACE);
        })
        .catch(() => {})
        .finally(() => {
          if (--pending === 0) done();
        });
    }
  });
}

async function fallbackMedia(type, tmdbId, season, episode) {
  try {
    const prop = type === "movie" ? "P4947" : "P4983";
    const sparql = `SELECT ?imdb WHERE { ?item wdt:${prop} "${tmdbId}" . ?item wdt:P345 ?imdb }`;
    const wRes = await fetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
      {
        headers: { "User-Agent": "MoviesAPI/1.0" },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!wRes.ok) return null;
    const wData = await wRes.json();
    const imdbId = wData.results?.bindings?.[0]?.imdb?.value;
    if (!imdbId) return null;

    const cType = type === "movie" ? "movie" : "series";
    const cRes = await fetch(`https://v3-cinemeta.strem.io/meta/${cType}/${imdbId}.json`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!cRes.ok) return null;
    const cData = await cRes.json();
    const meta = cData.meta;
    if (!meta) return null;

    const releaseYear = parseInt(meta.year, 10) || new Date().getFullYear();
    if (type === "movie") {
      return {
        type: "movie",
        title: meta.name,
        releaseYear,
        tmdbId: String(tmdbId),
        imdbId,
      };
    }
    const ep = meta.videos?.find(
      (v) => v.season === Number(season) && (v.episode === Number(episode) || v.number === Number(episode)),
    );
    return {
      type: "show",
      title: meta.name,
      releaseYear,
      tmdbId: String(tmdbId),
      imdbId,
      season: { number: Number(season), tmdbId: String(season) },
      episode: { number: Number(episode), tmdbId: ep ? String(ep.id || episode) : String(episode) },
    };
  } catch (e) {
    console.log("[pstream] metadata fallback error:", e.message);
    return null;
  }
}

async function buildMedia(type, tmdbId, season, episode) {
  if (process.env.TMDB_API_KEY) {
    try {
      if (type === "movie") {
        const d = await tmdb(`/movie/${tmdbId}`, { append_to_response: "external_ids" });
        return {
          type: "movie",
          title: d.title,
          releaseYear: new Date(d.release_date).getFullYear(),
          tmdbId: String(d.id),
          imdbId: d.imdb_id || d.external_ids?.imdb_id || undefined,
        };
      }
      const [show, seasonData] = await Promise.all([
        tmdb(`/tv/${tmdbId}`, { append_to_response: "external_ids" }),
        tmdb(`/tv/${tmdbId}/season/${season}`),
      ]);
      const ep = seasonData.episodes?.find((e) => e.episode_number === Number(episode));
      return {
        type: "show",
        title: show.name,
        releaseYear: new Date(show.first_air_date).getFullYear(),
        tmdbId: String(show.id),
        imdbId: show.external_ids?.imdb_id || undefined,
        season: { number: Number(season), tmdbId: String(seasonData.id) },
        episode: { number: Number(episode), tmdbId: ep ? String(ep.id) : String(episode) },
      };
    } catch (e) {
      console.log("[pstream] tmdb error, falling back to Cinemeta:", e.message);
    }
  }

  const fallback = await fallbackMedia(type, tmdbId, season, episode);
  if (fallback) return fallback;
  throw new Error("Could not resolve media metadata (set TMDB_API_KEY or check network)");
}

function convert(stream, id, name) {
  const headers = { ...(stream.preferredHeaders || {}), ...(stream.headers || {}) };
  const base = {
    provider: id,
    providerName: name,
    ...(Object.keys(headers).length ? { headers } : {}),
  };
  if (stream.type === "hls") {
    return [{ ...base, url: stream.playlist, type: "hls" }];
  }
  return Object.entries(stream.qualities || {})
    .filter(([, q]) => q.type === "mp4" && q.url)
    .map(([label, q]) => ({
      ...base,
      url: q.url,
      type: "file",
      quality: `${label}p`,
    }));
}

async function runSource(source, media) {
  const res = await providers.runSourceScraper({ id: source.id, media });
  if (res.stream) {
    return res.stream.flatMap((s) => convert(s, source.id, source.name));
  }
  if (res.embeds?.length) {
    return collectEmbeds(
      res.embeds.map((e) =>
        providers
          .runEmbedScraper({ id: e.embedId, url: e.url })
          .then((s) => convert(s.stream, source.id, `${source.name} (${e.embedId})`))
          .catch(() => []),
      ),
    );
  }
  return [];
}

export function pstreamTasks(type) {
  const mediaType = type === "movie" ? "movie" : "show";
  let mediaP = null;
  return providers
    .listSources()
    .filter((s) => s.mediaTypes?.includes(mediaType) && !EXCLUDED.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      extract: async (type, tmdbId, season, episode) => {
        mediaP ??= buildMedia(type, tmdbId, season, episode);
        try {
          return await runSource(s, await mediaP);
        } catch {
          return [];
        }
      },
    }));
}

export function listPstream() {
  return {
    sources: providers.listSources().filter((s) => !EXCLUDED.has(s.id)),
    embeds: providers.listEmbeds(),
  };
}
