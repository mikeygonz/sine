# Sine

Draw a shape. Hear its Fourier series. Sine rebuilds your stroke from spinning circles, one sine wave each, added largest first, and plays it as sound. Try it at [sine.gonz.co](https://sine.gonz.co).

## Run it

It is a static page with no build step and no dependencies.

```sh
npx serve .
```

Or open it with any static server. Shapes you save stay in your browser's local storage.

## Draw from text (optional)

The text box ("Type something for AI to draw") asks a model to sketch a prompt as one line. It runs as a Vercel Function in `api/draw.js` through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) and only shows up when a token is available:

- Deployed on Vercel, it uses the project's OIDC token automatically.
- Anywhere else, set `AI_GATEWAY_API_KEY` and run `vercel dev`.

Every free drawing spends the deployer's AI Gateway credits, so the endpoint is gated:

- **3 free drawings per visitor.** They are counted on the server, by IP address, in [Upstash Redis](https://vercel.com/marketplace/upstash). Clearing storage, a private window or another browser does not reset them. The IP is hashed with `GATE_SECRET` before it is stored, and the count expires 30 days after the first one.
- **Their own key after that.** The box asks for a Vercel AI Gateway key (`vck_...`). The browser keeps it in `sessionStorage` (this tab only, gone when it closes) and sends it in the `x-gateway-key` header. The server uses it for that one call, sends it only to `ai-gateway.vercel.sh`, and never stores, logs or echoes it.
- **A daily cap on free drawings for everyone**, 300 by default (`FREE_DAILY_CAP`), so rotating IPs cannot run up the bill. A burst limit of 5 free requests a minute per IP (`FREE_BURST`).
- **Bot protection.** Free calls go through [Vercel BotID](https://vercel.com/docs/botid) (basic mode, free on every plan). It needs the `botid` package: the browser half is vendored as `botid.js`, the server half is imported by `api/draw.js`. It only runs on Vercel, so it is skipped for local runs.
- **It fails closed.** If Redis is unreachable, `GATE_SECRET` is missing or the IP is unknown, free calls are refused. Calls with their own key still work.

Setup on Vercel: add Upstash Redis from the Marketplace (the free plan is enough; it sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`) and set `GATE_SECRET` to a long random string. Without Redis the box still works for people with their own key. To turn the box off, delete `api/`. The models are listed at the top of `api/draw.js`. An AI Gateway budget on the project is still a good backstop, and a [Vercel Firewall](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) rate limit on `/api/draw` protects the Redis command quota.

Test it: `node tools/gate-test/local.mjs <env file>` runs the gate against real Redis with a fake gateway. `python3 tools/gate-test/preview.py <preview url>` checks a deployment. See `tools/gate-test/README.md`.

## Files

- `index.html`, `style.css`, `app.js`: the app
- `api/`: the optional text-to-shape endpoint and its free-tries gate (`_gate.js`)
- `botid.js`, `botid-init.js`: bot protection for that endpoint, on Vercel only
- `tools/`: dev-only scripts (share video, tracing a picture into a preset)
- `og.png`, `apple-touch-icon.png`: share image and icon
- `fonts/`: Geist and Geist Mono, under the SIL Open Font License (`fonts/OFL.txt`)

## License

MIT
