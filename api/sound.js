import { SOUND, soundUser, PICK, pickUser } from "./_sound-prompt.js";

const MODELS = [
  ["openai/gpt-6.1-sol-fast", "low"],
  ["openai/gpt-6.1-sol", "low"],
  ["google/gemini-4-argon", "low"],
];
const MAX_PROMPT = 60,
  LIMIT = 8,
  WINDOW = 60_000;
const hits = new Map();

function limited(ip) {
  const now = Date.now(),
    list = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > LIMIT;
}
const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const num = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

export function clean(raw) {
  const keys = (Array.isArray(raw?.keys) ? raw.keys : []).slice(0, 16);
  if (keys.length < 2) return null;
  const voiced = Array.isArray(keys[0]?.f) && keys[0].f.length > 0;
  const DEF = [500, 1500, 2500];
  let last = -1;
  const out = keys.map((k) => {
    const t = Math.max(last + 1, Math.round(num(k?.t, 0, 2500, last + 50)));
    last = t;
    const f = voiced
      ? DEF.map((d, i) =>
          Math.round(num(Array.isArray(k?.f) ? k.f[i] : d, 150, 5000, d)),
        )
      : [];
    return {
      t,
      hz: num(k?.hz, 40, 3000, 220),
      vol: num(k?.vol, 0, 1, 0.5),
      f,
      noise: num(k?.noise, 0, 1, 0),
      tilt: num(k?.tilt, 0.4, 3, 1.2),
      odd: num(k?.odd, 0, 1, 0),
    };
  });
  const t0 = out[0].t;
  for (const k of out) k.t -= t0;
  if (out[out.length - 1].t < 30) return null;
  const v = Array.isArray(raw.vibrato) ? raw.vibrato : [0, 0];
  return {
    keys: out,
    vibrato: [num(v[0], 0, 12, 0), num(v[1], 0, 2, 0)],
    jitter: num(raw.jitter, 0, 1, 0),
    growl: num(raw.growl, 0, 1, 0),
    noiseHz: Math.round(num(raw.noiseHz, 200, 8000, 1500)),
    repeat: Math.round(num(raw.repeat, 1, 4, 1)),
    gap: Math.round(num(raw.gap, 0, 1500, 300)),
  };
}

function parse(text) {
  const a = text.indexOf("{"),
    b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return clean(JSON.parse(text.slice(a, b + 1)));
  } catch {
    return null;
  }
}

async function chat(system, user, max, token, signal) {
  for (const [model, effort] of MODELS) {
    const r = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: max,
        reasoning: { effort },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    }).catch(() => null);
    if (!r?.ok) {
      console.warn("sound", model, r ? r.status : "unreachable");
      continue;
    }
    const v = await r.json();
    if (v.usage)
      console.log(
        "sound",
        model,
        v.usage.prompt_tokens,
        v.usage.completion_tokens,
        v.usage.cost,
      );
    const text = v.choices?.[0]?.message?.content;
    if (text) return text;
  }
  return null;
}

const UA = { "user-agent": "Sine/1.0 (https://sine.gonz.co)" };
const LICENSE = /^(CC0|Public domain|CC BY(-SA)? \d\.\d)/i;
const strip = (h) =>
  String(h || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

export function query(prompt) {
  const q = prompt
    .toLowerCase()
    .replace(
      /\b(make|play|the|a|an|of|sound|sounds|noise|noises|like|me)\b/g,
      " ",
    )
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return q || prompt;
}

async function search(q, signal) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${q} filetype:audio`,
    gsrlimit: "12",
    prop: "videoinfo",
    viprop: "url|size|derivatives|extmetadata",
    viextmetadatafilter: "LicenseShortName|Artist",
  }))
    u.searchParams.set(k, v);
  const r = await fetch(u, { headers: UA, signal }).catch(() => null);
  if (!r?.ok) return [];
  const pages = Object.values(
    (await r.json().catch(() => ({})))?.query?.pages || {},
  );
  return pages
    .sort((a, b) => a.index - b.index)
    .map((p) => {
      const v = p.videoinfo?.[0] || {},
        m = v.extmetadata || {},
        mp3 = (v.derivatives || []).find((d) => d.type === "audio/mpeg");
      return {
        title: p.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
        artist: strip(m.Artist?.value),
        license: strip(m.LicenseShortName?.value),
        page: v.descriptionurl,
        src: mp3?.src,
        dur: Number(v.duration || 0),
      };
    })
    .filter(
      (c) =>
        c.src &&
        c.page &&
        LICENSE.test(c.license) &&
        (!c.dur || (c.dur >= 0.4 && c.dur <= 90)),
    )
    .slice(0, 8);
}

async function pick(prompt, list, token, signal) {
  if (list.length === 1) return 0;
  const text = await chat(
    PICK,
    pickUser(
      prompt,
      list.map((c) => `${c.title}${c.dur ? ` (${c.dur.toFixed(1)} s)` : ""}`),
    ),
    800,
    token,
    signal,
  );
  const n = parseInt(String(text || "").match(/-?\d+/)?.[0] ?? "0", 10);
  return n >= 0 && n < list.length ? n : -1;
}

const gatewayToken = (request) =>
  process.env.AI_GATEWAY_API_KEY ||
  request.headers.get("x-vercel-oidc-token") ||
  process.env.VERCEL_OIDC_TOKEN;

const MEDIA =
  /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/transcoded\/[^?#]+\.mp3$/;
export async function GET(request) {
  const src = new URL(request.url).searchParams.get("src") || "";
  if (!MEDIA.test(src)) return json(400, { error: "not a recording" });
  const r = await fetch(src, { headers: UA }).catch(() => null);
  if (!r?.ok || !r.body) return json(502, { error: "recording not found" });
  if (+(r.headers.get("content-length") || 0) > 6e6)
    return json(413, { error: "recording too long" });
  return new Response(r.body, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "public, max-age=86400",
    },
  });
}

export async function POST(request) {
  const ip =
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
  if (limited(ip)) return json(429, { error: "slow down" });
  let prompt = "";
  try {
    prompt = String((await request.json()).prompt || "");
  } catch {}
  prompt = prompt.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT);
  if (!prompt) return json(400, { error: "nothing to hear" });
  const token = gatewayToken(request);
  if (!token) return json(501, { error: "sound from text is not set up" });
  const list = await search(query(prompt), request.signal);
  if (list.length) {
    const i = await pick(prompt, list, token, request.signal);
    if (i >= 0) {
      const { title, artist, license, page, src } = list[i];
      return json(200, {
        recording: {
          title,
          artist,
          license,
          page,
          src: `/api/sound?src=${encodeURIComponent(src)}`,
        },
      });
    }
  }
  const out = parse(
    (await chat(SOUND, soundUser(prompt), 4000, token, request.signal)) || "",
  );
  return out
    ? json(200, { recipe: out })
    : json(502, { error: "no model answered" });
}
