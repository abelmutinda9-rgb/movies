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
  const { country, q, limit = 50 } = options;

  if (!_cachedIptv || Date.now() > _iptvExpiry) {
    try {
      const res = await fetch("https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8", {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const text = await res.text();
        const entries = [];
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("#EXTINF:")) {
            const info = lines[i];
            const url = lines[i + 1]?.trim();
            const isPlayable = url.includes(".m3u8") || url.includes(".mpd") || url.includes(".ts") || (url.includes("/live/") && !url.includes("youtube.com") && !url.includes("standardmedia.co.ke") && !url.includes("citizentv.co.ke"));
            if (url && url.startsWith("http") && isPlayable) {
              const nameMatch = info.match(/,(.+)$/);
              const name = nameMatch ? nameMatch[1].replace(/[\u24B6-\u24E9]/g, "").trim() : "Unknown";
              const groupMatch = info.match(/group-title="([^"]+)"/);
              const group = groupMatch ? groupMatch[1].trim() : "General";
              const logoMatch = info.match(/tvg-logo="([^"]+)"/);
              const logo = logoMatch ? logoMatch[1].trim() : null;
              const countryMatch = info.match(/tvg-country="([^"]+)"/);
              const cCode = countryMatch ? countryMatch[1].trim() : "";

              entries.push({
                name,
                country: group,
                countryCode: cCode,
                logo,
                url,
                streamType: "hls",
              });
            }
          }
        }
        _cachedIptv = entries;
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
    const cLower = country.toLowerCase();
    list = list.filter((c) => c.country.toLowerCase().includes(cLower) || c.countryCode.toLowerCase() === cLower);
  }

  if (q) {
    const qLower = q.toLowerCase();
    list = list.filter((c) => c.name.toLowerCase().includes(qLower) || c.country.toLowerCase().includes(qLower));
  }

  return list.slice(0, Math.min(Number(limit) || 50, 200));
}


// ==========================================
// DSTV & STARTIMES DECODER MAPPING MODULES
// ==========================================

