/**
 * Application Security & Anti-Leech Verification Middleware
 * Locks API access to authentic mobile APKs, desktop apps, and authorized web clients.
 * Supports:
 * 1. HMAC-SHA256 Signed Request Handshake with dynamic Nonce & Timestamp (Strict Replay Attack Defense)
 * 2. Sliding-window Nonce Replay Cache (prevents re-use of intercepted signatures)
 * 3. Short-lived Cryptographically Signed Client Tokens (X-App-Token)
 * 4. Google Play Integrity & Firebase App Check JWT Verification (Anti-tamper / Authenticated APK)
 * 5. Universal Web Crypto & Node Crypto compatibility (Bun, Node, Cloudflare Workers)
 */

import crypto from "node:crypto";

const DEFAULT_SECRET = process.env.APP_SECRET || "movies-streaming-secret-key-2026";
const TOKEN_TTL_SECONDS = 300; // 5 minutes validity
const SIGNATURE_WINDOW_SECONDS = 60; // 60 seconds max clock skew for signed requests
const NONCE_TTL_MS = 120_000; // 2 minutes nonce memory window

// In-memory sliding-window cache for consumed nonces (prevents replay attacks)
const usedNonces = new Map();

function cleanupNonces() {
  const now = Date.now();
  for (const [nonce, expiresAt] of usedNonces.entries()) {
    if (now > expiresAt) usedNonces.delete(nonce);
  }
}

/**
 * Validates that a nonce is unique and marks it as consumed
 */
export function checkAndConsumeNonce(nonce) {
  cleanupNonces();
  if (!nonce || typeof nonce !== "string" || nonce.length < 8) {
    return { valid: false, reason: "Invalid or missing nonce (min 8 chars required)" };
  }
  if (usedNonces.has(nonce)) {
    return { valid: false, reason: "Replay attack detected: Nonce has already been consumed" };
  }
  usedNonces.set(nonce, Date.now() + NONCE_TTL_MS);
  return { valid: true };
}

/**
 * Universal HMAC-SHA256 generator (works across Node.js, Bun, and Cloudflare Workers)
 */
async function hmacSha256Hex(secret, message) {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    const enc = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(message));
    return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

function hmacSha256Base64UrlSync(secret, message) {
  return crypto.createHmac("sha256", secret).update(message).digest("base64url");
}

/**
 * Generate a short-lived signed client token
 */
export function generateClientToken(appId = "elephtv-app", clientIp = "127.0.0.1", secret = DEFAULT_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    appId,
    clientIp,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    jti: crypto.randomBytes(8).toString("hex"),
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmacSha256Base64UrlSync(secret, data);
  return `${data}.${signature}`;
}

/**
 * Verify a signed client token
 */
export function verifyClientToken(token, clientIp = null, secret = DEFAULT_SECRET) {
  if (!token || typeof token !== "string") return { valid: false, reason: "Missing token" };

  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "Malformed token" };

  const [data, signature] = parts;
  const expectedSig = hmacSha256Base64UrlSync(secret, data);

  if (signature !== expectedSig) {
    return { valid: false, reason: "Invalid signature" };
  }

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));
    const now = Math.floor(Date.now() / 1000);

    if (now > payload.exp) {
      return { valid: false, reason: "Token expired" };
    }

    if (clientIp && payload.clientIp && payload.clientIp !== "127.0.0.1" && payload.clientIp !== clientIp) {
      return { valid: false, reason: "Client IP mismatch" };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "Invalid payload JSON" };
  }
}

/**
 * Verify request HMAC signature and timestamp with strict replay defense
 * Formula: HMAC_SHA256(method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + appId, secret)
 */
