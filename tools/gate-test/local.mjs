// Runs api/draw.js in this process against the real Upstash Redis (under a throwaway key prefix) with a
// fake AI Gateway. Proves the gate logic: tries per IP, parallel bursts, the daily cap, own keys, refunds
// and failing closed.
//   node tools/gate-test/local.mjs .env.gate
import { cleanup, done, eq, loadEnv, ok, test } from "./lib.mjs";

loadEnv(process.argv[2] || ".env.gate");
const prefix = "gatetest" + Math.random().toString(36).slice(2, 8);
Object.assign(process.env, {
  GATE_PREFIX: prefix,
  GATE_SECRET: "test-only-" + Math.random(),
  AI_GATEWAY_API_KEY: "server-value-not-real",
  FREE_BURST: "1000",
  FREE_DAILY_CAP: "300",
});
delete process.env.VERCEL; // off Vercel there is no BotID check; the preview test covers that

// ---- fake gateway: records every call, passes Redis through to the real one ----
let mode = "points";
const calls = [];
const realFetch = globalThis.fetch;
const OWN = "vck_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";
const circle = Array.from({ length: 16 }, (_, i) => {
  const t = (i / 16) * 2 * Math.PI;
  return `${Math.round(500 + 300 * Math.cos(t))},${Math.round(500 + 300 * Math.sin(t))}`;
});
let redisDown = false;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith(process.env.KV_REST_API_URL)) {
    if (redisDown) throw new Error("redis down");
    return realFetch(url, init);
  }
  calls.push({ url, auth: init.headers?.authorization });
  if (!url.startsWith("https://ai-gateway.vercel.sh/")) throw new Error("unexpected host " + url);
  if (mode === "down") return new Response("no", { status: 500 });
  if (mode === "unauth") return new Response("no", { status: 401 });
  const lines = mode === "empty" ? [] : circle;
  const body = lines.map((l) => `data: ${JSON.stringify({ choices: [{ delta: { content: l + "\n" } }] })}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

const logs = [];
for (const k of ["log", "warn", "error"]) {
  const orig = console[k];
  console[k] = (...a) => (logs.push(a.join(" ")), k === "log" && orig(...a));
}

const { GET, POST } = await import("../../api/draw.js");
let ipn = 0;
const newIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${++ipn}`;
const req = (ip, { key, prompt = "a cat", method = "POST", extra = {} } = {}) =>
  new Request("https://sine.test/api/draw", {
    method,
    headers: { "x-real-ip": ip, "content-type": "application/json", ...(key && { "x-gateway-key": key }), ...extra },
    ...(method === "POST" && { body: JSON.stringify({ prompt }) }),
  });
async function draw(ip, opts) {
  const r = await POST(req(ip, opts));
  const text = await r.text(); // read the stream to the end, like a browser would
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, code: json?.code, text, headers: r.headers };
}
const left = async (ip) => (await (await GET(req(ip, { method: "GET" }))).json()).free.left;

await test("a fresh IP has 3 tries, and GET says so", async () => {
  eq(await left(newIp()), 3, "left at start");
});

await test("the 4th call from the same IP is refused, with no cookies or other state", async () => {
  const ip = newIp();
  for (let i = 0; i < 3; i++) {
    const r = await draw(ip);
    eq(r.status, 200, `call ${i + 1}`);
    eq(r.headers.get("x-free-left"), String(2 - i), "x-free-left");
  }
  const r = await draw(ip, { extra: { cookie: "a=b", "user-agent": "another browser" } });
  eq([r.status, r.code], [402, "tries"], "4th call");
  eq(await left(ip), 0, "left after");
});

await test("a client-supplied x-forwarded-for cannot dodge the count (x-real-ip wins)", async () => {
  const ip = newIp();
  for (let i = 0; i < 3; i++) await draw(ip);
  eq((await draw(ip, { extra: { "x-forwarded-for": "1.1.1.1" } })).status, 402, "spoofed header");
});

await test("10 parallel calls from one IP let exactly 3 through (the rest hit the Redis count)", async () => {
  const ip = newIp();
  const rs = await Promise.all(Array.from({ length: 10 }, () => draw(ip)));
  eq(rs.filter((r) => r.status === 200).length, 3, "200s");
  eq(rs.filter((r) => r.code === "tries").length, 7, "refused by the Redis count");
  eq(await left(ip), 0, "left");
});

await test("25 parallel calls from one IP still let only 3 through", async () => {
  const ip = newIp();
  const rs = await Promise.all(Array.from({ length: 25 }, () => draw(ip)));
  eq(rs.filter((r) => r.status === 200).length, 3, "200s");
  eq(await left(ip), 0, "left");
});

await test("the burst limit stops rapid calls, refused ones included", async () => {
  process.env.FREE_BURST = "4";
  const ip = newIp();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await draw(ip)).code ?? "ok");
  process.env.FREE_BURST = "1000";
  eq(codes, ["ok", "ok", "ok", "tries", "burst", "burst"], "sequence");
});

