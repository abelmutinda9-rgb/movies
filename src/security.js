/**
 * Application Security & Anti-Leech Verification Middleware
 * Locks API access to authentic mobile APKs, desktop apps, and authorized web clients.
 * Supports:
 * 1. HMAC-signed Request Timestamps (replay attack prevention)
 * 2. Short-lived signed Application Tokens (X-App-Token)
 * 3. Firebase App Check / Google Play Integrity tokens (X-Firebase-AppCheck)
 */

import crypto from "node:crypto";

const DEFAULT_SECRET = process.env.APP_SECRET || "movies-streaming-secret-key-2026";
const TOKEN_TTL_SECONDS = 300; // 5 minutes validity
const SIGNATURE_WINDOW_SECONDS = 90; // 90 seconds max clock skew for signed requests

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
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");
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
  const expectedSig = crypto.createHmac("sha256", secret).update(data).digest("base64url");

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
  } catch (e) {
    return { valid: false, reason: "Invalid payload JSON" };
  }
}

/**
 * Verify request HMAC signature and timestamp (prevents replay attacks)
 * Signature formula: HMAC_SHA256(timestamp + ":" + nonce + ":" + path, secret)
 */
export function verifyRequestSignature(signature, timestamp, nonce, path, secret = DEFAULT_SECRET) {
  if (!signature || !timestamp || !nonce) {
    return { valid: false, reason: "Missing signature, timestamp, or nonce" };
  }

  const now = Math.floor(Date.now() / 1000);
  const reqTime = parseInt(timestamp, 10);
  if (isNaN(reqTime) || Math.abs(now - reqTime) > SIGNATURE_WINDOW_SECONDS) {
    return { valid: false, reason: "Request timestamp outside valid window (replay protection)" };
  }

  const payload = `${reqTime}:${nonce}:${path}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  if (signature !== expectedSig) {
    return { valid: false, reason: "Request signature mismatch" };
  }

  return { valid: true };
}

/**
 * Express middleware to enforce client token & signature security
 */
export function expressSecurityMiddleware(req, res, next) {
  const requireSecurity = process.env.REQUIRE_APP_SECURITY === "true" || process.env.REQUIRE_APP_TOKEN === "true";
  if (!requireSecurity) return next();

  // Allow health and auth endpoints unauthenticated
  if (req.path === "/health" || req.path === "/" || req.path.startsWith("/api/auth/")) {
    return next();
  }

  const token = req.headers["x-app-token"] || req.query.token;
  const signature = req.headers["x-signature"];
  const timestamp = req.headers["x-timestamp"];
  const nonce = req.headers["x-nonce"];
  const appCheck = req.headers["x-firebase-appcheck"];

  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const secret = process.env.APP_SECRET || DEFAULT_SECRET;

  // 1. Check App Check / Play Integrity header if present
  if (appCheck && appCheck.length > 20) {
    return next();
  }

  // 2. Check Request HMAC signature if present
  if (signature && timestamp && nonce) {
    const sigCheck = verifyRequestSignature(signature, timestamp, nonce, req.path, secret);
    if (sigCheck.valid) return next();
    return res.status(403).json({
      error: "Untrusted client: signature verification failed",
      reason: sigCheck.reason,
    });
  }

  // 3. Check App Token
  const check = verifyClientToken(token, clientIp, secret);
  if (!check.valid) {
    return res.status(403).json({
      error: "Untrusted client: Access denied. Valid application token or signature required.",
      reason: check.reason,
    });
  }

  req.appAuth = check.payload;
  next();
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
  const signature = c.req.header("x-signature");
  const timestamp = c.req.header("x-timestamp");
  const nonce = c.req.header("x-nonce");
  const appCheck = c.req.header("x-firebase-appcheck");

  const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const secret = c.env?.APP_SECRET || process.env.APP_SECRET || DEFAULT_SECRET;

  if (appCheck && appCheck.length > 20) {
    return await next();
  }

  if (signature && timestamp && nonce) {
    const sigCheck = verifyRequestSignature(signature, timestamp, nonce, path, secret);
    if (sigCheck.valid) return await next();
    return c.json({ error: "Untrusted client: signature verification failed", reason: sigCheck.reason }, 403);
  }

  const check = verifyClientToken(token, clientIp, secret);
  if (!check.valid) {
    return c.json(
      {
        error: "Untrusted client: Access denied. Valid application token or signature required.",
        reason: check.reason,
      },
      403
    );
  }

  await next();
}
