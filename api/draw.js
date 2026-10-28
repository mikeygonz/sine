// Optional. Powers the "Type something for AI to draw" box; the rest of Sine needs no server.
// POST /api/draw {prompt} -> text/plain stream of "x,y\n" points (0-1000 box).
// GET /api/draw -> {ok}: whether a gateway token is set, so the page knows to show the box.
// The model writes sparse key points; each one is joined to the last with a spline (_spline.js)
// and sent on at once, so the shape forms live on the page.
// Calls go through Vercel AI Gateway with AI_GATEWAY_API_KEY, or the project's OIDC token when
// deployed on Vercel.
import { SYSTEM, user } from "./_prompt.js";
import { spline } from "./_spline.js";

// [model, reasoning effort], fastest first; the last is another provider in case one is down.
// Low effort lets the model plan the pen's route without delaying the first point.
const MODELS = [
  ["openai/gpt-6.1-sol-fast", "low"],
  ["openai/gpt-6.1-sol", "low"],
  ["google/gemini-4-argon", "low"],
];
const MAX_PROMPT = 60,
  MAX_TOKENS = 4000,
  MAX_POINTS = 600,
  LIMIT = 8,
  WINDOW = 60_000;
const PT = /^\s*(\d{1,4})\s*,\s*(\d{1,4})\s*$/;
const hits = new Map(); // best-effort per-instance rate limit

function limited(ip) {
  const now = Date.now(),
    list = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > LIMIT;
}
const json = (status, error) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
const clamp = (v) => Math.max(0, Math.min(1000, Math.round(v)));

async function gateway([model, effort], prompt, token, signal) {
  return fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: MAX_TOKENS,
      reasoning: { effort },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user(prompt) },
      ],
    }),
  });
}

// The gateway's SSE stream -> smoothed "x,y\n" lines, capped, sent as each key point lands.
function points(sse) {
  const rd = sse.getReader(),
    dec = new TextDecoder(),
    enc = new TextEncoder(),
    curve = spline();
  let buf = "",
    text = "",
    n = 0;
  return new ReadableStream({
    // keep reading until a point is ready: a pull that enqueues nothing is never called again
    async pull(ctrl) {
      const out = [];
      const emit = (pts) => {
        for (const [x, y] of pts)
          if (n < MAX_POINTS) {
            out.push(`${clamp(x)},${clamp(y)}\n`);
            n++;
          }
      };
      const take = (line) => {
        const m = PT.exec(line);
        if (m) emit(curve.push([Math.min(1000, +m[1]), Math.min(1000, +m[2])]));
      };
      const send = () => {
        if (out.length) ctrl.enqueue(enc.encode(out.join("")));
      };
      for (;;) {
        const { value, done } = await rd.read();
        if (done) {
          take(text);
          emit(curve.end());
          send();
          ctrl.close();
          return;
        }
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:") || line === "data: [DONE]") continue;
          try {
            text += JSON.parse(line.slice(5)).choices?.[0]?.delta?.content || "";
          } catch {}
          let j;
          while ((j = text.indexOf("\n")) >= 0) {
            take(text.slice(0, j));
            text = text.slice(j + 1);
          }
        }
        if (n >= MAX_POINTS) {
          send();
          ctrl.close();
          rd.cancel();
          return;
        }
        if (out.length) {
          send();
          return;
        }
      }
    },
    cancel() {
      return rd.cancel();
    },
  });
}

const gatewayToken = (request) =>
  process.env.AI_GATEWAY_API_KEY || request.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN;

export function GET(request) {
  return Response.json({ ok: !!gatewayToken(request) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request) {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return json(429, "slow down");
  let prompt = "";
  try {
    prompt = String((await request.json()).prompt || "");
  } catch {}
  prompt = prompt.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT);
  if (!prompt) return json(400, "nothing to draw");
  const token = gatewayToken(request);
  if (!token) return json(501, "drawing from text is not set up");
  for (const model of MODELS) {
    const r = await gateway(model, prompt, token, request.signal).catch(() => null);
    if (r?.ok && r.body)
      return new Response(points(r.body), {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    console.warn("draw", model[0], r ? r.status : "unreachable");
  }
  return json(502, "no model answered");
}
