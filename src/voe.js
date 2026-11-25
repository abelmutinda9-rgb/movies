const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function voeExtractUrl(voeUrl) {
  try {
    const res = await fetch(voeUrl, {
      headers: {
        "User-Agent": UA,
        Referer: "https://voe.sx/",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const html = await res.text();

    // 1. Direct HLS match: 'hls': 'https://...'
    const hlsMatch = html.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i);
    if (hlsMatch && hlsMatch[1]) {
      return {
        url: hlsMatch[1],
        type: "hls",
        provider: "voe",
        providerName: "VOE HLS",
        headers: { Referer: "https://voe.sx/" },
      };
    }

    // 2. Base64 encoded JSON source: sources = {"hls": "..."}
    const b64Match = html.match(/sources\s*=\s*['"]([A-Za-z0-9+/=]{20,})['"]/);
    if (b64Match && b64Match[1]) {
      try {
        const decoded = JSON.parse(Buffer.from(b64Match[1], "base64").toString("utf-8"));
        if (decoded.hls) {
          return {
            url: decoded.hls,
            type: "hls",
            provider: "voe",
            providerName: "VOE HLS",
            headers: { Referer: "https://voe.sx/" },
          };
        }
      } catch {}
    }

    // 3. Alternative redirect match
    const redirMatch = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
    if (redirMatch && redirMatch[1] && !redirMatch[1].startsWith(voeUrl)) {
      return voeExtractUrl(redirMatch[1]);
    }

    return null;
  } catch (e) {
    return null;
  }
}
