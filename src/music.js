import crypto from "node:crypto";

const DES_KEY = Buffer.from("38346591", "utf-8");
const SAAVN_API = "https://www.jiosaavn.com/api.php";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Decrypts JioSaavn encrypted_media_url using DES-ECB
 */
export function decryptSaavnMediaUrl(encUrl) {
  if (!encUrl) return null;
  try {
    const decipher = crypto.createDecipheriv("des-ecb", DES_KEY, null);
    decipher.setAutoPadding(true);
    let dec = decipher.update(encUrl, "base64", "utf-8");
    dec += decipher.final("utf-8");
    return dec.trim();
  } catch (err) {
    return null;
  }
}

/**
 * Formats stream URLs for multiple bitrates (320, 160, 96, 48 kbps)
 */
export function buildAudioQualities(rawUrl) {
  if (!rawUrl) return [];
  const base = rawUrl.replace(/_[0-9]+\.(mp4|mp3|m4a)$/, "");
  const ext = (rawUrl.match(/\.(mp4|mp3|m4a)$/) || [".mp4"])[0];

  return [
    { quality: "320kbps", kbps: 320, url: `${base}_320${ext}` },
    { quality: "160kbps", kbps: 160, url: `${base}_160${ext}` },
    { quality: "96kbps", kbps: 96, url: `${base}_96${ext}` },
    { quality: "48kbps", kbps: 48, url: `${base}_48${ext}` },
  ];
}

/**
 * Clean HTML entities in string
 */
function cleanText(str) {
  if (!str) return "";
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/**
 * Parse standard LRC format string into [{ time, text }]
 */
export function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split("\n");
  const parsed = [];

  for (const line of lines) {
    const match = line.match(/\[(\d{2}):(\d{2})\.?(\d{2,3})?\](.*)/);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, "0").slice(0, 3), 10) : 0;
      const timeInSec = min * 60 + sec + ms / 1000;
      const text = match[4].trim();
      parsed.push({ time: parseFloat(timeInSec.toFixed(2)), text });
    }
  }

  return parsed;
}

/**
 * Search tracks with audio streams & high-res artwork
 */
export function searchMusic(query, page = 1, limit = 20) {
  return searchMusicInternal(query, page, limit);
}

async function searchMusicInternal(query, page = 1, limit = 20) {
  if (!query) return { results: [], total: 0 };
  const url = `${SAAVN_API}?__call=search.getResults&q=${encodeURIComponent(query)}&p=${page}&n=${limit}&_format=json&_marker=0&api_version=4&ctx=android`;

  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return { results: [], total: 0 };

  const data = await res.json().catch(() => ({}));
  const rawResults = data.results || [];

  const results = rawResults.map((song) => {
    const more = song.more_info || {};
    const enc = more.encrypted_media_url;
    const directUrl = decryptSaavnMediaUrl(enc);
    const qualities = buildAudioQualities(directUrl);
    const primary320 = qualities.find((q) => q.quality === "320kbps")?.url || directUrl;

    const primaryArtists = more.artistMap?.primary_artists?.map((a) => a.name).join(", ") || song.subtitle || "Unknown Artist";

    return {
      id: song.id,
      title: cleanText(song.title),
      artist: cleanText(primaryArtists),
      album: cleanText(more.album || ""),
      year: song.year || more.release_date?.slice(0, 4) || "",
      duration: parseInt(more.duration || "0", 10),
      image: (song.image || "").replace(/150x150|50x50/, "500x500").replace(/^http:/, "https:"),
      stream_url: primary320,
      download_url: primary320,
      has_lyrics: more.has_lyrics === "true" || more.has_lyrics === true,
      streams: qualities,
    };
  });

  return {
    total: data.total || results.length,
    start: data.start || 1,
    results,
  };
}

/**
 * Fetch lyrics with multi-provider fallback (BetterLyrics -> LRCLIB -> Binimum)
 * Matches Audify's provider strategy
 */