export const DSTV_CHANNEL_MAP = [
  // Entertainment & Movies (100 - 199)
  { number: 101, name: "M-Net", defaultId: "827", category: "Entertainment", match: ["m-net", "dstv m-net"] },
  { number: 111, name: "TNT Africa", defaultId: "109", category: "Movies", match: ["tnt"] },
  { number: 124, name: "E! Entertainment", defaultId: "78", category: "Entertainment", match: ["e!"] },
  { number: 161, name: "Mzansi Magic", defaultId: "786", category: "Entertainment", match: ["mzansi magic", "dstv mzansi magic"] },
  { number: 175, name: "Food Network", defaultId: "102", category: "Lifestyle", match: ["food network"] },
  { number: 176, name: "HGTV", defaultId: "103", category: "Lifestyle", match: ["hgtv"] },
  { number: 181, name: "National Geographic", defaultId: "100", category: "Documentary", match: ["national geographic", "nat geo"] },
  { number: 182, name: "Nat Geo Wild", defaultId: "101", category: "Documentary", match: ["nat geo wild"] },
  { number: 186, name: "History Channel", defaultId: "98", category: "Documentary", match: ["history"] },

  // SuperSport Lineup (200 - 249)
  { number: 201, name: "SuperSport Grandstand", defaultId: "412", category: "SuperSport", match: ["supersport grandstand"] },
  { number: 202, name: "SuperSport PSL", defaultId: "413", category: "SuperSport", match: ["supersport psl"] },
  { number: 203, name: "SuperSport Premier League", defaultId: "414", category: "SuperSport", match: ["supersport premier league"] },
  { number: 204, name: "SuperSport LaLiga", defaultId: "415", category: "SuperSport", match: ["supersport laliga"] },
  { number: 205, name: "SuperSport Football", defaultId: "56", category: "SuperSport", match: ["supersport football"] },
  { number: 206, name: "SuperSport Variety 1", defaultId: "416", category: "SuperSport", match: ["supersport variety 1"] },
  { number: 207, name: "SuperSport Variety 2", defaultId: "417", category: "SuperSport", match: ["supersport variety 2"] },
  { number: 208, name: "SuperSport Variety 3", defaultId: "418", category: "SuperSport", match: ["supersport variety 3"] },
  { number: 209, name: "SuperSport Variety 4", defaultId: "419", category: "SuperSport", match: ["supersport variety 4"] },
  { number: 210, name: "SuperSport Action", defaultId: "420", category: "SuperSport", match: ["supersport action"] },
  { number: 211, name: "SuperSport Rugby", defaultId: "421", category: "SuperSport", match: ["supersport rugby"] },
  { number: 212, name: "SuperSport Cricket", defaultId: "368", category: "SuperSport", match: ["supersport cricket"] },
  { number: 213, name: "SuperSport Golf", defaultId: "422", category: "SuperSport", match: ["supersport golf"] },
  { number: 214, name: "SuperSport Tennis", defaultId: "423", category: "SuperSport", match: ["supersport tennis"] },
  { number: 215, name: "SuperSport Motorsport", defaultId: "424", category: "SuperSport", match: ["supersport motorsport"] },
  { number: 241, name: "ESPN", defaultId: "26", category: "SuperSport", match: ["espn"] },
  { number: 242, name: "ESPN 2", defaultId: "27", category: "SuperSport", match: ["espn 2", "espn2"] },

  // Kids & Animation (300 - 399)
  { number: 301, name: "Cartoon Network", defaultId: "90", category: "Kids", match: ["cartoon network"] },
  { number: 302, name: "Boomerang / Cartoonito", defaultId: "91", category: "Kids", match: ["boomerang", "cartoonito"] },
  { number: 303, name: "Disney Channel", defaultId: "93", category: "Kids", match: ["disney channel"] },
  { number: 304, name: "Disney Junior", defaultId: "94", category: "Kids", match: ["disney junior"] },
  { number: 305, name: "Nickelodeon", defaultId: "88", category: "Kids", match: ["nickelodeon"] },
  { number: 308, name: "Nick Jr.", defaultId: "89", category: "Kids", match: ["nick jr"] },

  // News & Business (400 - 449)
  { number: 401, name: "CNN International", defaultId: "85", category: "News", match: ["cnn"] },
  { number: 402, name: "BBC News", defaultId: "81", category: "News", match: ["bbc news"] },
  { number: 404, name: "Sky News", defaultId: "83", category: "News", match: ["sky news"] },
  { number: 406, name: "Al Jazeera English", defaultId: "86", category: "News", match: ["al jazeera"] },
  { number: 410, name: "CNBC", defaultId: "87", category: "News", match: ["cnbc"] },
  { number: 411, name: "Bloomberg TV", defaultId: "97", category: "News", match: ["bloomberg"] },
  { number: 412, name: "Euronews", defaultId: "106", category: "News", match: ["euronews"] },

  // International UK/US Sports Feeds (800 - 899)
  { number: 801, name: "Sky Sports Main Event", defaultId: "38", category: "International Sports", match: ["sky sports main event"] },
  { number: 802, name: "Sky Sports Premier League", defaultId: "130", category: "International Sports", match: ["sky sports premier league"] },
  { number: 803, name: "Sky Sports Football", defaultId: "129", category: "International Sports", match: ["sky sports football"] },
  { number: 804, name: "Sky Sports F1", defaultId: "131", category: "International Sports", match: ["sky sports f1"] },
  { number: 805, name: "TNT Sports 1", defaultId: "57", category: "International Sports", match: ["tnt sports 1"] },
  { number: 806, name: "TNT Sports 2", defaultId: "58", category: "International Sports", match: ["tnt sports 2"] },
  { number: 807, name: "TNT Sports 3", defaultId: "59", category: "International Sports", match: ["tnt sports 3"] },
  { number: 808, name: "TNT Sports 4", defaultId: "60", category: "International Sports", match: ["tnt sports 4"] },
  { number: 809, name: "USA Network", defaultId: "343", category: "International Sports", match: ["usa network"] },
  { number: 810, name: "beIN Sports 1", defaultId: "18", category: "International Sports", match: ["bein sports 1"] }
];

