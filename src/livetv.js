/**
 * Live TV Module
 * Comprehensive Live TV aggregator:
 * 1. 900+ Premium Satellite & Cable TV channels (Sports, Movies, News, Entertainment, Kids, Docs, etc.)
 * 2. Global Direct HLS (.m3u8) Streams (IPTV-org catalog for 30+ countries & categories)
 * 3. Live Sports fixtures & match schedules
 */

const DADDY_BASE = "https://thedaddy.li";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let _cachedPremium = null;
let _premiumExpiry = 0;

let _cachedSchedule = null;
let _scheduleExpiry = 0;

let _cachedIptv = null;
let _iptvExpiry = 0;

/**
 * Classify a channel name into clean, human-readable categories
 */
export function classifyChannel(name) {
  const cleanName = name
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .trim();

  const l = cleanName.toLowerCase();

  // 1. Kids & Family
  if (/cartoon|disney|nickelodeon|nick\s|nickjr|boomerang|adult swim|cbeebies|cbbc|baby tv|treehouse|pop max/i.test(l)) {
    return { name: cleanName, category: "Kids", subcategory: "Animation" };
  }

  // 2. Movies & Premium Series
  if (/hbo|cinemax|showtime|starz|amc\b|fx\s|fx$|fxx|tcm\b|axn|sony movies|paramount network|hallmark|lifetime|screenpix|flix|cinema|movies|film4/i.test(l)) {
    return { name: cleanName, category: "Movies & Series", subcategory: "Movies" };
  }

  // 3. News & Finance
  if (/news|cnn|msnbc|fox news|cspan|c-span|bloomberg|cnbc|weather channel|bbc news|al jazeera|rt news|sky news|euronews|i24|c-span/i.test(l)) {
    return { name: cleanName, category: "News", subcategory: "World News" };
  }

  // 4. Documentaries & Fact
  if (/discovery|national geographic|nat geo|history\b|animal planet|investigation discovery|\bid\b|science channel|smithsonian|curiosity|crime/i.test(l)) {
    return { name: cleanName, category: "Documentary", subcategory: "Knowledge" };
  }

  // 5. Music
  if (/mtv|vh1|bet\b|axs tv|cmt|revolt|music|stingray|trace/i.test(l)) {
    return { name: cleanName, category: "Music", subcategory: "Music & Culture" };
  }

  // 6. Sports Channels (SuperSport, Sky, TNT, ESPN, beIN, etc.)
  if (/supersport|sky sport|tnt sport|bein sport|espn|sport|football|soccer|cricket|racing|f1\b|formula|motogp|tennis|golf|fight|ufc|wwe|dazn|nba|nfl|mlb|nhl|eurosport|barca tv|benfica tv|mutv|chelsea|real madrid|alkass/i.test(l)) {
    let sub = "General Sports";
    if (l.includes("supersport")) sub = "SuperSport";
    else if (l.includes("sky sports") || l.includes("sky sport")) sub = "Sky Sports";
    else if (l.includes("tnt sports") || l.includes("tnt sport")) sub = "TNT Sports";
    else if (l.includes("bein sports") || l.includes("bein sport")) sub = "beIN Sports";
    else if (l.includes("espn")) sub = "ESPN";
    return { name: cleanName, category: "Sports", subcategory: sub };
  }

  // 7. General Broadcast & Entertainment
  if (/abc|cbs|nbc|fox\b|cw\b|bbc one|bbc two|bbc three|bbc four|itv|channel 4|channel 5|e!|bravo|tlc|food network|hgtv|comedy central|usa network|tbs|tnt\b|syfy|tru tv|tru\b|a&e|ion|roku|freeform/i.test(l)) {
    return { name: cleanName, category: "Entertainment", subcategory: "Broadcast" };
  }

  // 8. International Regional Networks
  if (/\b(uk|usa|us|fr|france|es|spain|de|germany|it|italy|pt|portugal|mx|mexico|ca|canada|tr|turkey|bg|bulgaria|ar|arabic|nl|netherlands|pl|poland|ro|romania|cz|sk|se|dk)\b/i.test(l)) {
    return { name: cleanName, category: "International", subcategory: "Regional" };
  }

  return { name: cleanName, category: "General", subcategory: "Variety" };
}

