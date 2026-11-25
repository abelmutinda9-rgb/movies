import { vidboltExtract } from "./vidbolt.js";
import { purstreamExtract } from "./purstream.js";
import { tmdb } from "./tmdb.js";

export async function animeExtract(type, tmdbId, season = 1, episode = 1, title = null) {
  try {
    let resolvedId = tmdbId;
    if (!resolvedId && title) {
      try {
        const search = await tmdb(`/search/${type === "movie" ? "movie" : "tv"}`, { query: title });
        resolvedId = search?.results?.[0]?.id;
      } catch (_) {}
    }

    if (!resolvedId) return [];

    // Parallel extraction from high-speed HLS providers that cover Anime
    const [vidboltStreams, purStreams] = await Promise.all([
      vidboltExtract(type, resolvedId, season, episode).catch(() => []),
      purstreamExtract(type, resolvedId, season, episode).catch(() => []),
    ]);

    const out = [];
    for (const s of vidboltStreams) {
      // Discard any iframe or embed URLs; must be true HLS playlist
      if (s.url && !s.url.includes("/embed/")) {
        out.push({
          ...s,
          provider: "anime",
          providerName: `Anime (${s.quality || "1080p"} HLS - Sub/Dub)`,
        });
      }
    }

    for (const s of purStreams) {
      if (s.url && !s.url.includes("/embed/")) {
        out.push({
          ...s,
          provider: "anime",
          providerName: `Anime (Pulse 1080p HLS)`,
        });
      }
    }

    return out;
  } catch (e) {
    console.log("[anime] error:", e.message);
    return [];
  }
}
