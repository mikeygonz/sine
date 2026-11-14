# Sine

Your stroke is run through a Fourier transform. Each frequency becomes a circle, added largest first, so the slider shows how many circles a shape needs. Try it at [sine.gonz.co](https://sine.gonz.co).

## Run it

It is a static page with no build step and no dependencies.

```sh
npx serve .
```

Or open it with any static server. Shapes you save stay in your browser's local storage.

## Draw from text (optional)

The "Draw anything" box asks a model to sketch a prompt as one line. It runs as a Vercel Function in `api/draw.js` through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) and only shows up when a token is available:

- Deployed on Vercel, it uses the project's OIDC token automatically.
- Anywhere else, set `AI_GATEWAY_API_KEY` and run `vercel dev`.

Every prompt spends the deployer's AI Gateway credits, so a public deploy lets anyone spend yours. To turn it off, delete `api/`. `api/draw.js` has a rough per-instance limit; for a real one, add a [Vercel Firewall](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) rate limit on `POST /api/draw` and an AI Gateway budget on the project. The models are listed at the top of `api/draw.js`.

## Hear from text (optional)

Type a prompt with the word "sound" in it, like "sound of a dog barking". `api/sound.js` looks for a short, freely licensed recording on Wikimedia Commons and a model picks the best match. The page rebuilds the loudest 2.5 seconds out of 48 harmonics of the tracked pitch plus a little noise, and the circles, shape and wave on screen are those same harmonics as they play. The recording is credited under the box. If nothing fits, a model writes a recipe for the sound instead. It uses the same AI Gateway setup and limits as the drawing box.

## Files

- `index.html`, `style.css`, `app.js`: the app
- `api/`: the optional text-to-shape endpoint
- `tools/`: dev-only scripts (share video, tracing a picture into a preset)
- `og.png`, `apple-touch-icon.png`: share image and icon
- `fonts/`: Geist and Geist Mono, under the SIL Open Font License (`fonts/OFL.txt`)

## License

MIT
