const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://embed.su";

export async function embedsuExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const embedUrl = isTV
      ? 
      : ;

    const res = await fetch(embedUrl, {
      headers: {
        "User-Agent": UA,
        Referer: "https://google.com/",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];
    const html = await res.text();

    const hashMatch = html.match(/data-hash="([^"]+)"/) || html.match(/"hash":\s*"([^"]+)"/);
    if (!hashMatch) {
      const playlistMatch = html.match(/(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/i);
      if (playlistMatch) {
        return [
          {
            url: playlistMatch[1],
            type: "hls",
            provider: "embedsu",
            providerName: "EmbedSu",
            headers: { Referer: BASE + "/", "User-Agent": UA },
          },
        ];
      }
      return [];
    }

    const hash = hashMatch[1];
    const apiRes = await fetch(, {
      headers: {
        "User-Agent": UA,
        Referer: embedUrl,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!apiRes.ok) return [];
    const data = await apiRes.json();
    const sourceList = Array.isArray(data.source) ? data.source : (data.sources || []);

    const streams = [];
    for (const s of sourceList) {
      if (s.file || s.url) {
        const streamUrl = s.file || s.url;
        streams.push({
          url: streamUrl,
          type: streamUrl.includes(".m3u8") ? "hls" : "file",
          provider: "embedsu",
          providerName: ,
          headers: { Referer: BASE + "/", "User-Agent": UA },
        });
      }
    }
    return streams;
  } catch (e) {
    console.log("[embedsu] error:", e.message);
    return [];
  }
}