export async function getLyrics(trackName, artistName, durationSec = 0, album = "") {
  if (!trackName) return { synced: false, lines: [], plain: "", source: null };

  // Strip (Remix), (Nightcore), etc. for higher lyrics match rate
  let cleanTrack = cleanText(trackName).replace(/\(.*?\)|\[.*?\]/g, "").trim();
  let cleanArtist = cleanText(artistName).split(/,|&|feat\.|ft\./i)[0].trim();


  // 1. Try BetterLyrics (syllable / word-timed TTML)
  try {
    const bUrl = new URL("https://lyrics-api.boidu.dev/getLyrics");
    bUrl.searchParams.set("s", cleanTrack);
    bUrl.searchParams.set("a", cleanArtist);
    if (durationSec > 0) bUrl.searchParams.set("d", durationSec.toString());
    if (album) bUrl.searchParams.set("al", album);

    const bRes = await fetch(bUrl.toString(), {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(3000),
    });
    if (bRes.ok) {
      const bData = await bRes.json().catch(() => null);
      if (bData && bData.ttml) {
        // Extract lines and timestamps from TTML XML
        const ttml = bData.ttml;
        const lineMatches = [...ttml.matchAll(/<p[^>]*begin="([^"]+)"[^>]*>(.*?)<\/p>/gis)];
        if (lineMatches.length > 0) {
          const lines = lineMatches.map((m) => {
            const timeRaw = m[1];
            // Format can be 00:12.345 or 12.345s
            let timeSec = 0;
            if (timeRaw.includes(":")) {
              const parts = timeRaw.split(":");
              timeSec = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
            } else {
              timeSec = parseFloat(timeRaw.replace("s", ""));
            }
            const text = cleanText(m[2].replace(/<[^>]+>/g, ""));
            return { time: parseFloat(timeSec.toFixed(2)), text };
          }).filter((l) => l.text.length > 0);

          if (lines.length > 0) {
            return {
              synced: true,
              type: "word-synced",
              source: "BetterLyrics",
              lines,
              plain: lines.map((l) => l.text).join("\n"),
            };
          }
        }
      }
    }
  } catch (e) {
    // continue to next provider
  }

  // 2. Try LRCLIB (standard line-by-line synced LRC + plain fallback)
  try {
    const lrcUrl = new URL("https://lrclib.net/api/get");
    lrcUrl.searchParams.set("track_name", cleanTrack);
    lrcUrl.searchParams.set("artist_name", cleanArtist);
    if (durationSec > 0) lrcUrl.searchParams.set("duration", durationSec.toString());

    const lrcRes = await fetch(lrcUrl.toString(), {
      headers: { "User-Agent": "movies-music-api/1.0" },
      signal: AbortSignal.timeout(3000),
    });
    if (lrcRes.ok) {
      const lrcData = await lrcRes.json().catch(() => null);
      if (lrcData && (lrcData.syncedLyrics || lrcData.plainLyrics)) {
        const syncedLines = lrcData.syncedLyrics ? parseLrc(lrcData.syncedLyrics) : [];
        return {
          synced: syncedLines.length > 0,
          type: syncedLines.length > 0 ? "line-synced" : "plain",
          source: "LRCLIB",
          lrc: lrcData.syncedLyrics || null,
          lines: syncedLines,
          plain: lrcData.plainLyrics || syncedLines.map((l) => l.text).join("\n"),
        };
      }
    }
  } catch (e) {
    // continue
  }

  // 3. Try Binimum / LRC.red
  try {
    const binUrl = new URL("https://lyrics-api.binimum.org/");
    binUrl.searchParams.set("track", cleanTrack);
    binUrl.searchParams.set("artist", cleanArtist);
    if (durationSec > 0) binUrl.searchParams.set("duration", durationSec.toString());

    const binRes = await fetch(binUrl.toString(), {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(3000),
    });
    if (binRes.ok) {
      const binData = await binRes.json().catch(() => null);
      const hit = binData?.results?.[0];
      if (hit?.lyricsUrl) {
        const docRes = await fetch(hit.lyricsUrl, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(3000),
        });
        if (docRes.ok) {
          const docText = await docRes.text();
          const parsed = parseLrc(docText);
          if (parsed.length > 0) {
            return {
              synced: true,
              type: hit.timing_type === "word" ? "word-synced" : "line-synced",
              source: "Binimum/LRC.red",
              lines: parsed,
              plain: parsed.map((l) => l.text).join("\n"),
            };
          }
        }
      }
    }
  } catch (e) {
    // return not found
  }

  return {
    synced: false,
    type: "none",
    source: null,
    lines: [],
    plain: "Lyrics not available for this track.",
  };
}