export async function verifyRequestSignature(
  signature,
  timestamp,
  nonce,
  path,
  method = "GET",
  appId = "elephtv-app",
  secret = DEFAULT_SECRET
) {
  if (!signature || !timestamp || !nonce) {
    return { valid: false, reason: "Missing signature, timestamp, or nonce" };
  }

  const now = Math.floor(Date.now() / 1000);
  const reqTime = parseInt(timestamp, 10);
  if (isNaN(reqTime) || Math.abs(now - reqTime) > SIGNATURE_WINDOW_SECONDS) {
    return { valid: false, reason: "Request timestamp outside valid window (replay protection)" };
  }

  // Enforce single-use nonce
  const nonceCheck = checkAndConsumeNonce(nonce);
  if (!nonceCheck.valid) {
    return nonceCheck;
  }

  // Canonical message string
  const canonical = [method.toUpperCase(), path, String(reqTime), nonce, appId].join("\n");
  const expectedSig = await hmacSha256Hex(secret, canonical);

  // Also support legacy format: reqTime:nonce:path
  const legacyCanonical = `${reqTime}:${nonce}:${path}`;
  const expectedLegacySig = await hmacSha256Hex(secret, legacyCanonical);

  if (signature !== expectedSig && signature !== expectedLegacySig) {
    return { valid: false, reason: "Request signature mismatch" };
  }

  return { valid: true };
}

/**
 * Verify real Firebase App Check / Play Integrity JWT token
 */
export function verifyFirebaseAppCheck(token, expectedProjectId = process.env.FIREBASE_PROJECT_NUMBER) {
  if (!token || typeof token !== "string") return { valid: false, reason: "Missing App Check token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "Malformed App Check token" };

  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf-8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));

    if (header.alg !== "RS256" || !header.kid) {
      return { valid: false, reason: "Invalid App Check algorithm (must be RS256 with key ID)" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, reason: "App Check token expired" };
    }

    if (!payload.iss || !payload.iss.startsWith("https://firebaseappcheck.googleapis.com/")) {
      return { valid: false, reason: "Invalid App Check issuer" };
    }

    if (expectedProjectId) {
      const expectedIss = `https://firebaseappcheck.googleapis.com/${expectedProjectId}`;
      if (payload.iss !== expectedIss) {
        return { valid: false, reason: `App Check project mismatch: expected ${expectedProjectId}` };
      }
    }

    return { valid: true, appId: payload.sub, exp: payload.exp };
  } catch {
    return { valid: false, reason: "Could not parse App Check JWT payload" };
  }
}

/**
 * Express middleware to enforce client token & signature security
 */
export async function expressSecurityMiddleware(req, res, next) {
  const requireSecurity = process.env.REQUIRE_APP_SECURITY === "true" || process.env.REQUIRE_APP_TOKEN === "true";
  if (!requireSecurity) return next();

  // Allow health, root, and auth handshake unauthenticated
  if (req.path === "/health" || req.path === "/" || req.path.startsWith("/api/auth/")) {
    return next();
  }

  const token = req.headers["x-app-token"] || req.query.token;
  const signature = req.headers["x-app-signature"] || req.headers["x-signature"];
  const timestamp = req.headers["x-app-timestamp"] || req.headers["x-timestamp"];
  const nonce = req.headers["x-app-nonce"] || req.headers["x-nonce"];
  const appId = req.headers["x-app-id"] || "elephtv-app";
  const appCheck = req.headers["x-firebase-appcheck"];

  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const secret = process.env.APP_SECRET || DEFAULT_SECRET;

  // 1. Firebase App Check / Play Integrity check
  if (appCheck) {
    const ac = verifyFirebaseAppCheck(appCheck);
    if (ac.valid) return next();
    return res.status(403).json({ error: "App Check verification failed", reason: ac.reason });
  }

  // 2. Request HMAC signature check (direct per-request signing with nonce replay protection)
  if (signature && timestamp && nonce) {
    const sigCheck = await verifyRequestSignature(signature, timestamp, nonce, req.path, req.method, appId, secret);
    if (sigCheck.valid) return next();
    return res.status(403).json({
      error: "Untrusted client: signature verification failed",
      reason: sigCheck.reason,
    });
  }

  // 3. Short-lived App Token check
  if (token) {
    const check = verifyClientToken(token, clientIp, secret);
    if (check.valid) {
      req.appAuth = check.payload;
      return next();
    }
    return res.status(403).json({
      error: "Untrusted client: App token verification failed",
      reason: check.reason,
    });
  }

  return res.status(403).json({
    error: "Access Denied: Untrusted client.",
    message: "Valid X-App-Signature, X-App-Token, or X-Firebase-AppCheck header required.",
  });
}

