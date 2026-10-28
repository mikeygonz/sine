// Marks an IP as having used all its free tries, using the same code the endpoint uses, so a deployment's
// out-of-tries screen can be checked without spending model calls.
//   node tools/gate-test/seed.mjs .env.gate <file holding GATE_SECRET> <ip>
import { readFileSync } from "node:fs";
import { loadEnv } from "./lib.mjs";

loadEnv(process.argv[2]);
process.env.GATE_SECRET = readFileSync(process.argv[3], "utf8").trim();
const { reserve, FREE_TRIES } = await import("../../api/_gate.js");
for (let i = 0; i < FREE_TRIES; i++) await reserve(process.argv[4]);
console.log("seeded", FREE_TRIES, "tries for", process.argv[4]);
