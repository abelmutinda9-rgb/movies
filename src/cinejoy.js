/**
 * Cinejoy Stream Resolver
 * Resolves streams via Wing CDN / Cinejoy server infrastructure
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const WING_API = "https://api.wing.st";
const CINEJOY_ORIGIN = "https://cinejoy.pk";

let _cachedServers = null;
let _serversExpiry = 0;

/**
 * Fetch available Wing/Cinejoy servers (Light, Nebula, Sirius, Polaris)
 */
export async function getCinejoyServers() {
  if (_cachedServers && Date.now() < _serversExpiry) {
    return _cachedServers;
  }
  try {
    const res = await fetch(`${WING_API}/servers`, {
      headers: {
        "User-Agent": UA,
        Origin: CINEJOY_ORIGIN,
        Referer: `${CINEJOY_ORIGIN}/`,
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _cachedServers = data.servers || [];
    _serversExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes cache
    return _cachedServers;
  } catch (e) {
    return [
      { name: "Light", status: "ok", "4k": true },
      { name: "Nebula", status: "ok", "4k": false },
      { name: "Sirius", status: "ok", "4k": true },
      { name: "Polaris", status: "ok", "4k": false },
    ];
  }
}

/**
 * Cinejoy Extractor for provider registry
 */
export async function cinejoyExtract(type, tmdbId, season, episode) {
  try {
    const servers = await getCinejoyServers();
    const activeServers = servers.filter((s) => s.status === "ok");
    if (!activeServers.length) return [];

    const isTv = type === "tv" || type === "series";
    const mediaPath = isTv
      ? `/watch/tv/${tmdbId}/${season || 1}/${episode || 1}`
      : `/watch/movie/${tmdbId}`;

    // Probe media page to extract active stream token or direct playlist URL
    const pageRes = await fetch(`${CINEJOY_ORIGIN}${mediaPath}`, {
      headers: {
        "User-Agent": UA,
        Referer: `${CINEJOY_ORIGIN}/`,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!pageRes.ok) return [];
    const html = await pageRes.text();

    const streams = [];

    // Search for direct m3u8 or wingcdn stream matches in html
    const m3u8Matches = [...html.matchAll(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>']*/gi)];
    for (const match of m3u8Matches) {
      const url = match[0];
      if (!streams.some((s) => s.url === url)) {
        streams.push({
          url,
          type: "hls",
          provider: "cinejoy",
          providerName: "Cinejoy (Direct)",
          headers: { Referer: `${CINEJOY_ORIGIN}/`, Origin: CINEJOY_ORIGIN },
        });
      }
    }

    return streams;
  } catch (e) {
    return [];
  }
}
