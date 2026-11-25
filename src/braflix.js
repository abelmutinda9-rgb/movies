const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const BASE = "https://braflix.dev";

export async function braflixExtract(type, tmdbId, season = 1, episode = 1) {
  try {
    const isTv = type === "tv";
    const target = isTv
      ? `${BASE}/api/play/tv/${tmdbId}/${season}/${episode}`
      : `${BASE}/api/play/movie/${tmdbId}`;

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
    if (data?.status !== "ready") return [];

    const raw = data?.result?.file?.stream;
    if (!raw || typeof raw !== "string") return [];

    let streamUrl = raw;
    if (raw.includes("url=")) {
      const parsed = new URL(raw, BASE);
      streamUrl = decodeURIComponent(parsed.searchParams.get("url") || raw);
    }

    const quality = data?.result?.source?.quality || "1080p";
    return [
      {
        url: streamUrl,
        type: "file",
        quality,
        provider: "braflix",
        providerName: `BraFlix (${quality} MP4)`,
        headers: {
          "User-Agent": UA,
          Referer: `${BASE}/`,
        },
      },
    ];
  } catch (e) {
    console.log("[braflix] error:", e.message);
    return [];
  }
}
