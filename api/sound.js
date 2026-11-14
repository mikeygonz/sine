const MAX_PROMPT = 60,
  SECONDS = 2.5,
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
const json = (status, error) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

const gatewayToken = (request) =>
  process.env.AI_GATEWAY_API_KEY ||
  request.headers.get("x-vercel-oidc-token") ||
  process.env.VERCEL_OIDC_TOKEN;

export async function POST(request) {
  const ip =
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
  if (limited(ip)) return json(429, "slow down");
  let prompt = "";
  try {
    prompt = String((await request.json()).prompt || "");
  } catch {}
  prompt = prompt.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT);
  if (!prompt) return json(400, "nothing to hear");
  const token = gatewayToken(request);
  if (!token) return json(501, "sound from text is not set up");
  const r = await fetch("https://ai-gateway.vercel.sh/v4/ai/speech-model", {
    method: "POST",
    signal: request.signal,
    headers: {
      authorization: `Bearer ${token}`,
      "ai-gateway-protocol-version": "0.0.1",
      "ai-speech-model-specification-version": "4",
      "ai-model-id": "elevenlabs/sound-effects-v2",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: prompt,
      providerOptions: { elevenlabs: { durationSeconds: SECONDS } },
    }),
  }).catch(() => null);
  if (!r?.ok) {
    console.warn("sound", r ? r.status : "unreachable");
    return json(502, "no sound came back");
  }
  const v = await r.json().catch(() => null);
  if (!v?.audio) return json(502, "no sound came back");
  return new Response(Buffer.from(v.audio, "base64"), {
    headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
  });
}
