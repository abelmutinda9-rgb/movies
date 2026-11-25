const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const BASE = "https://api.framextv.cc";

export async function framexExtract(type, tmdbId, season = 1, episode = 1) {
  try {
    const isTv = type === "tv";
    const q = isTv
      ? `type=tv&id=${tmdbId}&season=${season}&episode=${episode}&codecs=hevc`
      : `type=movie&id=${tmdbId}&codecs=hevc`;

    const res = await fetch(`${BASE}/api/stream?${q}`, {
      headers: {
        "User-Agent": UA,
        Referer: "https://framextv.cc/",
        Origin: "https://framextv.cc",
        Accept: "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(7000),
    });

    if (!res.ok) return [];
    const data = await res.json();
    if (!data?.success || !Array.isArray(data?.sources)) return [];

    const out = [];
    const seen = new Set();

    for (const s of data.sources) {
      if (!s.url || typeof s.url !== "string" || seen.has(s.url)) continue;
      // Guarantee no embed iframe URLs: must look like an HLS/media link or API proxy
      if (s.url.includes("/embed/") || s.url.includes("<iframe")) continue;
      seen.add(s.url);

      const quality = s.quality ? `${s.quality}` : "1080p";
      const isFile = s.type === "file" || /\.mp4(\?|$)/i.test(s.url);

      out.push({
        url: s.url,
        type: isFile ? "file" : "hls",
        quality,
        provider: "framex",
        providerName: `FrameX (${quality} ${isFile ? "MP4" : "HLS"})`,
        headers: {
          "User-Agent": UA,
          Referer: "https://framextv.cc/",
          Origin: "https://framextv.cc",
        },
      });
    }

    return out;
  } catch (e) {
    console.log("[framex] error:", e.message);
    return [];
  }
}
