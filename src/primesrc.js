const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function primesrcExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const url = isTV
      ? `https://primesrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`
      : `https://primesrc.me/embed/movie?tmdb=${tmdbId}`;

    const headers = {
      "User-Agent": UA,
      Referer: "https://primesrc.me/",
    };

    const res = await fetch(url, { headers });
    if (!res.ok) return [];

    const html = await res.text();
    const matches = html.matchAll(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/gi);
    const results = [];

    for (const match of matches) {
      const streamUrl = match[1];
      results.push({
        url: streamUrl,
        type: streamUrl.includes(".mp4") ? "file" : "hls",
        provider: "primesrc",
        providerName: "PrimeSrc",
        headers: { Referer: "https://primesrc.me/" },
      });
      if (results.length >= 2) break;
    }

    return results;
  } catch (e) {
    console.log("[primesrc] error:", e.message);
    return [];
  }
}
