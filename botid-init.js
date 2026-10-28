// Bot protection for the free AI drawings: Vercel BotID signs requests to /api/draw so the server can tell a
// browser from a script. botid.js is the client library from the botid package (see npm run vendor:botid).
// It only works on Vercel, so it stays off for localhost.
import { initBotId } from "./botid.js";

if (!/^(localhost|127\.|\[::1\]|.*\.local$)/.test(location.hostname))
  initBotId({ protect: [{ path: "/api/draw", method: "POST", advancedOptions: { checkLevel: "basic" } }] });
