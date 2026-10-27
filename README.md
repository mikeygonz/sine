# Sine

Any shape is spinning circles. Draw one.

Draw a closed shape and Sine rebuilds it from up to 1000 rotating circles. Your stroke is resampled and run through a Fourier transform; each frequency becomes a circle, and the circles are added largest first, so the slider shows how many waves a shape needs. Turn on sound to hear the shape as a tone.

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

Every prompt spends the deployer's AI Gateway credits, so a public deploy lets anyone spend yours. To turn it off, delete `api/`. The models are listed at the top of `api/draw.js`.

## Share image

`og.png` is a real frame of the app with the tagline. Share tags in `index.html` use `https://sine.gonz.co`.

## Files

- `index.html`, `style.css`, `app.js`: the app
- `api/`: the optional text-to-shape endpoint
- `og.png`, `apple-touch-icon.png`: share image and icon
- `fonts/`: Geist and Geist Mono, under the SIL Open Font License (`fonts/OFL.txt`)

## License

MIT
