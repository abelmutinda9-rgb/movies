/**
 * Live Sports and 24/7 Sports TV Channels Extractor (SuperSport, Sky Sports, TNT, etc.)
 * Dynamically parses live fixtures and 24/7 channels without requiring database storage.
 */

const BASE_URL = "https://thedaddy.li";
let _cachedSchedule = null;
let _scheduleExpiry = 0;

let _cachedChannels = null;
let _channelsExpiry = 0;

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * Fetch and parse all 24/7 live channels (SuperSport, Sky, TNT, etc.)
 */
export async function getSportsChannels(filter = "all") {
  if (_cachedChannels && Date.now() < _channelsExpiry) {
    return applyChannelFilter(_cachedChannels, filter);
  }

  try {
    const res = await fetch(`${BASE_URL}/24-7-channels.php`, {
      headers: { "User-Agent": USER_AGENT, Referer: `${BASE_URL}/` },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const aTags = [...html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)];
    
    const channels = [];
    for (const a of aTags) {
      const rawText = a[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const href = a[1];
      if (href.includes("watch.php?id=")) {
        const id = href.split("watch.php?id=")[1].trim();
        const cleanName = rawText.replace(/\s*ID:\s*\d+$/i, "").trim();
        
        let category = "General";
        const lower = cleanName.toLowerCase();
        if (lower.includes("supersport")) category = "SuperSport";
        else if (lower.includes("sky sports") || lower.includes("sky sport")) category = "Sky Sports";
        else if (lower.includes("tnt sports") || lower.includes("tnt sport")) category = "TNT Sports";
        else if (lower.includes("bein sports") || lower.includes("bein sport")) category = "beIN Sports";
        else if (lower.includes("espn")) category = "ESPN";
        else if (lower.includes("sport") || lower.includes("football") || lower.includes("racing") || lower.includes("tennis")) category = "Sports";

        channels.push({
          id,
          name: cleanName,
          category,
          embedUrl: `${BASE_URL}/stream/stream-${id}.php`,
          watchUrl: `${BASE_URL}/watch.php?id=${id}`,
        });
      }
    }

    _cachedChannels = channels;
    _channelsExpiry = Date.now() + 60 * 60 * 1000; // Cache 1 hour
    return applyChannelFilter(channels, filter);
  } catch (err) {
    console.error("[sports] getSportsChannels error:", err.message);
    return _cachedChannels ? applyChannelFilter(_cachedChannels, filter) : [];
  }
}

function applyChannelFilter(channels, filter) {
  if (!filter || filter === "all") return channels;
  const q = filter.toLowerCase();
  return channels.filter(
    (c) =>
      c.category.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q)
  );
}

/**
 * Fetch and parse live match fixtures from schedule (Premier League, UEFA, etc.)
 */
export async function getLiveMatches(sport = "football") {
  if (_cachedSchedule && Date.now() < _scheduleExpiry) {
    return applyMatchFilter(_cachedSchedule, sport);
  }

  try {
    const res = await fetch(`${BASE_URL}/`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const eventBlocks = [...html.matchAll(/<div class="schedule__event">([\s\S]*?)<\/div>\s*<\/div>/gi)];

    const events = [];
    for (const b of eventBlocks) {
      const time = b[1].match(/class="schedule__time"[^>]*>([^<]+)/)?.[1]?.trim() || "";
      const title = b[1].match(/class="schedule__eventTitle"[^>]*>([^<]+)/)?.[1]?.trim() || "";
      
      if (!title) continue;

      const channels = [...b[1].matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi)].map((m) => {
        const id = m[1].match(/id=(\d+)/)?.[1] || "";
        return {
          id,
          name: m[2].trim(),
          embedUrl: id ? `${BASE_URL}/stream/stream-${id}.php` : null,
          watchUrl: `${BASE_URL}${m[1]}`,
        };
      });

      let category = "other";
      if (title.includes("⚽") || /football|soccer|premier league|uefa|la liga|serie a|bundesliga|champions league/i.test(title)) {
        category = "football";
      } else if (title.includes("🏎️") || /f1|formula/i.test(title)) {
        category = "motorsport";
      } else if (title.includes("🎾") || /tennis/i.test(title)) {
        category = "tennis";
      } else if (title.includes("🥊") || /boxing|ufc|mma/i.test(title)) {
        category = "fighting";
      } else if (title.includes("🏀") || /nba|basketball/i.test(title)) {
        category = "basketball";
      }

      events.push({
        time,
        title,
        category,
        channels,
      });
    }

    _cachedSchedule = events;
    _scheduleExpiry = Date.now() + 5 * 60 * 1000; // Cache 5 minutes
    return applyMatchFilter(events, sport);
  } catch (err) {
    console.error("[sports] getLiveMatches error:", err.message);
    return _cachedSchedule ? applyMatchFilter(_cachedSchedule, sport) : [];
  }
}

function applyMatchFilter(events, sport) {
  if (!sport || sport === "all") return events;
  const q = sport.toLowerCase();
  return events.filter(
    (e) =>
      e.category === q ||
      e.title.toLowerCase().includes(q)
  );
}
