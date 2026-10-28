# Trace a picture into a preset

Dev only. Nothing here ships or runs on the site.

`trace.py` turns a picture into one closed pen path, simplified to points in a 0..1000 box. Paste the
points into `app.js` the way `GIRAFFE` is.

```
pip install pillow opencv-python-headless numpy scikit-image scipy networkx
python3 tools/trace-preset/trace.py giraffe.png outline --tol 1.5 --png preview.png --out giraffe.json
```

- `outline`: the outer edge of a dark shape on a light or clear ground.
- `lines`: the strongest edges of a picture, joined by their shortest bridges into one stroke. The pen
  walks each branch out and back, so it reaches every line without lifting. `--focus` gives an oval
  finer edges, `--limit` drops everything outside an oval.

The giraffe is "Giraffe Silhouette 3" from OpenClipart (public domain),
`https://freesvg.org/img/Giraffe-Silhouette-3.png`, traced with the command above.