await test("the global daily cap holds across many IPs, in parallel", async () => {
  process.env.FREE_DAILY_CAP = "5";
  process.env.GATE_PREFIX = prefix + "cap"; // its own day counter
  const ips = Array.from({ length: 4 }, newIp);
  const rs = await Promise.all(ips.flatMap((ip) => [1, 2, 3].map(() => draw(ip))));
  process.env.FREE_DAILY_CAP = "300";
  process.env.GATE_PREFIX = prefix;
  eq(rs.filter((r) => r.status === 200).length, 5, "200s");
  eq(rs.filter((r) => r.code === "cap").length, 7, "the other 7 got code cap");
});

await test("an own key bypasses the gate and does not touch the free count", async () => {
  const ip = newIp();
  for (let i = 0; i < 3; i++) await draw(ip);
  eq((await draw(ip)).code, "tries", "out of tries");
  calls.length = 0;
  const r = await draw(ip, { key: OWN });
  eq(r.status, 200, "own key call");
  ok(r.text.split("\n").filter(Boolean).length >= 12, "points streamed");
  eq(calls.length, 1, "one gateway call");
  eq(calls[0].auth, `Bearer ${OWN}`, "gateway got the visitor's key, not the server's");
  eq(await left(ip), 0, "free count unchanged");
  const fresh = newIp();
  await draw(fresh, { key: OWN });
  eq(await left(fresh), 3, "own key calls spend no free tries");
});

await test("the key goes only to ai-gateway.vercel.sh and never shows up in responses or logs", async () => {
  const ip = newIp();
  calls.length = 0;
  const r1 = await draw(ip, { key: OWN });
  mode = "unauth";
  const r2 = await draw(ip, { key: OWN });
  mode = "points";
  const r3 = await draw(ip, { key: "vck_short" });
  const r4 = await draw(ip, { key: "not a key at all " + OWN });
  eq([r2.status, r2.code], [401, "key"], "gateway refused the key");
  eq([r3.status, r3.code], [400, "key"], "short key");
  eq([r4.status, r4.code], [400, "key"], "garbage key");
  for (const r of [r1, r2, r3, r4])
    ok(!r.text.includes(OWN) && ![...r.headers.values()].some((v) => v.includes(OWN)), "key echoed in a response");
  ok(logs.every((l) => !l.includes(OWN)), "key found in logs");
  for (const c of calls) ok(c.url.startsWith("https://ai-gateway.vercel.sh/"), "gateway call to " + c.url);
  eq(await left(ip), 3, "bad keys cost no tries");
});

await test("a gateway failure refunds the try", async () => {
  const ip = newIp();
  mode = "down";
  const r = await draw(ip);
  mode = "points";
  eq([r.status, r.code], [502, "down"], "failed call");
  eq(await left(ip), 3, "try came back");
  const rs = await Promise.all(Array.from({ length: 3 }, () => draw(ip)));
  eq(rs.filter((x) => x.status === 200).length, 3, "all 3 still usable");
});

await test("a stream with no points refunds the IP's try, up to 5 a day", async () => {
  const ip = newIp();
  mode = "empty";
  const seen = [];
  for (let i = 0; i < 7; i++) {
    await draw(ip);
    seen.push(await left(ip));
  }
  mode = "points";
  eq(seen, [3, 3, 3, 3, 3, 2, 1], "tries left after each empty draw");
});

await test("fail closed: Redis unreachable refuses free calls, own keys still work", async () => {
  redisDown = true;
  const ip = newIp();
  const free = await draw(ip);
  const byo = await draw(ip, { key: OWN });
  const g = await (await GET(req(ip, { method: "GET" }))).json();
  redisDown = false;
  eq([free.status, free.code], [503, "paused"], "free call");
  eq(byo.status, 200, "own key call");
  eq(g.free.left, null, "GET reports unknown");
});

await test("fail closed: no server secret, or no IP, refuses free calls", async () => {
  const s = process.env.GATE_SECRET;
  delete process.env.GATE_SECRET;
  const a = await draw(newIp());
  process.env.GATE_SECRET = s;
  const b = await POST(new Request("https://sine.test/api/draw", { method: "POST", body: JSON.stringify({ prompt: "a cat" }) }));
  eq(a.code, "paused", "no secret");
  eq(b.status, 503, "no ip");
});

await test("empty prompts cost nothing, long ones are cut and count once", async () => {
  const ip = newIp();
  eq((await draw(ip, { prompt: "   " })).status, 400, "empty");
  eq(await left(ip), 3, "empty prompt costs nothing");
  await draw(ip, { prompt: "x".repeat(500) });
  eq(await left(ip), 2, "long prompt counts once");
});

console.log("cleaned", (await cleanup(prefix)) + (await cleanup(prefix + "cap")), "test keys");
done();