export const STARTIMES_CHANNEL_MAP = [
  // Local African FTA on StarTimes
  { number: 1, name: "KBC Channel 1", category: "StarTimes Local", country: "Kenya", streamType: "hls", url: "https://kbc.co.ke/live/index.m3u8" },
  { number: 2, name: "Citizen TV", category: "StarTimes Local", country: "Kenya", streamType: "hls", url: "https://citizentv.co.ke/live/index.m3u8" },
  { number: 3, name: "KTN Home", category: "StarTimes Local", country: "Kenya", streamType: "hls", url: "https://standardmedia.co.ke/ktn/live/index.m3u8" },
  { number: 4, name: "NTV Kenya", category: "StarTimes Local", country: "Kenya", streamType: "hls", url: "https://ntvkenya.co.ke/live/index.m3u8" },
  { number: 5, name: "K24 TV", category: "StarTimes Local", country: "Kenya", streamType: "hls", url: "https://k24tv.co.ke/live/index.m3u8" },
  { number: 10, name: "e.tv News & Sport", category: "StarTimes Local", country: "South Africa", streamType: "hls", url: "https://etv.co.za/live/index.m3u8" },
  { number: 11, name: "SABC News", category: "StarTimes Local", country: "South Africa", streamType: "hls", url: "https://sabc.co.za/news/live/index.m3u8" },
  { number: 12, name: "Channels TV", category: "StarTimes Local", country: "Nigeria", streamType: "hls", url: "https://channelstv.com/live/index.m3u8" },
  { number: 13, name: "TVC News", category: "StarTimes Local", country: "Nigeria", streamType: "hls", url: "https://tvcnews.tv/live/index.m3u8" },

  // StarTimes Sports & World Sports
  { number: 240, name: "ST Sports Premium", category: "StarTimes Sports", defaultId: "412", match: ["st sports", "sports premium"] },
  { number: 241, name: "ST World Football", category: "StarTimes Sports", defaultId: "414", match: ["world football", "football"] },
  { number: 242, name: "ST Sports Arena", category: "StarTimes Sports", defaultId: "415", match: ["sports arena"] },
  { number: 243, name: "ST Sports Life", category: "StarTimes Sports", defaultId: "416", match: ["sports life"] },
  { number: 244, name: "ST Sports Focus", category: "StarTimes Sports", defaultId: "56", match: ["sports focus"] },
  { number: 250, name: "ESPN", category: "StarTimes Sports", defaultId: "26", match: ["espn"] },
  { number: 251, name: "ESPN 2", category: "StarTimes Sports", defaultId: "27", match: ["espn 2"] },

  // Novelas, Movies & Kungfu
  { number: 105, name: "ST Novela E", category: "StarTimes Novelas", defaultId: "786", match: ["novela e"] },
  { number: 106, name: "ST Novela E Plus", category: "StarTimes Novelas", defaultId: "827", match: ["novela e plus"] },
  { number: 102, name: "ST Nollywood Plus", category: "StarTimes Movies", defaultId: null, match: ["nollywood"] },
  { number: 115, name: "ST Sino Drama", category: "StarTimes Series", defaultId: null, match: ["sino drama"] },
  { number: 118, name: "ST Kungfu", category: "StarTimes Movies", defaultId: null, match: ["kungfu"] },
  { number: 160, name: "ST Swahili", category: "StarTimes Local", defaultId: null, match: ["swahili"] },

  // Kids
  { number: 300, name: "ST Kids", category: "StarTimes Kids", defaultId: "88", match: ["st kids", "nickelodeon"] },
  { number: 305, name: "Baby TV", category: "StarTimes Kids", defaultId: "94", match: ["baby tv", "disney junior"] }
];

let _countryCache = new Map();

/**
 * Fetch DStv Channel Lineup with Logical Channel Numbers
 */
export async function getDstvChannels(options = {}) {
  const { category, q } = options;
  const allLive = await getAllLiveChannels();
  const liveMap = new Map();
  for (const ch of allLive) {
    liveMap.set(String(ch.id), ch);
  }

  const result = [];

  for (const item of DSTV_CHANNEL_MAP) {
    let matched = item.defaultId ? liveMap.get(String(item.defaultId)) : null;

    if (!matched && item.match && item.match.length > 0) {
      for (const m of item.match) {
        matched = allLive.find(c => c.name.toLowerCase().includes(m.toLowerCase()));
        if (matched) break;
      }
    }

    const channelId = matched ? matched.id : (item.defaultId || `dstv-${item.number}`);
    const embedUrl = matched ? matched.embedUrl : `${DADDY_BASE}/stream/stream-${channelId}.php`;
    const watchUrl = matched ? matched.watchUrl : `${DADDY_BASE}/watch.php?id=${channelId}`;

    result.push({
      number: item.number,
      name: item.name,
      category: item.category,
      provider: "DStv",
      id: channelId,
      streamType: "embed",
      embedUrl,
      watchUrl,
      isLive: Boolean(matched)
    });
  }

  let list = result.sort((a, b) => a.number - b.number);

  if (category && category !== "all") {
    const cLower = category.toLowerCase();
    list = list.filter(c => c.category.toLowerCase().includes(cLower));
  }

  if (q) {
    const qLower = q.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(qLower) || String(c.number).includes(qLower) || c.category.toLowerCase().includes(qLower));
  }

  return list;
}

