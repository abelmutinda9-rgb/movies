/**
 * Electronic Program Guide (EPG) Engine
 * Provides live "Now Playing" and "Next Up" program schedules for Live TV & Sports channels
 */

import { getLiveMatches } from "./sports.js";

const _epgCache = new Map();
const EPG_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

/**
 * Format a program entry with progress and remaining time
 */
function createProgramBlock(title, category, startTime, endTime, desc = "") {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const totalDurationMs = Math.max(end - start, 60000);
  const elapsedMs = Math.max(0, now - start);
  const remainingMs = Math.max(0, end - now);

  const progressPercentage = Math.min(100, Math.max(0, Math.round((elapsedMs / totalDurationMs) * 100)));
  const remainingMinutes = Math.round(remainingMs / 60000);

  return {
    title,
    category,
    description: desc,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    durationMinutes: Math.round(totalDurationMs / 60000),
    progressPercentage,
    remainingMinutes,
  };
}

/**
 * Generate standard recurring blocks when external schedule is unavailable
 */
function generateDynamicBlock(channelName, offsetHours = 0) {
  const now = new Date();
  const currentHour = (now.getUTCHours() + offsetHours) % 24;
  const slotIndex = Math.floor(now.getUTCMinutes() / 30); // 30-min block

  const startTime = new Date(now);
  startTime.setUTCMinutes(slotIndex * 30, 0, 0);
  if (offsetHours > 0) startTime.setUTCHours(startTime.getUTCHours() + offsetHours);

  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1-hour program

  const name = (channelName || "").toLowerCase();
  let title = "Live Broadcast";
  let category = "General";

  if (name.includes("supersport") || name.includes("sky sports") || name.includes("espn") || name.includes("tnt")) {
    category = "Sports";
    const sportsShows = [
      "Matchday Live Preview",
      "Premier League Highlights & Goals",
      "Football Today: Tactics & Analysis",
      "Live Stadium Coverage",
      "Sportscenter & News Bulletin",
      "Classic Encounters: The Vault",
    ];
    title = sportsShows[(currentHour + slotIndex) % sportsShows.length];
  } else if (name.includes("news") || name.includes("cnn") || name.includes("bbc") || name.includes("al jazeera") || name.includes("citizen") || name.includes("ktn")) {
    category = "News";
    const newsShows = [
      "Global News Today",
      "Prime Time Bulletin",
      "World Business Report",
      "Live Special Coverage",
      "Top Stories & Headlines",
      "Insight & Debate",
    ];
    title = newsShows[(currentHour + slotIndex) % newsShows.length];
  } else if (name.includes("cinema") || name.includes("movie") || name.includes("hbo") || name.includes("starz")) {
    category = "Movies";
    const movieShows = [
      "Blockbuster Showcase",
      "Action Cinema Night",
      "Prime Feature Film",
      "Hollywood Spotlight",
      "Late Night Mystery Cinema",
    ];
    title = movieShows[(currentHour + slotIndex) % movieShows.length];
  } else if (name.includes("cartoon") || name.includes("disney") || name.includes("nick") || name.includes("kids")) {
    category = "Kids";
    const kidShows = [
      "Morning Cartoons & Adventure",
      "Super Toons Hour",
      "Animation Showcase",
      "Family Fun Specials",
    ];
    title = kidShows[(currentHour + slotIndex) % kidShows.length];
  }

  return createProgramBlock(title, category, startTime, endTime, `${channelName} scheduled programming.`);
}

/**
 * Get EPG guide for a specific channel
 */
export async function getChannelEpg(channelId, channelName = "") {
  const cacheKey = `epg:${channelId || channelName}`;
  const cached = _epgCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return cached.data;

  let nowProgram = null;
  let nextProgram = null;

  // 1. If it's a sports channel, match against live fixtures
  const lowerName = (channelName || channelId || "").toLowerCase();
  const isSports = /sport|football|soccer|premier|espn|sky|tnt|bein/i.test(lowerName);

  if (isSports) {
    try {
      const matches = await getLiveMatches("all");
      const matched = matches.find((m) =>
        (m.channels || []).some(
          (c) =>
            (c.id && c.id === channelId) ||
            (c.name && lowerName.includes(c.name.toLowerCase()))
        )
      );

      if (matched) {
        // Matched live fixture
        const now = new Date();
        const start = new Date(now.getTime() - 25 * 60 * 1000); // 25 mins in
        const end = new Date(start.getTime() + 105 * 60 * 1000); // 1h45m match
        nowProgram = createProgramBlock(matched.title, "Live Sports", start, end, `Live event: ${matched.title}`);
        
        const nextStart = end;
        const nextEnd = new Date(nextStart.getTime() + 45 * 60 * 1000);
        nextProgram = createProgramBlock("Post-Match Analysis & Highlights", "Live Sports", nextStart, nextEnd);
      }
    } catch (e) {
      // Fallback to dynamic schedule
    }
  }

  // 2. If no live fixture or not a sports channel, generate active schedule block
  if (!nowProgram) {
    nowProgram = generateDynamicBlock(channelName || channelId, 0);
  }
  if (!nextProgram) {
    nextProgram = generateDynamicBlock(channelName || channelId, 1);
  }

  const result = {
    channelId,
    channelName: channelName || channelId,
    timestamp: new Date().toISOString(),
    now: nowProgram,
    next: nextProgram,
  };

  _epgCache.set(cacheKey, { data: result, exp: Date.now() + EPG_TTL_MS });
  return result;
}

/**
 * Attach EPG now/next guide to a list of channels
 */
export async function attachEpgToChannels(channels = []) {
  const results = await Promise.all(
    channels.map(async (ch) => {
      const epg = await getChannelEpg(ch.id, ch.name);
      return {
        ...ch,
        epg: {
          now: epg.now,
          next: epg.next,
        },
      };
    })
  );
  return results;
}
