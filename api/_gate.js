// The free-tries gate for api/draw.js. Counts live in Upstash Redis (REST API, plain fetch), keyed by a
// hash of the client IP, so nothing the browser sends can reset them. Every check is one Lua script, so
// parallel requests cannot race past the limit.
import { createHmac } from "node:crypto";

const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : d);
const E = process.env;

export const FREE_TRIES = 3; // anonymous drawings per IP
export const DAILY_CAP = () => num(E.FREE_DAILY_CAP, 300); // free drawings per day across everyone
const BURST = () => num(E.FREE_BURST, 5), // free requests per IP per minute, refused ones included
  BURST_SECS = 60,
  IP_DAYS = 30, // an IP's count expires 30 days after its first free drawing, so storage stays bounded
  REFUNDS = 5; // refunds per IP per day: stops "ask until the model returns nothing" loops
const url = () => E.KV_REST_API_URL || E.UPSTASH_REDIS_REST_URL,
  auth = () => E.KV_REST_API_TOKEN || E.UPSTASH_REDIS_REST_TOKEN,
  prefix = () => E.GATE_PREFIX || "sine";

// Redis is reachable and a server secret exists, or free calls are refused.
export const gateReady = () => !!(url() && auth() && E.GATE_SECRET);

// Vercel sets x-real-ip and overwrites x-forwarded-for, so neither comes from the client. IPv6
// clients are grouped by /64 so a rotating address inside one network does not count as new.
export function clientIp(headers) {
  const raw = (
    headers.get("x-real-ip") ||
    headers.get("x-vercel-forwarded-for") ||
    (headers.get("x-forwarded-for") || "").split(",")[0]
  ).trim();
  if (!raw) return "";
  if (!raw.includes(":")) return raw;
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (v4) return v4[1];
  const [head, tail = ""] = raw.toLowerCase().split("::");
  const a = head ? head.split(":") : [],
    b = tail ? tail.split(":") : [];
  const groups = raw.includes("::") ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

const hash = (ip) => createHmac("sha256", E.GATE_SECRET).update(ip).digest("hex").slice(0, 32);
const keys = (ip) => {
  const h = hash(ip),
    p = prefix();
  return [`${p}:ip:${h}`, `${p}:day:${new Date().toISOString().slice(0, 10)}`, `${p}:burst:${h}`, `${p}:ref:${h}`];
};

async function redis(cmd, ms = 2500) {
  const r = await fetch(url(), {
    method: "POST",
    headers: { authorization: `Bearer ${auth()}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(ms),
  });
  const v = await r.json();
  if (!r.ok || v.error) throw new Error("redis");
  return v.result;
}

const RESERVE = `
local b = redis.call('INCR', KEYS[3])
if b == 1 then redis.call('EXPIRE', KEYS[3], ARGV[4]) end
if b > tonumber(ARGV[3]) then return {'burst', 0} end
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used >= tonumber(ARGV[1]) then return {'tries', 0} end
local day = tonumber(redis.call('GET', KEYS[2]) or '0')
if day >= tonumber(ARGV[2]) then return {'cap', tonumber(ARGV[1]) - used} end
if redis.call('INCR', KEYS[1]) == 1 then redis.call('EXPIRE', KEYS[1], ARGV[5]) end
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], 172800) end
return {'ok', tonumber(ARGV[1]) - used - 1}`;

const REFUND = `
local r = redis.call('INCR', KEYS[3])
if r == 1 then redis.call('EXPIRE', KEYS[3], 86400) end
if r > tonumber(ARGV[1]) then return 0 end
if tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then redis.call('DECR', KEYS[1]) end
if ARGV[2] == '1' and tonumber(redis.call('GET', KEYS[2]) or '0') > 0 then redis.call('DECR', KEYS[2]) end
return 1`;

// -> {status: "ok" | "tries" | "cap" | "burst", left}. Throws if Redis cannot be reached.
export async function reserve(ip) {
  const [k1, k2, k3] = keys(ip);
  const [status, left] = await redis([
    "EVAL", RESERVE, "3", k1, k2, k3,
    String(FREE_TRIES), String(DAILY_CAP()), String(BURST()), String(BURST_SECS), String(IP_DAYS * 86400),
  ]);
  return { status, left: Math.max(0, +left) };
}

// Give a reserved try back. day = false keeps the global count, for calls that already cost tokens.
export async function refund(ip, day = true) {
  const [k1, k2, , k4] = keys(ip);
  await redis(["EVAL", REFUND, "3", k1, k2, k4, String(REFUNDS), day ? "1" : "0"]).catch(() => {});
}

// Free tries left for this IP, or null if Redis cannot be reached.
export async function remaining(ip) {
  try {
    const used = +((await redis(["GET", keys(ip)[0]], 600)) || 0); // the page waits on this
    return Math.max(0, FREE_TRIES - used);
  } catch {
    return null;
  }
}