/**
 * Fetch StarTimes Decoder Channel Lineup
 */
export async function getStarTimesChannels(options = {}) {
  const { category, q } = options;
  const allLive = await getAllLiveChannels();
  const liveMap = new Map();
  for (const ch of allLive) {
    liveMap.set(String(ch.id), ch);
  }

  const result = [];

  for (const item of STARTIMES_CHANNEL_MAP) {
    if (item.url) {
      result.push({
        number: item.number,
        name: item.name,
        category: item.category,
        provider: "StarTimes",
        country: item.country || "Africa",
        streamType: item.streamType || "hls",
        url: item.url,
        isLive: true
      });
      continue;
    }

    let matched = item.defaultId ? liveMap.get(String(item.defaultId)) : null;
    if (!matched && item.match) {
      for (const m of item.match) {
        matched = allLive.find(c => c.name.toLowerCase().includes(m.toLowerCase()));
        if (matched) break;
      }
    }

    const channelId = matched ? matched.id : (item.defaultId || `st-${item.number}`);
    result.push({
      number: item.number,
      name: item.name,
      category: item.category,
      provider: "StarTimes",
      id: channelId,
      streamType: "embed",
      embedUrl: `${DADDY_BASE}/stream/stream-${channelId}.php`,
      watchUrl: `${DADDY_BASE}/watch.php?id=${channelId}`,
      isLive: Boolean(matched)
    });
  }

  let list = result.sort((a, b) => a.number - b.number);

  if (category && category !== "all") {
    const cLower = category.toLowerCase();
    list = list.filter(c => c.category.toLowerCase().includes(cLower));
  }

  if (q) {
    const qLower = q.toLowerCase();
    list = list.filter(c => c.name.toLowerCase().includes(qLower) || String(c.number).includes(qLower));
  }

  return list;
}

/**
 * Fetch local Country TV channels from iptv-org playlists (e.g. ZA for e.tv/SABC, KE for Citizen/K24, NG, etc.)
 */
export async function getCountryChannels(countryCode, options = {}) {
  const code = (countryCode || "za").toLowerCase().trim();
  const { q, category } = options;
  const now = Date.now();

  const cached = _countryCache.get(code);
  if (cached && now < cached.expiry) {
    return filterCountryChannels(cached.channels, { q, category });
  }

  try {
    const res = await fetch(`https://iptv-org.github.io/iptv/countries/${code}.m3u`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const lines = text.split("\n");
    const channels = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("#EXTINF:")) {
        const info = lines[i];
        const url = lines[i + 1]?.trim();
        if (url && url.startsWith("http")) {
          const nameMatch = info.match(/,(.+)$/);
          const rawName = nameMatch ? nameMatch[1].trim() : "Channel";
          const logoMatch = info.match(/tvg-logo=\"([^\"]+)\"/);
          const groupMatch = info.match(/group-title=\"([^\"]+)\"/);

          channels.push({
            name: rawName.replace(/\s*\[[^\]]+\]/g, "").replace(/\s*\([^)]+\)/g, "").trim(),
            fullName: rawName,
            countryCode: code.toUpperCase(),
            category: groupMatch ? groupMatch[1].trim() : "Local TV",
            logo: logoMatch ? logoMatch[1].trim() : null,
            streamType: url.includes(".m3u8") ? "hls" : (url.includes(".mpd") ? "dash" : "stream"),
            url
          });
        }
      }
    }

    _countryCache.set(code, { channels, expiry: now + 60 * 60 * 1000 });
    return filterCountryChannels(channels, { q, category });
  } catch (err) {
    console.error(`[livetv] getCountryChannels error for ${code}:`, err.message);
    if (cached) return filterCountryChannels(cached.channels, { q, category });
    return [];
  }
}

function filterCountryChannels(list, { q, category } = {}) {
  let result = list;
  if (category && category !== "all") {
    const cLower = category.toLowerCase();
    result = result.filter(c => c.category.toLowerCase().includes(cLower));
  }
  if (q) {
    const qLower = q.toLowerCase();
    result = result.filter(c => c.name.toLowerCase().includes(qLower) || c.fullName.toLowerCase().includes(qLower));
  }
  return result;
}
