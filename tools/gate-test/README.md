# Gate tests

Dev only. Nothing here ships. They need the Redis env vars: `vercel env pull .env.gate --environment=development` (git ignores `.env*`).

- `local.mjs` runs `api/draw.js` in-process against the real Upstash Redis, under a throwaway key prefix that it deletes after, with a fake AI Gateway. It proves the 3 tries per IP, parallel bursts, the burst limit, the daily cap, own keys, refunds and failing closed. `node tools/gate-test/local.mjs .env.gate`
- `preview.py` checks a deployment: scripts and headless browsers are blocked by BotID, the out-of-tries screen (390px and 1280px, with the prompt box staying put), and own-key handling against the real gateway. `python3 tools/gate-test/preview.py <preview url>`
- `seed.mjs` marks an IP as out of tries and `reset.mjs` deletes every gate count (`sine:*`). Only for a database with no real visitors.

Headless browsers are blocked by BotID on purpose, so one thing is checked by hand on a preview: open it in a normal browser, draw 3 times from the text box, and the 4th should open the key panel. Then open it in a private window or another browser on the same network: it should ask for a key straight away.
