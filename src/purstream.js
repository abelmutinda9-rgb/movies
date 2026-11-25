import { tmdb } from "./tmdb.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const API = "https://api.purstream.ad/api/v1";

export async function purstreamExtract(type, tmdbId, season = 1, episode = 1) {
  try {
    const isTv = type === "tv";
    let title = "";
    try {
      const meta = await tmdb(isTv ? `/tv/${tmdbId}` : `/movie/${tmdbId}`);
      title = meta?.title || meta?.name || meta?.original_title;
    } catch (_) {}

    if (!title) return [];

    const searchRes = await fetch(`${API}/search-bar/search/${encodeURIComponent(title)}`, {
      headers: { "User-Agent": UA, Referer: "https://purstream.ad/" },
      signal: AbortSignal.timeout(6000),
    });
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const items = searchData?.data?.items?.movies?.items || [];
    const match = items.find((i) => i.type === (isTv ? "tv" : "movie")) || items[0];
    if (!match?.id) return [];

    const streamUrl = isTv
      ? `${API}/stream/${match.id}/episode?season=${season}&episode=${episode}`
      : `${API}/stream/${match.id}`;

    const sRes = await fetch(streamUrl, {
      headers: { "User-Agent": UA, Referer: "https://purstream.ad/" },
      signal: AbortSignal.timeout(6000),
    });
    if (!sRes.ok) return [];
    const sData = await sRes.json();
    const sources = sData?.data?.items?.sources || [];

    return sources
      .filter((s) => s.stream_url)
      .map((s) => ({
        url: s.stream_url,
        type: s.format === "m3u8" ? "hls" : "file",
        quality: "1080p",
        provider: "purstream",
        providerName: `PurStream (${s.source_name || "Pulse 1080p"})`,
        headers: { "User-Agent": UA, Referer: "https://purstream.ad/" },
      }));
  } catch (e) {
    console.log("[purstream] error:", e.message);
    return [];
  }
}
