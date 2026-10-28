# Share image

`og.png` (1200x630, 8-bit grayscale) is one still from the share video's engine: Sine's circles have
just finished writing "sine", with a sine wave under it. Same patch as the video
(`../og-video/patch.py`); `still.py` renders the hold pose only, with capture-only hooks:

- 360x189 CSS px at a pixel ratio of 3.33, so the site's 1.75 px stroke lands at about 6 px.
- 5 circles outlined; the arm chain uses the circles' light grey. Reduced-motion ink (solid).
- No pen dots and no wave baseline. The i dot stays.
- The wave is the strongest single sine in the pen's height (the largest Fourier term of y,
  `fitSine`), sampled every 0.5 px.
- Word and wave are 828 px wide, centered. They fit the 1.91:1, X 2:1, iMessage (~1.56:1) and
  4:3 crops; a 1:1 crop trims the ends of the word.
- No text other than the word. The page title and description carry the copy.

```
python3 tools/og-image/still.py . /tmp/og.png \
  '{"W": 360, "R": 126, "cx": 180.6, "cy": 83.45, "w0": 57.6, "w1": 303.6, "wy": 163.45, "A": 10, "flat": true, "arms": 5, "armA": 0.09, "sine": true}'
python3 -c "from PIL import Image; Image.open('/tmp/og.png').convert('L').save('og.png', optimize=True)"
```

`index.html` points at `og.png?v=2` so cached link previews pick up the new image.
