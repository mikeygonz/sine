// Deletes every gate count (sine:*) from Redis, so the next test starts with 3 free tries for every IP.
// Only for a database with no real visitors in it.
//   node tools/gate-test/reset.mjs .env.gate
import { cleanup, loadEnv } from "./lib.mjs";

loadEnv(process.argv[2] || ".env.gate");
console.log("deleted", await cleanup("sine"), "keys");
