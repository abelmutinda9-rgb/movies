const idMap = new Map();

const LANG_NAMES = {
  eng: "English",
  spa: "Spanish",
  fre: "French",
  fra: "French",
  ger: "German",
  deu: "German",
  ita: "Italian",
  por: "Portuguese",
  pob: "Portuguese (Brazil)",
  rus: "Russian",
  ara: "Arabic",
  hin: "Hindi",
  ben: "Bengali",
  pan: "Punjabi",
  tam: "Tamil",
  tel: "Telugu",
  kan: "Kannada",
  mal: "Malayalam",
  zho: "Chinese",
  chi: "Chinese",
  jpn: "Japanese",
  kor: "Korean",
  tur: "Turkish",
  pol: "Polish",
  nld: "Dutch",
  dut: "Dutch",
  swe: "Swedish",
  nor: "Norwegian",
  dan: "Danish",
  fin: "Finnish",
  ell: "Greek",
  gre: "Greek",
  heb: "Hebrew",
  cze: "Czech",
  ces: "Czech",
  hun: "Hungarian",
  rum: "Romanian",
  ron: "Romanian",
  bul: "Bulgarian",
  srp: "Serbian",
  hrv: "Croatian",
  slv: "Slovenian",
  slk: "Slovak",
  ukr: "Ukrainian",
  vie: "Vietnamese",
  tha: "Thai",
  ind: "Indonesian",
  may: "Malay",
  msa: "Malay",
  fil: "Filipino",
  per: "Persian",
  fas: "Persian",
};

export function getLanguageName(code) {
  if (!code) return "Unknown";
  const clean = code.toLowerCase().trim();
  return LANG_NAMES[clean] || clean.toUpperCase();
}

export async function resolveImdbId(type, id) {
  if (!id) return null;
  const strId = String(id).trim();
  if (strId.startsWith("tt")) return strId;

  const cacheKey = `${type}:${strId}`;
  if (idMap.has(cacheKey)) return idMap.get(cacheKey);

  try {
    const prop = type === "movie" ? "P4947" : "P4983";
    const sparql = `SELECT ?imdb WHERE { ?item wdt:${prop} "${strId}" . ?item wdt:P345 ?imdb }`;
    const r = await fetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
      {
        headers: { "User-Agent": "MoviesAPI/1.0 (subtitles)" },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!r.ok) return null;
    const data = await r.json();
    const imdb = data.results?.bindings?.[0]?.imdb?.value;
    if (imdb) {
      idMap.set(cacheKey, imdb);
      return imdb;
    }
  } catch (err) {
    console.log("[subtitles] wikidata error:", err.message);
  }
  return null;
}

export async function getSubtitles(type, id, season = 1, episode = 1) {
  const imdbId = await resolveImdbId(type, id);
  if (!imdbId) return [];

  const subUrl =
    type === "movie"
      ? `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`
      : `https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${season}:${episode}.json`;

  try {
    const res = await fetch(subUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list = data.subtitles || [];

    return list.map((s) => {
      const lang = s.lang || "eng";
      const language = getLanguageName(lang);
      const isVtt = s.url?.endsWith(".vtt");
      return {
        id: s.id,
        lang,
        language,
        label: `${language}${s.movieReleaseName ? ` (${s.movieReleaseName})` : ""}`,
        url: s.url,
        format: isVtt ? "vtt" : "srt",
        // Direct proxy URL to serve standard WebVTT with CORS headers
        vttUrl: `/api/subtitles/vtt?url=${encodeURIComponent(s.url)}`,
      };
    });
  } catch (err) {
    console.log("[subtitles] fetch error:", err.message);
    return [];
  }
}

export function srtToVtt(srtContent) {
  if (!srtContent) return "WEBVTT\n\n";
  const normalized = srtContent.replace(/\r\n|\r/g, "\n");
  const converted = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return "WEBVTT\n\n" + converted;
}
