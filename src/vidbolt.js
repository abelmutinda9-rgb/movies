const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const BASE = "https://vidbolt.xyz";

export async function vidboltExtract(type, tmdbId, season = 1, episode = 1) {
  try {
    const isTv = type === "tv";
    const target = isTv
      ? `${BASE}/api/resolve?type=tv&id=${tmdbId}&season=${season}&episode=${episode}`
      : `${BASE}/api/resolve?type=movie&id=${tmdbId}`;

    const res = await fetch(target, {
      headers: {
        "User-Agent": UA,
        Referer: `${BASE}/`,
        Origin: BASE,
        Accept: "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(7000),
    });

    if (!res.ok) return [];
    const data = await res.json();
    const streamObj = data?.stream;
    const sources = streamObj?.sources || [];

    const out = [];
    for (const s of sources) {
      if (!s.url) continue;
      out.push({
        url: s.url,
        type: s.kind || "hls",
        quality: s.quality || "1080p",
        provider: "vidbolt",
        providerName: `VidBolt (${s.quality || "1080p"})`,
        headers: {
          "User-Agent": UA,
          Referer: `${BASE}/`,
          Origin: BASE,
        },
      });
    }

    return out;
  } catch (e) {
    console.log("[vidbolt] error:", e.message);
    return [];
  }
}
