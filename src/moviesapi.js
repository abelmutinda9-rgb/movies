const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function moviesapiExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const embedUrl = isTV
      ? `https://moviesapi.club/tv/${tmdbId}-${season}-${episode}`
      : `https://moviesapi.club/movie/${tmdbId}`;

    const headers = {
      "User-Agent": UA,
      Referer: "https://moviesapi.club/",
    };

    const res = await fetch(embedUrl, { headers });
    if (!res.ok) return [];

    const html = await res.text();
    const streamMatch = html.match(/(?:file|source|src)\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
    const iframeMatch = html.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);

    const results = [];
    if (streamMatch && streamMatch[1]) {
      results.push({
        url: streamMatch[1],
        type: "hls",
        provider: "moviesapi",
        providerName: "MoviesAPI",
        headers: { Referer: "https://moviesapi.club/" },
      });
    } else if (iframeMatch && iframeMatch[1]) {
      const embedResp = await fetch(iframeMatch[1], { headers: { "User-Agent": UA, Referer: embedUrl } });
      if (embedResp.ok) {
        const embedHtml = await embedResp.text();
        const m3u8 = embedHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
        if (m3u8 && m3u8[1]) {
          results.push({
            url: m3u8[1],
            type: "hls",
            provider: "moviesapi",
            providerName: "MoviesAPI",
            headers: { Referer: iframeMatch[1] },
          });
        }
      }
    }
    return results;
  } catch (e) {
    console.log("[moviesapi] error:", e.message);
    return [];
  }
}
