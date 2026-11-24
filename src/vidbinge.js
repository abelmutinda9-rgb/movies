const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://vidbinge.com";

export async function vidbingeExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const path = isTV
      ? `${BASE}/api/tv/${tmdbId}/${season}/${episode}`
      : `${BASE}/api/movie/${tmdbId}`;

    const res = await fetch(path, {
      headers: {
        "User-Agent": UA,
        Referer: `${BASE}/`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];
    const data = await res.json();
    if (!data || !data.sources) return [];

    const streams = [];
    for (const src of data.sources) {
      if (src.url) {
        streams.push({
          url: src.url,
          type: src.type === "hls" || src.url.includes(".m3u8") ? "hls" : "file",
          provider: "vidbinge",
          providerName: `VidBinge ${src.quality || ""}`.trim(),
          headers: { Referer: `${BASE}/`, "User-Agent": UA },
        });
      }
    }
    return streams;
  } catch (e) {
    console.log("[vidbinge] error:", e.message);
    return [];
  }
}
