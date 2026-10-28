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

Every prompt spends the deployer's AI Gateway credits, so a public deploy lets anyone spend yours. To turn it off, delete `api/`. `api/draw.js` has a rough per-instance limit; for a real one, add a [Vercel Firewall](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) rate limit on `POST /api/draw` and an AI Gateway budget on the project. The models are listed at the top of `api/draw.js`.

## Files

- `index.html`, `style.css`, `app.js`: the app
- `api/`: the optional text-to-shape endpoint
- `tools/`: dev-only scripts (share video, tracing a picture into a preset)
- `og.png`, `apple-touch-icon.png`: share image and icon
- `fonts/`: Geist and Geist Mono, under the SIL Open Font License (`fonts/OFL.txt`)

## License

MIT
