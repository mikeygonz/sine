import { SOUND, soundUser } from "./_sound-prompt.js";

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
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const num = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const pair = (v, lo, hi, d) => {
  const a = Array.isArray(v) ? v : [v, v];
  return [num(a[0], lo, hi, d), num(a.length > 1 ? a[1] : a[0], lo, hi, d)];
};

export function clean(raw) {
  const parts = (Array.isArray(raw?.parts) ? raw.parts : []).slice(0, 8).map((p) => {
    let harm = (Array.isArray(p?.harm) ? p.harm : []).slice(0, 24).map((h) => num(h, 0, 1, 0));
    if (!harm.some((h) => h > 0.001)) harm = [1];
    return {
      ms: Math.round(num(p?.ms, 30, 1500, 200)),
      hz: pair(p?.hz, 40, 3000, 220),
      vol: pair(p?.vol, 0, 1, 0.8),
      harm,
      noise: num(p?.noise, 0, 1, 0),
    };
  });
  if (!parts.length) return null;
  let total = 0;
  const kept = parts.filter((p) => (total += p.ms) <= 3000 || p === parts[0]);
  return {
    parts: kept,
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

async function ask([model, effort], prompt, token, signal) {
  const r = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      reasoning: { effort },
      messages: [
        { role: "system", content: SOUND },
        { role: "user", content: soundUser(prompt) },
      ],
    }),
  });
  if (!r.ok) {
    console.warn("sound", model, r.status);
    return null;
  }
  const v = await r.json();
  if (v.usage) console.log("sound", model, JSON.stringify(v.usage));
  return parse(v.choices?.[0]?.message?.content || "");
}

const gatewayToken = (request) =>
  process.env.AI_GATEWAY_API_KEY || request.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN;

export async function POST(request) {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return json(429, { error: "slow down" });
  let prompt = "";
  try {
    prompt = String((await request.json()).prompt || "");
  } catch {}
  prompt = prompt.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT);
  if (!prompt) return json(400, { error: "nothing to hear" });
  const token = gatewayToken(request);
  if (!token) return json(501, { error: "sound from text is not set up" });
  for (const model of MODELS) {
    const out = await ask(model, prompt, token, request.signal).catch(() => null);
    if (out) return json(200, out);
  }
  return json(502, { error: "no model answered" });
}
