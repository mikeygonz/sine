// Optional. Powers the "Type something for AI to draw" box; the rest of Sine needs no server.
// POST /api/draw {prompt} -> text/plain stream of "x,y\n" points (0-1000 box).
// GET /api/draw -> {ok, free}: whether a gateway token is set, so the page knows to show the box, and how
// many free tries this IP has left.
// Each IP gets 3 free drawings, counted on the server (_gate.js). After that a caller sends their own AI
// Gateway key in the x-gateway-key header; it is used for that one call and never stored or logged.
// The model writes sparse key points; each one is joined to the last with a spline (_spline.js)
// and sent on at once, so the shape forms live on the page.
// Calls go through Vercel AI Gateway with AI_GATEWAY_API_KEY, or the project's OIDC token when
// deployed on Vercel.
import { SYSTEM, user } from "./_prompt.js";
import { spline } from "./_spline.js";
import { FREE_TRIES, clientIp, gateReady, refund, remaining, reserve } from "./_gate.js";

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
  LIMIT = 12,
  WINDOW = 60_000;
const KEY = /^vck_[A-Za-z0-9_-]{20,200}$/; // an AI Gateway API key
const PT = /^\s*(\d{1,4})\s*,\s*(\d{1,4})\s*$/;
const hits = new Map(); // best-effort per-instance limit, a cheap first check before Redis

function limited(ip) {
  const now = Date.now(),
    list = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > LIMIT;
}
const json = (status, error, code, extra) =>
  new Response(JSON.stringify({ error, code, ...extra }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
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
function points(sse, onEnd) {
  const rd = sse.getReader(),
    dec = new TextDecoder(),
    enc = new TextEncoder(),
    curve = spline();
  let buf = "",
    text = "",
    n = 0,
    ended = false;
  const end = async () => {
    if (!ended) {
      ended = true;
      await onEnd?.(n);
    }
  };
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
        const { value, done } = await rd.read().catch(async (e) => {
          await end();
          throw e;
        });
        if (done) {
          take(text);
          emit(curve.end());
          send();
          await end();
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
          await end();
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
    async cancel() {
      await end();
      return rd.cancel();
    },
  });
}

const serverToken = (request) =>
  process.env.AI_GATEWAY_API_KEY || request.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN;

// BotID check on free calls: "ok", "bot", or "error" when it could not answer (which refuses the call too).
// Off Vercel (local dev) there is nothing to check against, so it passes.
async function botCheck() {
  if (!process.env.VERCEL) return "ok";
  try {
    const { checkBotId } = await import("botid/server");
    return (await checkBotId({ advancedOptions: { checkLevel: "basic" } })).isBot === false ? "ok" : "bot";
  } catch (e) {
    console.warn("botid", String(e?.message || e).slice(0, 120));
    return "error";
  }
}

export async function GET(request) {
  const ok = !!serverToken(request);
  const ip = clientIp(request.headers);
  const left = ok && ip && gateReady() ? await remaining(ip) : null;
  return Response.json({ ok, free: { left, limit: FREE_TRIES } }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request) {
  const ip = clientIp(request.headers);
  if (limited(ip || "unknown")) return json(429, "slow down", "burst");

  // their own key: validated, used for this call only, never stored, logged or echoed
  const given = request.headers.get("x-gateway-key");
  const own = given === null ? null : given.trim();
  if (own !== null && !KEY.test(own)) return json(400, "that does not look like a gateway key", "key");

  let prompt = "";
  try {
    prompt = String((await request.json()).prompt || "");
  } catch {}
  prompt = prompt.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT);
  if (!prompt) return json(400, "nothing to draw", "prompt");

  let token = own,
    reserved = false,
    left = 0;
  if (own === null) {
    token = serverToken(request);
    if (!token) return json(501, "drawing from text is not set up", "off");
    const bot = await botCheck();
    if (bot === "bot") return json(403, "blocked as a bot", "bot");
    if (bot === "error") return json(503, "free drawing is paused", "paused");
    // fail closed: no IP, no secret, or no Redis means no free calls
    if (!ip || !gateReady()) return json(503, "free drawing is paused", "paused");
    let g;
    try {
      g = await reserve(ip);
    } catch {
      return json(503, "free drawing is paused", "paused");
    }
    if (g.status === "burst") return json(429, "slow down", "burst");
    if (g.status === "tries") return json(402, "you used your 3 free tries", "tries", { left: 0 });
    if (g.status === "cap") return json(503, "free drawing is full for today", "cap", { left: g.left });
    reserved = true;
    left = g.left;
  }

  for (const model of MODELS) {
    const r = await gateway(model, prompt, token, request.signal).catch(() => null);
    if (r?.ok && r.body) {
      // a stream that ends with no points still spent tokens, so only the IP's try comes back
      const body = points(r.body, (n) => {
        if (reserved && n === 0) return refund(ip, false);
      });
      return new Response(body, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          ...(reserved && { "x-free-left": String(left) }),
        },
      });
    }
    console.warn("draw", model[0], r ? r.status : "unreachable");
    if (own !== null && r && (r.status === 401 || r.status === 403))
      return json(401, "the gateway did not accept that key", "key");
  }
  if (reserved) await refund(ip, true);
  return json(502, "no model answered", "down");
}
