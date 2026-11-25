import { movieboxSearch } from "./moviebox.js";
import { tmdb } from "./tmdb.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

export async function africanExtract(type, tmdbId, season = 1, episode = 1, title = null) {
  try {
    let searchTitle = title;
    if (!searchTitle && tmdbId) {
      try {
        const meta = await tmdb(type === "tv" ? `/tv/${tmdbId}` : `/movie/${tmdbId}`);
        searchTitle = meta?.title || meta?.name || meta?.original_title;
      } catch (_) {}
    }

    if (!searchTitle) return [];

    const results = [];
    // 1. Direct MovieBox African/Nollywood MP4 stream resolution
    const searchItems = await movieboxSearch(searchTitle);
    const cleanSearch = searchTitle.toLowerCase().trim();
    const match =
      searchItems.find((i) => (i.title || "").toLowerCase().trim() === cleanSearch) ||
      searchItems[0];

    if (match?.resourceDetectors) {
      for (const detector of match.resourceDetectors) {
        for (const r of detector.resolutionList || []) {
          if (r.resourceLink && (r.resourceLink.includes(".mp4") || r.resourceLink.includes("hakunaymatata.com"))) {
            results.push({
              url: r.resourceLink,
              type: "file",
              quality: `${r.resolution}p`,
              provider: "african",
              providerName: `African / Nollywood (${r.resolution}p Direct MP4)`,
              headers: { "User-Agent": UA },
              size: r.size,
            });
          }
        }
      }
    }

    return results;
  } catch (e) {
    console.log("[african] error:", e.message);
    return [];
  }
}
