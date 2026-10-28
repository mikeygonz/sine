# Share video

`og.mp4` (1200x630, 4.6 s, 60 fps, H.264, no audio) and `og-poster.png` (frame 162, mid-hold).

Sine's own epicycles write "sine" stroke by stroke, with its pen-height wave underneath.

- `path.py`: the approved letterforms, one pen path. The word plus the straight chord back to its
  start is one closed curve, and the site's FFT turns it into 255 waves (99.9% match).
- `patch.py`: a capture copy of `app.js`. The engine, circles, arms, pen dot, trail and wave
  styles are the site's drawing code. Hooks let a fixed clock pick how much trail and wave to
  show, outline only the 10 largest circles (with one faint arm standing in for the rest), hide
  the grey target outline, and lay the wave out under the word as it is written.
- `capture.py`: drives it in headless Chrome (600x315 CSS px at DPR 2) and screenshots each frame.
  Time only runs forward: rest 0.15 s, write 2.1 s (the pen slows into turns; the i dot lands as
  the pen passes the i), hold 0.9 s, the tail erases forward to the pen with the site's trail fade
  0.7 s, the pen glides home along the chord 0.6 s, rest 0.15 s. Last frame equals first.

```
pip install playwright
python3 tools/og-video/capture.py . /tmp/frames
ffmpeg -framerate 60 -i /tmp/frames/f%04d.png -vf format=yuv420p -c:v libx264 -preset veryslow \
  -crf 20 -tune animation -profile:v high -movflags +faststart -an og.mp4
cp /tmp/frames/f0162.png og-poster.png
```
