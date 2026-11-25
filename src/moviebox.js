import crypto from "node:crypto";
import { vidlinkExtract } from "./vidlink.js";

const GATEWAY_SECRET_ONLINE = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const BASE_HOST = "apig.inmoviebox.com";
const BASE_URL = `https://${BASE_HOST}`;

let _cachedToken = null;
let _tokenExpiry = 0;

function md5Hex(data) {
  if (!data) return "";
  return crypto.createHash("md5").update(data, "utf8").digest("hex");
}

function generateClientToken() {
  const ts = String(Date.now());
  const reversed = ts.split("").reverse().join("");
  return `${ts},${md5Hex(reversed)}`;
}

function generateSignature(method, url, bodyStr, timestamp) {
  const parsed = new URL(url);
  const path = parsed.pathname;
  const params = Array.from(parsed.searchParams.entries());
  let resource = path;
  if (params.length > 0) {
    params.sort((a, b) => a[0].localeCompare(b[0]));
    const qs = params.map(([k, v]) => `${k}=${v}`).join("&");
    resource = `${path}?${qs}`;
  }

  const bodyMD5 = bodyStr ? md5Hex(bodyStr.slice(0, 0x19000)) : "";
  const accept = "application/json";
  const contentType = "application/json;charset=UTF-8";
  const contentLength = bodyStr ? String(Buffer.byteLength(bodyStr, "utf8")) : "";

  const canonical = [
    method.toUpperCase(),
    accept,
    contentType,
    contentLength,
    String(timestamp),
    bodyMD5,
    resource,
  ].join("\n");

  const key = Buffer.from(GATEWAY_SECRET_ONLINE, "base64");
  const hmac = crypto.createHmac("md5", key).update(canonical, "utf8").digest("base64");
  return `${timestamp}|2|${hmac}`;
}

const CLIENT_INFO = JSON.stringify({
  package_name: "com.community.oneroom",
  version_name: "4.0.02",
  version_code: 50020126,
  os: "android",
  os_version: "14",
  install_ch: "ps",
  device_id: "868203051234567",
  install_store: "ps",
  gaid: "",
  brand: "Google",
  model: "Pixel 6",
  system_language: "en",
  net: "wifi",
  region: "IN",
  timezone: "Asia/Kolkata",
  sp_code: "404",
});

async function apiRequest(method, endpoint, params = {}, bodyObj = null, token = null) {
  const query = { ...params };
  if (!query.host) query.host = BASE_HOST;

  const urlObj = new URL(`${BASE_URL}${endpoint}`);
  for (const [k, v] of Object.entries(query)) {
    urlObj.searchParams.set(k, String(v));
  }
  const fullUrl = urlObj.toString();
  const bodyStr = bodyObj !== null ? JSON.stringify(bodyObj) : "";
  const ts = Date.now();
  const sig = generateSignature(method, fullUrl, bodyStr, ts);

  const headers = {
    "User-Agent": "MovieBox/4.0.02 (Android 14; Pixel 6)",
    Accept: "application/json",
    "X-M-Version": "4.0.02",
    Referer: `${BASE_URL}/`,
    "X-Sign-Version": "2.0",
    "X-Client-Token": generateClientToken(),
    "X-Client-Info": CLIENT_INFO,
    "X-Client-Status": "0",
    "X-Play-Mode": "2",
    appid: "4U01pxRu278GqCZKY9",
    region: "IN",
    lang: "en",
    os: "android",
    "X-Timestamp": String(ts),
    "Content-Type": "application/json;charset=UTF-8",
    Host: BASE_HOST,
    "x-tr-signature": sig,
  };

  if (bodyStr) {
    headers["Content-Length"] = String(Buffer.byteLength(bodyStr, "utf8"));
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(fullUrl, {
    method,
    headers,
    body: method !== "GET" && bodyStr ? bodyStr : undefined,
  });

  if (!res.ok) {
    throw new Error(`MovieBox API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function getVisitorToken() {
  if (process.env.MOVIEBOX_TOKEN) return process.env.MOVIEBOX_TOKEN;
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const res = await apiRequest("POST", "/wefeed-mobile-bff/user-api/visitor-login", {}, {});
  const token = res?.data?.token;
  if (!token) throw new Error("Could not acquire MovieBox guest token");

  _cachedToken = token;
  _tokenExpiry = Date.now() + 2 * 60 * 60 * 1000; // 2 hour cache
  return token;
}

export async function movieboxSearch(keyword) {
  try {
    const token = await getVisitorToken();
    const res = await apiRequest(
      "POST",
      "/wefeed-mobile-bff/subject-api/search",
      {},
      { keyword, type: 0, page: 1, pageSize: 15 },
      token,
    );
    return res?.data?.items || res?.data?.list || [];
  } catch (e) {
    console.log("[moviebox] search error:", e.message);
    return [];
  }
}

export async function movieboxExtract(type, tmdbId, season = 1, episode = 1) {
  try {
    const streams = [];

    // 1. Fetch direct MovieBox/FebBox CDN streams via VidLink WASM token pipeline
    try {
      const vidlinkStreams = await vidlinkExtract(type, tmdbId, season, episode);
      if (vidlinkStreams && vidlinkStreams.length) {
        streams.push(...vidlinkStreams.map((s) => ({
          ...s,
          provider: "moviebox",
          providerName: s.quality ? `MovieBox CDN (${s.quality})` : "MovieBox CDN",
        })));
      }
    } catch (_) {}

    // 2. Direct MovieBox API search for standalone high-speed AWS CloudFront MP4 streams
    if (type === "movie" && tmdbId) {
      try {
        const { tmdb } = await import("./tmdb.js");
        const meta = await tmdb(`/movie/${tmdbId}`);
        const title = meta?.title || meta?.original_title;
        if (title) {
          const searchItems = await movieboxSearch(title);
          const match = searchItems.find((i) => (i.title || "").toLowerCase() === title.toLowerCase()) || searchItems[0];
          for (const detector of match?.resourceDetectors || []) {
            for (const r of detector.resolutionList || []) {
              if (r.resourceLink) {
                streams.push({
                  url: r.resourceLink,
                  type: "file",
                  quality: `${r.resolution}p`,
                  provider: "moviebox",
                  providerName: `MovieBox Direct (${r.resolution}p MP4)`,
                  headers: {},
                  size: r.size,
                });
              }
            }
          }
        }
      } catch (err) {
        console.log("[moviebox] direct search extract error:", err.message);
      }
    }

    return streams;
  } catch (e) {
    console.log("[moviebox] error:", e.message);
    return [];
  }
}
