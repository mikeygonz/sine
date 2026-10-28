// Shared bits for the gate tests: env loading, a tiny assert runner, and Redis cleanup.
import { readFileSync } from "node:fs";

export function loadEnv(file) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) process.env[m[1]] ??= m[2].replace(/^"|"$/g, "");
  }
}

export const results = [];
export async function test(name, fn) {
  try {
    await fn();
    results.push([name, true]);
    console.log("pass", name);
  } catch (e) {
    results.push([name, false]);
    console.log("FAIL", name, "-", e.message);
  }
}
export function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}
export function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
export function done() {
  const bad = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
}

// delete every key a test run made under its own prefix
export async function cleanup(prefix) {
  const url = process.env.KV_REST_API_URL,
    headers = { authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "content-type": "application/json" };
  const call = async (cmd) => (await (await fetch(url, { method: "POST", headers, body: JSON.stringify(cmd) })).json()).result;
  let cur = "0",
    n = 0;
  do {
    const [next, ks] = await call(["SCAN", cur, "MATCH", `${prefix}:*`, "COUNT", "500"]);
    cur = next;
    if (ks.length) n += await call(["DEL", ...ks]);
  } while (cur !== "0");
  return n;
}
