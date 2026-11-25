const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Standard P.A.C.K.E.R. unpacker
function unpackPacker(packed) {
  const m = packed.match(/}\s*\(\s*['"]([\s\S]+?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"]([\s\S]+?)['"]\.split\(['"]\|['"]\)/);
  if (!m) return null;
  const [, payload, radixStr, countStr, syms] = m;
  const radix = parseInt(radixStr, 10);
  const count = parseInt(countStr, 10);
  const symtab = syms.split("|");
  if (symtab.length !== count) return null;

  const unbase = (val) => {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let res = 0;
    for (let i = 0; i < val.length; i++) {
      const idx = chars.indexOf(val[i]);
      if (idx === -1 || idx >= radix) return 0;
      res = res * radix + idx;
    }
    return res;
  };

  return payload.replace(/\b\w+\b/g, (token) => {
    const idx = radix <= 36 ? parseInt(token, radix) : unbase(token);
    return isNaN(idx) || !symtab[idx] ? token : symtab[idx];
  });
}

export async function streamwishExtractUrl(embedUrl, providerName = "StreamWish") {
  try {
    const res = await fetch(embedUrl, {
      headers: {
        "User-Agent": UA,
        Referer: embedUrl,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const html = await res.text();

    let scriptText = html;
    const packerMatch = html.match(/eval\(function\(p,a,c,k,e,d[\s\S]*?\.split\(['"]\|['"]\)\)\)/);
    if (packerMatch) {
      const unpacked = unpackPacker(packerMatch[0]);
      if (unpacked) scriptText = unpacked;
    }

    // Extract HLS: sources: [{file: "https://.../master.m3u8"}] or "hls2": "..." or "file": "..."
    const m3u8Match =
      scriptText.match(/sources\s*:\s*\[\s*\{\s*(?:file|src)\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i) ||
      scriptText.match(/['"](?:hls|hls2|file|src)['"]\s*:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i) ||
      scriptText.match(/(https?:\/\/[^'"]+\/master\.m3u8[^'"]*)/i);

    if (m3u8Match && m3u8Match[1]) {
      return {
        url: m3u8Match[1],
        type: "hls",
        provider: "streamwish",
        providerName,
        headers: {
          Referer: embedUrl,
          Origin: new URL(embedUrl).origin,
        },
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}