/**
 * Fetch all 900+ Premium 24/7 TV channels
 */
export async function getAllLiveChannels(filter = {}) {
  const { category, q, subcategory } = typeof filter === "string" ? { category: filter } : filter;

  if (!_cachedPremium || Date.now() > _premiumExpiry) {
    try {
      const res = await fetch(`${DADDY_BASE}/24-7-channels.php`, {
        headers: { "User-Agent": USER_AGENT, Referer: `${DADDY_BASE}/` },
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
          const cleanRaw = rawText.replace(/\s*ID:\s*\d+$/i, "").trim();
          const meta = classifyChannel(cleanRaw);

          channels.push({
            id,
            name: meta.name,
            category: meta.category,
            subcategory: meta.subcategory,
            streamType: "embed",
            embedUrl: `${DADDY_BASE}/stream/stream-${id}.php`,
            watchUrl: `${DADDY_BASE}/watch.php?id=${id}`,
          });
        }
      }

      _cachedPremium = channels;
      _premiumExpiry = Date.now() + 60 * 60 * 1000; // Cache 1 hour
    } catch (err) {
      console.error("[livetv] getAllLiveChannels error:", err.message);
      if (!_cachedPremium) return [];
    }
  }

  let list = _cachedPremium;

  if (category && category !== "all") {
    const cLower = category.toLowerCase();
    list = list.filter((c) => c.category.toLowerCase().includes(cLower) || c.subcategory.toLowerCase().includes(cLower));
  }

  if (subcategory && subcategory !== "all") {
    const sLower = subcategory.toLowerCase();
    list = list.filter((c) => c.subcategory.toLowerCase().includes(sLower));
  }

  if (q) {
    const qLower = q.toLowerCase();
    list = list.filter((c) => c.name.toLowerCase().includes(qLower) || c.category.toLowerCase().includes(qLower));
  }

  return list;
}

/**
 * Returns summary of all available categories and channel counts
 */
export async function getLiveCategories() {
  const all = await getAllLiveChannels();
  const catMap = {};
  for (const c of all) {
    if (!catMap[c.category]) {
      catMap[c.category] = { category: c.category, count: 0, subcategories: {} };
    }
    catMap[c.category].count++;
    catMap[c.category].subcategories[c.subcategory] = (catMap[c.category].subcategories[c.subcategory] || 0) + 1;
  }
  return Object.values(catMap).sort((a, b) => b.count - a.count);
}

/**
 * Fetch free-to-air direct HLS (.m3u8) streams from curated global IPTV
 * Useful for native video players (ExoPlayer, AVPlayer, VLC, etc.)
 */
export async function getDirectIptvStreams(options = {}) {
  const { country, category, q, limit = 50 } = options;

  if (!_cachedIptv || Date.now() > _iptvExpiry) {
    try {
      const res = await fetch("https://iptv-org.github.io/api/streams.json", {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        _cachedIptv = await res.json();
        _iptvExpiry = Date.now() + 2 * 60 * 60 * 1000; // Cache 2 hours
      }
    } catch (err) {
      console.error("[livetv] getDirectIptvStreams error:", err.message);
      if (!_cachedIptv) return [];
    }
  }

  if (!_cachedIptv) return [];

  let list = _cachedIptv;

  if (country) {
    const cUpper = country.toUpperCase();
    list = list.filter((s) => s.channel && s.channel.endsWith(`_${cUpper}`));
  }

  if (q) {
    const qLower = q.toLowerCase();
    list = list.filter((s) => s.title && s.title.toLowerCase().includes(qLower));
  }

  return list.slice(0, Math.min(Number(limit) || 50, 200)).map((s) => ({
    title: s.title,
    channelId: s.channel,
    url: s.url,
    quality: s.quality || "auto",
    streamType: "hls",
  }));
}
