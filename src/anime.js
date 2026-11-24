const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function animeExtract(type, tmdbId, season, episode, title) {
  try {
    let searchTitle = title;
    if (!searchTitle && tmdbId) {
      try {
        const tmdbKey = process.env.TMDB_API_KEY || "e763e003f57245b0d5f47f2e16d946cf";
        const tmdbUrl = type === "movie"
          ? `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbKey}`
          : `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${tmdbKey}`;
        const res = await fetch(tmdbUrl);
        if (res.ok) {
          const data = await res.json();
          searchTitle = data.name || data.title || data.original_name || data.original_title;
        }
      } catch {}
    }

    if (!searchTitle) return [];

    const cleanTitle = searchTitle.replace(/[^a-zA-Z0-9 ]/g, "").trim().toLowerCase();
    const epNum = Number(episode) || 1;

    // Search Anitaku / Gogoanime mirror
    const searchUrl = `https://anitaku.to/search.html?keyword=${encodeURIComponent(cleanTitle)}`;
    const searchRes = await fetch(searchUrl, { headers: { "User-Agent": UA } });
    if (!searchRes.ok) return [];

    const searchHtml = await searchRes.text();
    const slugMatch = searchHtml.match(/<a\s+href="\/category\/([^"]+)"/i);
    if (!slugMatch || !slugMatch[1]) return [];

    const animeSlug = slugMatch[1];
    const episodePageUrl = `https://anitaku.to/${animeSlug}-episode-${epNum}`;
    const epRes = await fetch(episodePageUrl, { headers: { "User-Agent": UA } });
    if (!epRes.ok) return [];

    const epHtml = await epRes.text();
    const embedIframe = epHtml.match(/<iframe[^>]+src=["'](\/\/[^"']+|https?:\/\/[^"']*(?:playgo|stream|embtaku|anitaku)[^"']*)["']/i);
    if (!embedIframe || !embedIframe[1]) return [];

    let embedUrl = embedIframe[1];
    if (embedUrl.startsWith("//")) embedUrl = "https:" + embedUrl;

    return [
      {
        url: embedUrl,
        type: "hls",
        provider: "anime",
        providerName: "Anime (GogoAnime)",
        headers: { Referer: "https://anitaku.to/" },
      },
    ];
  } catch (e) {
    console.log("[anime] error:", e.message);
    return [];
  }
}
