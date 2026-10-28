# Capture copy of app.js for the share video. The Fourier engine, circles, arms, pen dot, trail
# and wave are the site's own drawing code; these hooks only let a fixed clock choose how much of
# the trail and wave to show, how many circles to outline, and hide the grey target outline.
import sys
src = open(sys.argv[1]).read()
def sub(a, b):
    global src
    assert src.count(a) == 1, a
    src = src.replace(a, b)
O = "window.__og"
sub('ctx.strokeStyle = "#e2e2e2";', 'ctx.strokeStyle = %s.ghost === false ? "rgba(0,0,0,0)" : "#e2e2e2";' % O)
sub("tail = RM ? 1 : Math.min(0.985, age);", "tail = %s.tail ?? (RM ? 1 : Math.min(0.985, age));" % O)
sub("    for (let c = 0; c < CH; c++) {", "    for (let c = 0; c < (tail > 1e-4 ? CH : 0); c++) {")
sub("a = RM ? 1 : 0.12 + 0.88 * Math.pow(1 - c / CH, 1.4);",
    "a = 1 - (%s.fade ?? 1) * (1 - (RM ? 1 : 0.12 + 0.88 * Math.pow(1 - c / CH, 1.4)));" % O)
sub("DPR = Math.min(2, devicePixelRatio || 1);", "DPR = (%s && %s.dpr) || Math.min(2, devicePixelRatio || 1);" % (O, O))
sub("ctx.strokeStyle = `rgba(${INK},${0.38 * k})`;", "ctx.strokeStyle = `rgba(${INK},${(%s.armA ?? 0.38) * k})`;" % O)
sub("ARMS = 160", "ARMS = %s.arms || 160" % O)
sub("const len = RM ? 1 : age,", "const len = %s.len ?? (RM ? 1 : age)," % O)
sub("      for (let c = 0; c < segs; c++) {", "      for (let c = 0; c < (len > 1e-3 ? segs : 0); c++) {")
sub("    if (!window.__ogBlank) load(SHAPES.star(), { fresh: true });\n" if "__ogBlank" in src else "    load(SHAPES.star(), { fresh: true });\n",
    "    load(SHAPES.star(), { fresh: true });\n")
sub("    const span = w1 - w0;\n    if (span > 60) {", """    const span = w1 - w0;
    if (window.__og.hist && span > 60) {
      // share video: the same pen-height wave, laid out under the word as it is written
      const ue = window.__og.ue,
        a1 = Math.min(t, ue),
        a0 = Math.max(0, t - tail);
      if (!window.__og.still) {
        ctx.strokeStyle = "#ececec";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w0, wy);
        ctx.lineTo(w1, wy);
        ctx.stroke();
      }
      const yv = window.__og.sine || ((u) => at(u)[1]);
      if (a1 - a0 > 1e-4) {
        const segs = 24,
          m = Math.max(2, Math.ceil(((a1 - a0) / ue) * span / (window.__og.still ? 0.5 : 2) / segs));
        ctx.lineWidth = 1.5;
        for (let c = 0; c < segs; c++) {
          const a = RM ? 1 : 0.15 + 0.85 * (1 - c / segs);
          ctx.strokeStyle = `rgba(${INK},${a})`;
          ctx.beginPath();
          for (let k = 0; k <= m; k++) {
            const u = a1 - ((c + k / m) / segs) * (a1 - a0);
            const px = w0 + (u / ue) * span,
              py = wy + yv(u) * A;
            k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          }
          ctx.stroke();
        }
      }
      if (window.__og.still) return;
      dot(x, y);
      const xd = w0 + span * (t <= ue ? t / ue : (1 - t) / (1 - ue));
      dot(xd, wy + at(t)[1] * A);
      return;
    }
    if (span > 60) {""")
sub("      x += dx;\n      y += dy;\n    }\n", """      x += dx;
      y += dy;
      if (i === ARMS - 1) {
        window.__og.ax = x;
        window.__og.ay = y;
      }
    }
    if (window.__og.arms && window.__og.ax != null) {
      // the waves past the drawn arms still move the pen: one faint arm stands in for them
      ctx.strokeStyle = `rgba(${INK},${window.__og.armA ?? 0.38})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(window.__og.ax, window.__og.ay);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
""")
sub("  function start() {", '''  Object.assign(%s, {
    setup(raw, n, lay, rawDot) {
      const nz = normalize(resample(raw, M));
      N = n;
      load(nz.pts, { fresh: true });
      w.set(wt);
      recon();
      Object.assign(L, lay);
      this.dot = [(rawDot[0] - nz.cx) / nz.r, (rawDot[1] - nz.cy) / nz.r];
      return { fid, n: N };
    },
    // share image: the strongest single sine in the pen's height (largest Fourier term of y)
    fitSine() {
      const n = 2048, y = [];
      for (let j = 0; j < n; j++) y.push(at(j / n)[1]);
      let best = [0, 0, 0];
      for (let k = 1; k <= 64; k++) {
        let re = 0, im = 0;
        for (let j = 0; j < n; j++) {
          re += y[j] * Math.cos((TAU * k * j) / n);
          im -= y[j] * Math.sin((TAU * k * j) / n);
        }
        const m = Math.hypot(re, im);
        if (m > best[0]) best = [m, k, Math.atan2(im, re)];
      }
      const [, k, ph] = best;
      this.sine = (u) => Math.cos(TAU * k * u + ph);
      return { k, amp: (2 * best[0]) / n };
    },
    render(s) {
      Object.assign(this, s);
      t = s.t;
      born = clock - period;
      draw();
      if (s.dotA > 0) {
        ctx.fillStyle = `rgba(${INK},${s.dotA})`;
        ctx.beginPath();
        ctx.arc(L.cx + this.dot[0] * L.R, L.cy + this.dot[1] * L.R, 2.4, 0, TAU);
        ctx.fill();
      }
    },
  });
  function start() {''' % O)
open(sys.argv[2], 'w').write(src)
