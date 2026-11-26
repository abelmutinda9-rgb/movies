import crypto from "node:crypto";

const DEFAULT_SECRET = process.env.APP_SECRET || "audify-elephtv-streaming-secret-2026";
const TOKEN_TTL_SECONDS = 300; // 5 minutes validity

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
 * Express middleware to enforce client token security
 */
export function expressSecurityMiddleware(req, res, next) {
  const requireToken = process.env.REQUIRE_APP_TOKEN === "true";
  if (!requireToken) return next();

  const token = req.headers["x-app-token"] || req.query.token;
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;

  const check = verifyClientToken(token, clientIp);
  if (!check.valid) {
    return res.status(403).json({
      error: "Access denied. Valid application token required.",
      reason: check.reason,
    });
  }

  req.appAuth = check.payload;
  next();
}

/**
 * Hono (Cloudflare Worker) middleware to enforce client token security
 */
export async function honoSecurityMiddleware(c, next) {
  const requireToken = (c.env?.REQUIRE_APP_TOKEN || process.env.REQUIRE_APP_TOKEN) === "true";
  if (!requireToken) return await next();

  const token = c.req.header("x-app-token") || c.req.query("token");
  const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim();

  const secret = c.env?.APP_SECRET || process.env.APP_SECRET || DEFAULT_SECRET;
  const check = verifyClientToken(token, clientIp, secret);

  if (!check.valid) {
    return c.json(
      {
        error: "Access denied. Valid application token required.",
        reason: check.reason,
      },
      403
    );
  }

  await next();
}
