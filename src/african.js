const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function africanExtract(type, tmdbId, season, episode, title) {
  try {
    let searchTitle = title;
    if (!searchTitle && tmdbId) {
      try {
        const tmdbKey = process.env.TMDB_API_KEY || "e763e003f57245b0d5f47f2e16d946cf";
        const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbKey}`;
        const res = await fetch(tmdbUrl);
        if (res.ok) {
          const data = await res.json();
          searchTitle = data.title || data.original_title;
        }
      } catch {}
    }

    if (!searchTitle) return [];

    // Search NetNaija video section for direct downloads / streaming pages
    const netNaijaSearch = `https://www.thenetnaija.net/search?folder=videos&t=${encodeURIComponent(searchTitle)}`;
    const nnRes = await fetch(netNaijaSearch, { headers: { "User-Agent": UA } });
    const results = [];

    if (nnRes.ok) {
      const html = await nnRes.text();
      const articleMatch = html.match(/<article[^>]*>[\s\S]*?<a\s+href="([^"]+)"/i);
      if (articleMatch && articleMatch[1]) {
        const postUrl = articleMatch[1].startsWith("http")
          ? articleMatch[1]
          : `https://www.thenetnaija.net${articleMatch[1]}`;

        results.push({
          url: postUrl,
          type: "file",
          provider: "netnaija",
          providerName: "NetNaija / Nollywood",
          headers: { Referer: "https://www.thenetnaija.net/" },
        });
      }
    }

    return results;
  } catch (e) {
    console.log("[african] error:", e.message);
    return [];
  }
}