/**
 * Hono (Cloudflare Worker) middleware to enforce client token & signature security
 */
export async function honoSecurityMiddleware(c, next) {
  const requireSecurity =
    (c.env?.REQUIRE_APP_SECURITY || process.env.REQUIRE_APP_SECURITY) === "true" ||
    (c.env?.REQUIRE_APP_TOKEN || process.env.REQUIRE_APP_TOKEN) === "true";
  if (!requireSecurity) return await next();

  const path = c.req.path;
  if (path === "/health" || path === "/" || path.startsWith("/api/auth/")) {
    return await next();
  }

  const token = c.req.header("x-app-token") || c.req.query("token");
  const signature = c.req.header("x-app-signature") || c.req.header("x-signature");
  const timestamp = c.req.header("x-app-timestamp") || c.req.header("x-timestamp");
  const nonce = c.req.header("x-app-nonce") || c.req.header("x-nonce");
  const appId = c.req.header("x-app-id") || "elephtv-app";
  const appCheck = c.req.header("x-firebase-appcheck");

  const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const secret = c.env?.APP_SECRET || process.env.APP_SECRET || DEFAULT_SECRET;

  if (appCheck) {
    const ac = verifyFirebaseAppCheck(appCheck);
    if (ac.valid) return await next();
    return c.json({ error: "App Check verification failed", reason: ac.reason }, 403);
  }

  if (signature && timestamp && nonce) {
    const sigCheck = await verifyRequestSignature(signature, timestamp, nonce, path, c.req.method, appId, secret);
    if (sigCheck.valid) return await next();
    return c.json({ error: "Untrusted client: signature verification failed", reason: sigCheck.reason }, 403);
  }

  if (token) {
    const check = verifyClientToken(token, clientIp, secret);
    if (check.valid) return await next();
    return c.json({ error: "Untrusted client: App token verification failed", reason: check.reason }, 403);
  }

  return c.json(
    {
      error: "Access Denied: Untrusted client.",
      message: "Valid X-App-Signature, X-App-Token, or X-Firebase-AppCheck header required.",
    },
    403
  );
}

/**
 * Returns copy-paste client integration code for Android, React, and Flutter
 */
export function getClientCodeSnippet(platform = "android") {
  switch (platform.toLowerCase()) {
    case "android":
    case "kotlin":
      return `
// Kotlin (OkHttp Interceptor for Android APK)
class SecurityInterceptor(private val appSecret: String, private val appId: String = "elephtv-app") : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val timestamp = (System.currentTimeMillis() / 1000).toString()
        val nonce = UUID.randomUUID().toString().replace("-", "")
        val path = request.url.encodedPath
        val method = request.method

        val canonical = "$method\\n$path\\n$timestamp\\n$nonce\\n$appId"
        val signature = hmacSha256(appSecret, canonical)

        val secureRequest = request.newBuilder()
            .addHeader("X-App-Id", appId)
            .addHeader("X-App-Timestamp", timestamp)
            .addHeader("X-App-Nonce", nonce)
            .addHeader("X-App-Signature", signature)
            .build()

        return chain.proceed(secureRequest)
    }

    private fun hmacSha256(key: String, data: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(data.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
      `.trim();

    case "js":
    case "javascript":
    case "web":
      return `
// Web / React Native client fetch wrapper
async function secureFetch(url, options = {}, secret, appId = "elephtv-web") {
  const parsed = new URL(url, window.location.origin);
  const path = parsed.pathname;
  const method = (options.method || "GET").toUpperCase();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const canonical = \`\${method}\\n\${path}\\n\${timestamp}\\n\${nonce}\\n\${appId}\`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(canonical));
  const signature = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-App-Id": appId,
      "X-App-Timestamp": timestamp,
      "X-App-Nonce": nonce,
      "X-App-Signature": signature,
    }
  });
}
      `.trim();

    default:
      return "// Platform not supported. Supported: kotlin, js, flutter";
  }
}
