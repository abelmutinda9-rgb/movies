import "./net.js";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import streamRoutes from "./routes/stream.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

// 1. CORS Domain-Locking Middleware
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS;
const allowedOrigins = rawAllowedOrigins
  ? rawAllowedOrigins.split(",").map((o) => o.trim().toLowerCase()).filter(Boolean)
  : [];

if (allowedOrigins.length > 0) {
  console.log(`[security] CORS domain-locking active. Allowed: ${allowedOrigins.join(", ")}`);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) {
      // Direct non-browser requests (e.g. mobile app, curl, server-to-server) have no Origin header
      return next();
    }

    const lowerOrigin = origin.toLowerCase();
    if (allowedOrigins.includes(lowerOrigin) || allowedOrigins.includes("*")) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, Range");
      res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      if (req.method === "OPTIONS") {
        return res.sendStatus(204);
      }
      return next();
    }

    if (req.method === "OPTIONS") {
      return res.status(403).json({ error: "Origin not allowed by CORS domain policy" });
    }
    return res.status(403).json({ error: "Origin not allowed by CORS domain policy" });
  });
} else {
  // Open CORS default if ALLOWED_ORIGINS is not set
  app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "Range"],
    exposedHeaders: ["Content-Range", "Content-Length", "Accept-Ranges"]
  }));
}

// 2. Body Parser (Headless JSON API)
app.use(express.json());

// 3. Root & Health Check Endpoints (Headless JSON API)
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "movies-api",
    version: "1.0.0",
    docs: "/api/sources",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "movies-api", timestamp: new Date().toISOString() });
});

// 4. API Key Authentication Middleware
const expectedApiKey = process.env.API_KEY;

if (expectedApiKey) {
  console.log("[security] API Key authentication active.");
} else {
  console.log("[security] No API_KEY set; running in public open access mode.");
}

const requireApiKey = (req, res, next) => {
  if (!expectedApiKey) {
    return next();
  }

  // Check headers: x-api-key or Authorization: Bearer <key>
  const headerKey = req.headers["x-api-key"];
  const authHeader = req.headers["authorization"];
  let bearerKey = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    bearerKey = authHeader.slice(7).trim();
  }

  // Check query parameter fallback: ?api_key=... or ?key=... (useful for video players & HLS manifests)
  const queryKey = req.query?.api_key || req.query?.key;

  const providedKey = headerKey || bearerKey || queryKey;

  if (!providedKey || providedKey !== expectedApiKey) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid API key. Provide via 'x-api-key' header, 'Authorization: Bearer <key>', or '?api_key=' parameter."
    });
  }

  next();
};

// Protect all /api routes with the API Key middleware
app.use("/api", requireApiKey, streamRoutes);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`movies-api listening on ${HOST}:${PORT}`);
});

export default app;
