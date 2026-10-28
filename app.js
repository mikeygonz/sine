(() => {
  const M = 2048,
    S = M,
    TAU = Math.PI * 2;
  const BASE = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128, 255, 512, 1000];
  const DRAW_PCT = 95; // a hand drawing starts at the fewest waves that match it this closely
  const DRAW_N = 255; // prompt drawings form at this many waves; at 5 they read as a blob
  const cv = document.getElementById("c"),
    ctx = cv.getContext("2d");
  const slider = document.getElementById("n"),
    out = document.getElementById("out"),
    snd = document.getElementById("snd"),
    tuneBtn = document.getElementById("tune"),
    tuner = document.getElementById("tuner");
  const segBtns = [...document.querySelectorAll(".seg [data-s]")];
  const bar = document.querySelector(".bar"),
    header = document.querySelector("header");
  const ask = document.getElementById("ask"),
    q = document.getElementById("q"),
    go = document.getElementById("go"),
    statusEl = document.getElementById("status"),
    keyBox = document.getElementById("key"),
    keyT = document.getElementById("key-t"),
    keyIn = document.getElementById("gk");
  const rmq = matchMedia("(prefers-reduced-motion: reduce)");
  let RM = rmq.matches;
  rmq.addEventListener &&
    rmq.addEventListener("change", (e) => {
      RM = e.matches;
      dirty = true;
    });
  const freq = (j) => (j < M / 2 ? j : j - M);

  // ---------- fft (radix-2, in place) ----------
  const rev = new Uint32Array(M);
  {
    const b = Math.log2(M);
    for (let i = 0; i < M; i++) {
      let r = 0;
      for (let k = 0; k < b; k++) r |= ((i >> k) & 1) << (b - 1 - k);
      rev[i] = r;
    }
  }
  const cosT = new Float64Array(M / 2),
    sinT = new Float64Array(M / 2);
  for (let i = 0; i < M / 2; i++) {
    cosT[i] = Math.cos((TAU * i) / M);
    sinT[i] = Math.sin((TAU * i) / M);
  }
  function fft(re, im, inv) {
    for (let i = 0; i < M; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sg = inv ? 1 : -1;
    for (let size = 2; size <= M; size <<= 1) {
      const h = size >> 1,
        step = M / size;
      for (let i = 0; i < M; i += size)
        for (let k = 0; k < h; k++) {
          const c = cosT[k * step],
            s = sg * sinT[k * step],
            a = i + k,
            b = a + h;
          const tr = re[b] * c - im[b] * s,
            ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
    }
  }

  // ---------- shapes ----------
  function resample(pts, n) {
    const P = pts.concat([pts[0]]),
      L = [0];
    for (let i = 1; i < P.length; i++)
      L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const tot = L[L.length - 1] || 1,
      o = [];
    let k = 1;
    for (let i = 0; i < n; i++) {
      const d = (i / n) * tot;
      while (k < L.length - 1 && L[k] < d) k++;
      const seg = L[k] - L[k - 1] || 1,
        u = (d - L[k - 1]) / seg;
      o.push([P[k - 1][0] + (P[k][0] - P[k - 1][0]) * u, P[k - 1][1] + (P[k][1] - P[k - 1][1]) * u]);
    }
    return o;
  }
  function normalize(pts) {
    let mx = 0,
      my = 0;
    for (const p of pts) {
      mx += p[0];
      my += p[1];
    }
    mx /= pts.length;
    my /= pts.length;
    let r = 0;
    for (const p of pts) r = Math.max(r, Math.hypot(p[0] - mx, p[1] - my));
    r = r || 1;
    return { pts: pts.map((p) => [(p[0] - mx) / r, (p[1] - my) / r]), cx: mx, cy: my, r };
  }
  const poly = (v) => normalize(resample(v, M)).pts;
  // Giraffe: one closed pen path in a 0..1000 box, traced from a public domain silhouette by
  // tools/trace-preset.
  const GIRAFFE = [373,0,359,14,347,20,338,20,327,12,318,12,304,25,288,34,263,41,246,41,230,46,224,51,224,57,228,62,228,69,226,71,231,80,238,83,270,85,288,94,301,96,302,98,331,99,347,110,354,126,355,151,357,152,357,181,359,183,359,268,357,270,359,324,377,385,402,427,403,433,416,457,416,461,410,468,407,479,396,498,395,523,400,541,409,557,421,592,421,598,423,599,426,624,441,667,442,695,444,697,444,780,448,787,449,798,448,860,446,862,444,904,442,906,437,940,414,972,414,977,434,980,460,980,460,984,453,993,457,1000,460,998,465,1000,494,998,503,995,504,984,497,975,496,959,503,949,504,943,503,929,501,927,501,910,499,908,499,887,497,885,496,849,497,805,503,780,501,725,499,723,497,613,503,608,526,608,527,610,542,610,543,612,581,612,582,610,591,610,611,605,632,594,639,594,652,612,662,651,668,663,669,674,675,686,684,718,685,761,687,762,687,780,689,782,684,832,682,833,682,844,676,862,675,881,673,883,668,915,659,945,652,959,636,979,669,980,671,982,678,982,684,979,684,973,678,966,678,957,682,950,691,943,692,915,694,913,694,895,696,894,696,881,698,879,699,855,703,846,710,812,714,805,715,794,721,782,728,785,728,807,730,809,731,929,728,941,721,952,708,965,708,968,710,970,747,970,751,968,749,941,758,929,758,906,756,904,753,871,753,810,762,809,772,812,763,807,760,798,765,785,763,777,767,770,767,761,769,759,769,755,765,750,767,734,776,727,774,723,776,716,774,693,762,661,763,571,765,569,765,511,763,509,762,496,756,488,753,479,708,434,691,427,676,426,675,424,652,424,650,422,634,422,632,420,604,417,593,411,586,410,558,394,538,376,517,349,506,344,503,340,497,339,460,300,449,280,448,271,444,264,435,230,434,215,430,204,430,195,426,184,425,168,423,167,423,160,419,149,418,135,410,115,409,106,403,94,402,85,393,67,395,60,400,55,400,51,387,46,380,46,370,35,368,28,373,18,386,11,386,5,380,0,375,0];
  const SHAPES = {
    star: () => {
      const v = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5,
          r = i % 2 ? 0.43 : 1;
        v.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return poly(v);
    },
    heart: () => {
      const v = [];
      for (let i = 0; i < 400; i++) {
        const t = (i / 400) * TAU;
        v.push([
          16 * Math.sin(t) ** 3,
          -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
        ]);
      }
      return poly(v);
    },
    giraffe: () => poly(Array.from({ length: GIRAFFE.length / 2 }, (_, i) => [GIRAFFE[2 * i], GIRAFFE[2 * i + 1]])),
    square: () =>
      poly([
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]),
  };

  // ---------- fourier state ----------
  function dft(pts) {
    const re = new Float64Array(M),
      im = new Float64Array(M);
    for (let n = 0; n < M; n++) {
      re[n] = pts[n][0];
      im[n] = pts[n][1];
    }
    fft(re, im, false);
    for (let j = 0; j < M; j++) {
      re[j] /= M;
      im[j] /= M;
    }
    re[0] = 0;
    im[0] = 0;
    return { re, im };
  }
  let target = null,
    from = null,
    to = null,
    morph = 1,
    order = [],
    steps = BASE,
    N = BASE[+slider.value];
  const cre = new Float64Array(M),
    cim = new Float64Array(M),
    w = new Float64Array(M),
    wt = new Float64Array(M);
  const Pr = new Float64Array(M),
    Pi = new Float64Array(M);
  let gx = { a: null, t: 1 },
    dirty = true,
    energy = 1,
    fid = 0,
    period = 7000;
  let t = 0,
    born = 0,
    clock = 0,
    shapeName = "star";

  function setOrder() {
    order = [...Array(M).keys()]
      .filter((j) => j !== 0)
      .sort((a, b) => to.re[b] ** 2 + to.im[b] ** 2 - (to.re[a] ** 2 + to.im[a] ** 2));
    energy = 0;
    for (const j of order) energy += to.re[j] ** 2 + to.im[j] ** 2;
  }
  // the match for the biggest n waves, and the whole percent the readout shows for it
  const fidOf = (kept) => 1 - Math.sqrt(Math.max(0, energy - kept) / (energy || 1));
  const pctOf = (f) => (f >= 0.9995 ? 100 : Math.min(99, Math.round(f * 100)));
  // the smallest slider step whose readout reaches `goal` percent, or the last step if none does
  function stepFor(goal) {
    let kept = 0,
      at = 0;
    for (let i = 0; i < steps.length; i++) {
      for (; at < Math.min(steps[i], order.length); at++) kept += to.re[order[at]] ** 2 + to.im[order[at]] ** 2;
      if (pctOf(fidOf(kept)) >= goal) return i;
    }
    return steps.length - 1;
  }
  function setN() {
    wt.fill(0);
    const n = Math.min(N, order.length);
    for (let i = 0; i < n; i++) wt[order[i]] = 1;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const j = order[i];
      kept += to.re[j] ** 2 + to.im[j] ** 2;
    }
    fid = fidOf(kept);
    const pct = pctOf(fid);
    out.innerHTML = `<b>${N}</b> ${N === 1 ? "wave" : "waves"} · ${pct}%`;
    slider.setAttribute("aria-valuetext", `${N} ${N === 1 ? "wave" : "waves"}, ${pct}% match`);
    slider.style.setProperty("--p", (+slider.value / +slider.max) * 100 + "%");
    if (RM) w.set(wt);
    dirty = true;
    audioUpdate();
  }
  function load(pts, opts = {}) {
    const next = dft(pts);
    if (to && opts.morph && !RM) {
      from = { re: Float64Array.from(cre), im: Float64Array.from(cim) };
      morph = 0;
      morphDur = opts.dur || 700;
    } else {
      from = null;
      morph = 1;
      cre.set(next.re);
      cim.set(next.im);
    }
    to = next;
    target = pts;
    gx = opts.raw && !RM ? { a: opts.raw, t: 0 } : { a: null, t: 1 };
    setOrder();
    if (opts.fresh) {
      w.fill(0);
      born = clock;
      t = 0;
    }
    setN();
  }
  let morphDur = 700;
  function pick(name) {
    shapeName = name;
    cueOff();
    segBtns.forEach((o) => o.setAttribute("aria-pressed", String(o.dataset.s === name)));
    custom = null;
    showing = null;
    renderSaved();
    born = Math.min(born, clock - period);
  }

  // ---------- layout ----------
  let W = 0,
    H = 0,
    DPR = 1,
    L = {};
  // What the layout was measured against. iOS Safari can move the bar (its toolbar and the safe
  // area settle after load, or the page comes back from the back-forward cache) without a resize
  // event, so each frame compares these and lays out again when one has moved.
  let measured = "";
  function geom() {
    return [cv.clientWidth, cv.clientHeight, header.getBoundingClientRect().bottom, bar.getBoundingClientRect().bottom].join();
  }
  // Stack or side by side follows the screen's orientation, not the visible area: an open
  // keyboard leaves a short, wide view on a portrait phone, and that must not flip the layout.
  function portrait() {
    const o = screen.orientation && screen.orientation.type;
    if (o) return o.startsWith("portrait");
    if (typeof window.orientation === "number") return window.orientation % 180 === 0;
    return matchMedia("(orientation: portrait)").matches;
  }
  // While the keyboard is up for a text field, hold the layout; it settles once the field blurs.
  const coarse = matchMedia("(pointer: coarse)");
  function typing() {
    const a = document.activeElement;
    return coarse.matches && !!a && a.tagName === "INPUT" && a.type === "text";
  }
  function layout() {
    measured = geom();
    DPR = Math.min(2, devicePixelRatio || 1);
    // the canvas's own box, so the bitmap always matches what is on screen
    W = cv.clientWidth || innerWidth;
    H = cv.clientHeight || innerHeight;
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    const hb = header.getBoundingClientRect(),
      bb = bar.getBoundingClientRect();
    const pad = 24,
      top = hb.bottom + 16,
      bottom = bb.top - 16,
      left = pad,
      right = W - pad,
      sw = right - left,
      sh = bottom - top;
    // The wave always runs left to right and plays the tip's height. Wide screens put it beside
    // the circles at the tip's own scale; narrow ones stack it under them, at a scale that fits.
    // A portrait screen, or a portrait window, always stacks.
    if (!portrait() && W > H && sw > sh * 1.15) {
      const bw = Math.min(sw * 0.42, sh * 1.1);
      const R = Math.min(bw, sh) * 0.42;
      const cy = top + sh / 2;
      L = { R, cx: left + bw / 2, cy, w0: left + bw / 2 + R * 1.18 + 40, w1: right, wy: cy, A: R, side: true };
    } else {
      const bh = sh * 0.6;
      const R = Math.min(sw, bh) * 0.42;
      const cy = top + bh / 2,
        b0 = cy + R * 1.12 + 20;
      L = { R, cx: W / 2, cy, w0: left, w1: right, wy: (b0 + bottom) / 2, A: Math.min(R, (bottom - b0) / 2) };
    }
    dirty = true;
  }

  // ---------- reconstruction: inverse fft of weighted coefficients ----------
  function recon() {
    for (let j = 0; j < M; j++) {
      Pr[j] = w[j] * cre[j];
      Pi[j] = w[j] * cim[j];
    }
    fft(Pr, Pi, true);
  }
  function at(u) {
    u = ((u % 1) + 1) % 1;
    const f = u * S,
      i = Math.floor(f) % S,
      k = (i + 1) % S,
      a = f - Math.floor(f);
    return [Pr[i] + (Pr[k] - Pr[i]) * a, Pi[i] + (Pi[k] - Pi[i]) * a];
  }

  // ---------- draw ----------
  const INK = "26,26,26",
    ARMS = 160;
  let stroke = null,
    cursor = null;
  // "Draw here": on first load, a faint pen loops beside the words under the shape, until the
  // first stroke, preset, saved shape or prompt. Reduced motion shows the words alone.
  let cueOn = true,
    cueA = 0;
  const cueOff = () => (cueOn = false);
  function cue() {
    const { R, cy } = L,
      cx = W / 2; // centered on the canvas, also beside the wave on wide screens
    // just under the shape; on a wide screen the wave runs right of the circles, so go below it too
    const y = Math.min(L.side ? cy + R + 26 : cy + R * 0.82 + 34, bar.getBoundingClientRect().top - 24);
    ctx.font = "13px Geist, ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText("Draw here").width,
      lw = RM ? 0 : 30,
      x0 = cx - (lw + tw) / 2;
    ctx.fillStyle = `rgba(115,115,115,${cueA})`;
    ctx.fillText("Draw here", x0 + lw, y);
    if (RM) return;
    // a figure eight, with a tail that fades behind the pen
    const th = (clock / 2400) * TAU,
      px = (a) => x0 + 10 + 10 * Math.sin(a),
      py = (a) => y + 5 * Math.sin(2 * a),
      K = 28;
    ctx.lineWidth = 1.5;
    for (let k = 0; k < K; k++) {
      const a = th - (k / K) * 3.6,
        b = th - ((k + 1) / K) * 3.6;
      ctx.strokeStyle = `rgba(115,115,115,${cueA * 0.55 * (1 - k / K)})`;
      ctx.beginPath();
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(115,115,115,${cueA})`;
    ctx.beginPath();
    ctx.arc(px(th), py(th), 2.5, 0, TAU);
    ctx.fill();
  }
  function frame(dt) {
    clock += dt;
    cueA = cueOn && clock > 400 ? Math.min(1, cueA + dt / 500) : cueOn ? 0 : Math.max(0, cueA - dt / 200);
    if (!RM) t = (t + dt / period) % 1;
    let moving = false;
    if (morph < 1) {
      morph = Math.min(1, morph + dt / morphDur);
      const e = morph < 0.5 ? 4 * morph ** 3 : 1 - (-2 * morph + 2) ** 3 / 2;
      for (let j = 0; j < M; j++) {
        cre[j] = from.re[j] + (to.re[j] - from.re[j]) * e;
        cim[j] = from.im[j] + (to.im[j] - from.im[j]) * e;
      }
      moving = true;
    }
    const kf = RM ? 1 : 1 - Math.exp(-dt / 110);
    for (let j = 0; j < M; j++) {
      const d = wt[j] - w[j];
      if (d > 1e-4 || d < -1e-4) {
        w[j] += d * kf;
        moving = true;
      } else w[j] = wt[j];
    }
    if (gx.t < 1) gx.t = Math.min(1, gx.t + dt / 520);
    if (moving || dirty) {
      recon();
      dirty = false;
    }
    draw();
  }
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const { R, cx, cy, w0, w1, wy, A, side } = L;
    if (cueA > 0) cue();
    if (stroke) {
      ctx.strokeStyle = `rgb(${INK})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      stroke.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      if (cursor) {
        dot(cursor[0], cursor[1]);
        audioPen((cursor[0] - cx) / R, (cy - cursor[1]) / R);
      }
      return;
    }
    let gc = cx,
      gy = cy,
      gr = R;
    if (gx.a) {
      const e = 1 - (1 - gx.t) ** 3;
      gc = gx.a.cx + (cx - gx.a.cx) * e;
      gy = gx.a.cy + (cy - gx.a.cy) * e;
      gr = gx.a.r + (R - gx.a.r) * e;
    }
    ctx.strokeStyle = "#e2e2e2";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    target.forEach((p, i) =>
      i ? ctx.lineTo(gc + p[0] * gr, gy + p[1] * gr) : ctx.moveTo(gc + p[0] * gr, gy + p[1] * gr),
    );
    ctx.closePath();
    ctx.stroke();
    const age = RM ? 1 : Math.min(1, (clock - born) / period),
      tail = RM ? 1 : Math.min(0.985, age);
    const CH = 36,
      per = Math.max(8, Math.ceil((S * tail) / CH));
    ctx.lineWidth = 1.75;
    for (let c = 0; c < CH; c++) {
      const u0 = t - (tail * (c + 1)) / CH,
        u1 = t - (tail * c) / CH,
        a = RM ? 1 : 0.12 + 0.88 * Math.pow(1 - c / CH, 1.4);
      ctx.strokeStyle = `rgba(${INK},${a})`;
      ctx.beginPath();
      for (let k = 0; k <= per; k++) {
        const p = at(u0 + ((u1 - u0) * k) / per);
        const x = cx + p[0] * R,
          y = cy + p[1] * R;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // epicycles: draw the largest ARMS, the rest only move the tip
    let x = cx,
      y = cy;
    const th = TAU * t;
    for (let i = 0; i < order.length; i++) {
      const j = order[i],
        k = w[j];
      if (k < 0.002) {
        if (i > N + 24) break;
        continue;
      }
      const f = freq(j),
        c = Math.cos(f * th),
        s = Math.sin(f * th);
      const dx = k * (cre[j] * c - cim[j] * s) * R,
        dy = k * (cre[j] * s + cim[j] * c) * R;
      if (i < ARMS) {
        const r = Math.hypot(dx, dy);
        if (r > 1.5) {
          ctx.strokeStyle = `rgba(${INK},${0.09 * k})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.stroke();
        }
        ctx.strokeStyle = `rgba(${INK},${0.38 * k})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();
      }
      x += dx;
      y += dy;
    }
    // wave: flows toward the circles (future values feed in at the tip)
    const span = w1 - w0;
    if (span > 60) {
      const len = RM ? 1 : age,
        n = Math.max(2, Math.floor(span / 2));
      ctx.strokeStyle = "#ececec";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w0, wy);
      ctx.lineTo(w1, wy);
      ctx.stroke();
      if (side) {
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = `rgba(${INK},.28)`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(w0, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const segs = 24,
        m = Math.ceil(n / segs);
      ctx.lineWidth = 1.5;
      for (let c = 0; c < segs; c++) {
        const a = RM ? 1 : 0.15 + 0.85 * (1 - c / segs);
        ctx.strokeStyle = `rgba(${INK},${a})`;
        ctx.beginPath();
        for (let k = 0; k <= m; k++) {
          const v = ((c + k / m) / segs) * len;
          const p = at(t + v);
          k ? ctx.lineTo(w0 + v * span, wy + p[1] * A) : ctx.moveTo(w0 + v * span, wy + p[1] * A);
        }
        ctx.stroke();
      }
    }
    audioPen((x - cx) / R, (cy - y) / R);
    dot(x, y);
    // stacked: a twin dot on the wave's newest point ties it to the tip
    if (!side && span > 60) dot(w0, wy + at(t)[1] * A);
  }
  function dot(x, y) {
    ctx.fillStyle = `rgb(${INK})`;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#fafafa";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, TAU);
    ctx.fill();
  }

  // ---------- pointer drawing ----------
  let pid = null,
    hintAfterDraw = () => {}; // set by the sound hint below

  cv.addEventListener("pointerdown", (e) => {
    if (pid !== null) return;
    cueOff();
    pid = e.pointerId;
    cv.setPointerCapture(pid);
    stroke = [[e.clientX, e.clientY]];
    cursor = [e.clientX, e.clientY];
    e.preventDefault();
    if (document.activeElement === q) q.blur();
  });
  cv.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pid) return;
    const ev = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const p of ev.length ? ev : [e]) {
      const l = stroke[stroke.length - 1];
      if (Math.hypot(p.clientX - l[0], p.clientY - l[1]) > 1.5) stroke.push([p.clientX, p.clientY]);
    }
    cursor = [e.clientX, e.clientY];
  });
  function end(e) {
    if (e.pointerId !== pid) return;
    pid = null;
    const s = stroke;
    stroke = null;
    cursor = null;
    let len = 0;
    for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
    if (s.length < 6 || len < 60) return;
    const nz = normalize(resample(s, M));
    pick("yours");
    load(nz.pts, { fresh: true, raw: { cx: nz.cx, cy: nz.cy, r: nz.r } });
    // start at the fewest waves that already trace it, so the circles read as the shape just drawn
    const i = stepFor(DRAW_PCT);
    slider.value = String(i);
    N = steps[i];
    setN();
    drew(s, "Drawing");
    hintAfterDraw();
  }
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  segBtns.forEach((b) =>
    b.addEventListener("click", () => {
      const n = b.dataset.s;
      pick(n);
      load(SHAPES[n](), { morph: true });
    }),
  );
  slider.addEventListener("input", () => {
    N = steps[+slider.value];
    setN();
  });

  // ---------- prompt: stream points from /api/draw and morph as they arrive ----------
  // Free tries are counted on the server by IP. After the free ones, the visitor pastes their own AI Gateway
  // key. It is kept in sessionStorage: it survives a reload of this tab but is gone when the tab closes, is
  // never shared across tabs, and is never written to localStorage. It is sent only to /api/draw, as a header.
  const KEY_RE = /^vck_[A-Za-z0-9_-]{20,200}$/,
    KEY_SLOT = "sine-gateway-key";
  let free = null, // tries left on the server, or null if unknown
    own = "";
  try {
    own = sessionStorage.getItem(KEY_SLOT) || "";
    if (!KEY_RE.test(own)) own = "";
  } catch (_) {}
  function setOwn(v) {
    own = v;
    try {
      v ? sessionStorage.setItem(KEY_SLOT, v) : sessionStorage.removeItem(KEY_SLOT);
    } catch (_) {}
  }
  const freeLabel = () => (own ? "your key" : free > 0 ? free + " free" : "");
  function keyOpen(text) {
    keyT.textContent = text;
    keyBox.hidden = false;
    hideHint(); // the sound note floats in the same spot
  }
  const keyShut = () => (keyBox.hidden = true);
  document.getElementById("key-x").addEventListener("click", () => {
    keyShut();
    q.focus();
  });
  cv.addEventListener("pointerdown", keyShut);
  addEventListener("keydown", (e) => e.key === "Escape" && !keyBox.hidden && keyShut());
  function keyTake() {
    const v = keyIn.value.trim();
    if (!KEY_RE.test(v)) return false;
    setOwn(v);
    keyIn.value = "";
    keyShut();
    status(freeLabel());
    if (q.value.trim() && !live) ask.requestSubmit();
    else q.focus();
    return true;
  }
  keyIn.addEventListener("paste", () => setTimeout(keyTake)); // a typed key is taken on Enter, not mid-word
  keyIn.addEventListener("change", keyTake);
  keyIn.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!keyTake()) keyT.textContent = "That key didn't work. Paste it again.";
  });
  const OUT = "You used your 3 free AI drawings. Paste your Vercel AI Gateway key to keep using AI.";
  let job = 0,
    live = null;
  function status(text, busy) {
    statusEl.textContent = text || "";
    ask.classList.toggle("busy", !!busy);
  }
  q.addEventListener("input", () => {
    go.disabled = !q.value.trim() || !!live;
  });
  const PT = /^\s*(\d{1,4})\s*,\s*(\d{1,4})\s*$/;
  function promptStart(text) {
    cueOff();
    custom = null;
    renderSaved();
    live = { id: ++job, buf: "", pts: [], last: 0, text, fresh: true };
    go.disabled = true;
    status("drawing", true);
  }
  function promptFeed(chunk) {
    if (!live) return;
    live.buf += chunk;
    let i;
    while ((i = live.buf.indexOf("\n")) >= 0) {
      const line = live.buf.slice(0, i);
      live.buf = live.buf.slice(i + 1);
      const m = PT.exec(line);
      if (!m || live.pts.length >= 600) continue;
      const p = [Math.min(1000, +m[1]), Math.min(1000, +m[2])],
        l = live.pts[live.pts.length - 1];
      if (!l || l[0] !== p[0] || l[1] !== p[1]) live.pts.push(p);
    }
    const now = clock;
    if (live.pts.length >= 12 && live.pts.length - live.last >= 12 && now - (live.at || -1e9) >= 220) {
      live.at = now;
      live.last = live.pts.length;
      apply(false);
    }
  }
  function apply(final) {
    const nz = normalize(resample(live.pts, M));
    if (shapeName !== "yours") {
      pick("yours");
    }
    if (live.fresh) {
      live.fresh = false;
      if (N < DRAW_N) {
        N = DRAW_N;
        slider.value = String(steps.indexOf(N));
      }
    }
    load(nz.pts, { morph: true, dur: final ? 900 : 420 });
    if (final) drew(live.pts, live.text);
  }
  function promptEnd(err) {
    if (!live) return;
    const ok = !err && live.pts.length >= 12;
    if (live.buf) promptFeed("\n");
    if (ok) {
      apply(true);
      status(freeLabel());
      if (!own && free === 0) keyOpen(OUT);
    } else if (err === "gate") status(freeLabel());
    else status(err === "limit" ? "too many, try later" : err === "bot" ? "blocked" : "couldn’t draw that");
    if (!ok && err !== "gate")
      setTimeout(() => {
        if (!live) status(freeLabel());
      }, err === "limit" ? 5000 : 3200);
    live = null;
    go.disabled = !q.value.trim();
  }
  ask.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = q.value.trim().slice(0, 60);
    if (!text || live) return;
    // out of free tries and no key: bring the panel back, even if it was closed with the x
    if (!own && free === 0) return keyOpen(OUT);
    q.blur();
    promptStart(text);
    const id = job;
    try {
      const r = await fetch("/api/draw", {
        method: "POST",
        headers: { "content-type": "application/json", ...(own && { "x-gateway-key": own }) },
        body: JSON.stringify({ prompt: text }),
      });
      if (!r.ok || !r.body) {
        const code = ((await r.json().catch(() => null)) || {}).code;
        if (id !== job) return;
        if (code === "tries") free = 0;
        if (own && code === "key") {
          setOwn("");
          keyOpen("That key didn't work. Paste it again.");
          promptEnd("gate");
        } else if (code === "tries") {
          keyOpen(OUT);
          promptEnd("gate");
        } else if (code === "cap" || code === "paused") {
          keyOpen(
            (code === "cap" ? "Free AI drawings are full for today." : "Free AI drawings are paused.") +
              " Paste your Vercel AI Gateway key to keep using AI.",
          );
          promptEnd("gate");
        } else promptEnd(code === "burst" || r.status === 429 ? "limit" : code === "bot" ? "bot" : "fail");
        return;
      }
      const left = r.headers.get("x-free-left");
      if (left !== null && !own) free = +left;
      const rd = r.body.getReader(),
        dec = new TextDecoder();
      while (true) {
        const { value, done } = await rd.read();
        if (done || id !== job) break;
        promptFeed(dec.decode(value, { stream: true }));
      }
      if (id === job) promptEnd();
    } catch (_) {
      if (id === job) promptEnd("fail");
    }
  });

  // ---------- saved shapes ----------
  // Shapes you draw or type can be saved on this device (localStorage). Each one keeps its source
  // points, normalized and rounded, and the wave count it was saved at. They sit in the shape row
  // after the presets; the row scrolls sideways and fades under a blur where it runs off.
  const KEY = "sine-shapes",
    MAX_PTS = 1200;
  const seg = document.getElementById("seg"),
    strip = document.getElementById("strip"),
    keep = document.getElementById("keep"),
    listEl = document.getElementById("list");
  let shapes = [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (Array.isArray(v)) shapes = v.filter((x) => x && Array.isArray(x.pts) && x.pts.length >= 3);
  } catch (_) {}
  let custom = null, // the drawn or typed shape on screen, until it is saved: {pts, name}
    showing = null; // id of the saved shape on screen
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(shapes));
      return true;
    } catch (_) {
      return false;
    }
  }
  // a default name no saved shape has yet: "Drawing 3", or "a cat 2" for a repeated prompt
  function fresh(base) {
    const taken = new Set(shapes.map((x) => x.name));
    let n = base === "Drawing" ? shapes.length + 1 : 1;
    const at = (k) => (base === "Drawing" || k > 1 ? `${base} ${k}` : base);
    while (taken.has(at(n))) n++;
    return at(n);
  }
  function drew(pts, name) {
    custom = { pts: pts.slice(), name: fresh(name) };
    renderSaved();
  }
  function thumb(pts) {
    const step = Math.max(1, Math.floor(pts.length / 96));
    let d = "";
    for (let i = 0; i < pts.length; i += step) d += (i ? "L" : "M") + pts[i][0] + " " + pts[i][1];
    return `<svg viewBox="-1.05 -1.05 2.1 2.1" aria-hidden="true"><path d="${d}Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const X =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const esc = (t) =>
    t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function renderSaved() {
    keep.hidden = !custom;
    listEl.innerHTML = shapes
      .map((x) => {
        const on = x.id === showing;
        return (
          `<span class="chip"><button type="button" class="item" data-id="${x.id}" aria-current="${on}" aria-label="${esc(x.name)}" title="${esc(x.name)}">${thumb(x.pts)}</button>` +
          (on
            ? `<button type="button" class="del" data-id="${x.id}" aria-label="Delete ${esc(x.name)}">${X}<span class="confirm" aria-hidden="true">Delete?</span></button>`
            : "") +
          "</span>"
        );
      })
      .join("");
    fades();
  }
  // the blur and fade show only on the side that has more to scroll to
  function fades() {
    const max = seg.scrollWidth - seg.clientWidth;
    strip.classList.toggle("l", seg.scrollLeft > 1);
    strip.classList.toggle("r", seg.scrollLeft < max - 1);
  }
  const reveal = (el) =>
    el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: RM ? "auto" : "smooth" });
  seg.addEventListener("scroll", fades, { passive: true });
  new ResizeObserver(fades).observe(seg);
  keep.addEventListener("click", () => {
    if (!custom) return;
    const nz = normalize(custom.pts.length > MAX_PTS ? resample(custom.pts, MAX_PTS) : custom.pts).pts;
    const r = (v) => Math.round(v * 1000) / 1000;
    const x = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: custom.name,
      pts: nz.map((p) => [r(p[0]), r(p[1])]),
      n: N,
    };
    shapes.unshift(x);
    if (!persist()) {
      shapes.shift();
      status("no room left, delete one first");
      setTimeout(() => {
        if (!live) status("");
      }, 3200);
      return;
    }
    custom = null;
    showing = x.id;
    renderSaved();
    const chip = listEl.querySelector(".item");
    chip.focus({ preventScroll: true });
    reveal(chip.parentElement);
  });
  listEl.addEventListener("click", (e) => {
    const del = e.target.closest(".del"),
      item = e.target.closest(".item");
    if (del) {
      // two taps: the first arms it, the second deletes
      if (!del.classList.contains("armed")) {
        del.classList.add("armed");
        del.dataset.label = del.getAttribute("aria-label");
        del.setAttribute("aria-label", "Confirm delete");
        clearTimeout(del.t);
        del.t = setTimeout(() => disarm(del), 2500);
        return;
      }
      const i = shapes.findIndex((x) => x.id === del.dataset.id);
      shapes.splice(i, 1);
      persist();
      showing = null;
      renderSaved();
      // focus moves to the chip that took its place, else the one before, else the first preset
      const chips = listEl.querySelectorAll(".item");
      (chips[Math.min(i, chips.length - 1)] || seg.querySelector("[data-s]")).focus();
    } else if (item) {
      const x = shapes.find((x) => x.id === item.dataset.id);
      if (!x) return;
      pick(null);
      showing = x.id;
      const i = steps.indexOf(x.n);
      if (i >= 0) {
        N = x.n;
        slider.value = String(i);
      }
      load(poly(x.pts), { morph: true });
      renderSaved();
      const chip = listEl.querySelector('.item[aria-current="true"]');
      chip.focus({ preventScroll: true });
      reveal(chip.parentElement);
    }
  });
  function disarm(d) {
    if (!d.classList.contains("armed")) return;
    clearTimeout(d.t);
    d.classList.remove("armed");
    d.setAttribute("aria-label", d.dataset.label);
  }
  listEl.addEventListener("focusout", (e) => {
    const d = e.target.closest(".del");
    if (d) disarm(d);
  });

  // ---------- sound ----------
  // The tone is the wave on screen: the y component of the current Fourier
  // series, as a PeriodicWave. Normalized by Web Audio, so loudness stays even
  // across shapes. Changes crossfade between two oscillators to avoid clicks. The pen plays the
  // drawing: its height picks the note, within the tuned range and scale, and its left/right
  // position pans it, both while the circles trace a shape and while you draw by hand. One shared
  // source (bend) carries the pitch into every voice. A soft low-pass and a small room keep the
  // shape's overtones warm instead of buzzy.
  // By default each new note is plucked, like a music box. The tuner panel sets the volume and the
  // rest; all of it is remembered on this device.
  const F0 = 220,
    HMAX = 180;
  const SCALES = { penta: [0, 2, 4, 7, 9], major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] }; // semitones above the root
  // playful by default: C major pentatonic, plucked, bright and bell-like
  const TUNE = {
    volume: 70,
    scale: "penta",
    notes: "pluck",
    root: 3,
    range: 6,
    glide: 20,
    overtones: 8,
    warmth: 35,
    room: 45,
  };
  let tune = { ...TUNE };
  try {
    Object.assign(tune, JSON.parse(localStorage.getItem("sine-tune") || "{}"));
  } catch (_) {}
  const SUSTAIN = 0.12; // where a plucked note settles: a soft bed under the next one
  const level = () => 0.24 * (tune.volume / 100) ** 2; // squared so the slider feels even; 70 is the old fixed level
  const cutoff = () => 8000 * (300 / 8000) ** (tune.warmth / 100); // warmer = lower low-pass
  const base = () => F0 * 2 ** (tune.root / 12);
  function waveArrays() {
    const re = new Float32Array(HMAX + 1),
      im = new Float32Array(HMAX + 1),
      n = Math.min(N, order.length);
    const cap = tune.overtones >= 64 ? HMAX : tune.overtones; // overtones: how many of the circles' harmonics are heard
    for (let i = 0; i < n; i++) {
      const j = order[i],
        f = freq(j),
        h = Math.abs(f);
      if (h > cap || h === 0) continue;
      re[h] += to.im[j];
      im[h] += f > 0 ? to.re[j] : -to.re[j];
    }
    let any = false;
    for (let h = 1; h <= HMAX; h++)
      if (Math.abs(re[h]) + Math.abs(im[h]) > 1e-7) {
        any = true;
        break;
      }
    if (!any) im[1] = 1;
    return { re, im };
  }
  // a small soft room: two channels of decaying noise from a fixed seed, so renders repeat exactly
  function room(ac, sec) {
    const n = Math.round(sec * ac.sampleRate),
      b = ac.createBuffer(2, n, ac.sampleRate);
    let s = 7;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        s = (s * 16807) % 2147483647;
        d[i] = (s / 1073741823.5 - 1) * (1 - i / n) ** 3;
      }
    }
    return b;
  }
  function chain(ac, pan) {
    // master gain -> warmth -> dry + room -> panner when there is one -> limiter
    const master = ac.createGain();
    master.gain.value = 0;
    const warm = ac.createBiquadFilter();
    warm.type = "lowpass";
    warm.frequency.value = cutoff();
    warm.Q.value = 0.5;
    const verb = ac.createConvolver();
    verb.buffer = room(ac, 2.2);
    const wet = ac.createGain();
    wet.gain.value = (tune.room / 100) * 0.8;
    master.warm = warm;
    master.wet = wet; // handles for the tuner
    const mix = ac.createGain();
    master.connect(warm);
    warm.connect(mix);
    warm.connect(verb);
    verb.connect(wet);
    wet.connect(mix);
    const lim = ac.createDynamicsCompressor();
    lim.threshold.value = -10;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.003;
    lim.release.value = 0.12;
    if (pan) {
      mix.connect(pan);
      pan.connect(lim);
    } else mix.connect(lim);
    lim.connect(ac.destination);
    return master;
  }
  // a note's strike: quick attack, then a decay down to the sustain level
  function strike(g, t) {
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1, t + 0.006);
    g.setTargetAtTime(SUSTAIN, t + 0.006, 0.16);
  }
  // y about -1..1 -> a pitch up to the tuned range either side of the base note, on the scale if one is set
  function note(y) {
    const s = Math.max(-1, Math.min(1, y)) * tune.range * 3,
      deg = SCALES[tune.scale];
    if (!deg) return base() * 2 ** (s / 12);
    const o = Math.floor(s / 12),
      r = s - o * 12;
    let k = 0;
    for (const v of [...deg, 12]) if (Math.abs(r - v) < Math.abs(r - k)) k = v;
    return base() * 2 ** ((o * 12 + k) / 12);
  }
  let ac = null,
    master = null,
    bend = null,
    pan = null,
    env = null,
    voice = null,
    pend = 0,
    lastUpd = 0,
    pitch = F0,
    lastNote = 0,
    lastPluck = -1e9;
  // x, y: the pen relative to the drawing, about -1..1, y up
  function audioPen(x, y) {
    pitch = note(y);
    // plucked: every new note is struck, at most every 70ms
    const pl =
      tune.notes === "pluck" && Math.abs(12 * Math.log2(pitch / lastNote)) >= 0.99 && clock - lastPluck >= 70;
    if (pl) {
      lastNote = pitch;
      lastPluck = clock;
    }
    if (bend) {
      bend.offset.setTargetAtTime(pitch, ac.currentTime, Math.max(0.005, tune.glide / 3000));
      pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, x)) * 0.6, ac.currentTime, 0.05);
      if (pl) strike(env.gain, ac.currentTime);
    }
  }
  function audioUpdate() {
    if (!ac || !to) return;
    const now = performance.now();
    clearTimeout(pend);
    if (now - lastUpd < 70) {
      pend = setTimeout(audioUpdate, 70 - (now - lastUpd));
      return;
    }
    lastUpd = now;
    const { re, im } = waveArrays(),
      t0 = ac.currentTime;
    const o = ac.createOscillator(),
      g = ac.createGain();
    o.frequency.value = 0;
    bend.connect(o.frequency);
    o.onended = () => bend.disconnect(o.frequency);
    o.setPeriodicWave(ac.createPeriodicWave(re, im));
    g.gain.value = 0;
    o.connect(g);
    g.connect(env);
    o.start(t0);
    g.gain.setTargetAtTime(1, t0, 0.025);
    if (voice) {
      const v = voice;
      v.g.gain.cancelScheduledValues(t0);
      v.g.gain.setTargetAtTime(0, t0, 0.025);
      v.o.stop(t0 + 0.25);
    }
    voice = { o, g };
  }
  // iPhone: play even with the silent switch on. Safari 17+ has audioSession; older ones need a
  // looping silent <audio> playing too, which moves the page into the playback category.
  let hush = null;
  function silence() {
    // 0.1 s of 8-bit mono silence at 8 kHz, as a WAV
    const n = 800,
      v = new DataView(new ArrayBuffer(44 + n)),
      s = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    s(0, "RIFF");
    v.setUint32(4, 36 + n, true);
    s(8, "WAVEfmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true);
    v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true);
    v.setUint16(34, 8, true);
    s(36, "data");
    v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([v], { type: "audio/wav" }));
  }
  function playThrough(on) {
    if (navigator.audioSession) {
      if (on) navigator.audioSession.type = "playback";
      return;
    }
    if (!("ontouchend" in document)) return;
    if (!hush) {
      hush = new Audio(silence());
      hush.loop = true;
      hush.setAttribute("playsinline", "");
    }
    if (on) hush.play().catch(() => {});
    else hush.pause();
  }
  const soundOn = () => snd.getAttribute("aria-pressed") === "true";
  // A lock, an app switch or a call suspends the context (on iPhone, "interrupted"). Resume it on
  // the way back, and on the next tap if the browser wants a gesture, so sound that is on stays on.
  function wake() {
    if (!ac || !soundOn() || document.hidden) return;
    if (hush && hush.paused) hush.play().catch(() => {});
    if (ac.state !== "running") ac.resume().catch(() => {});
  }
  for (const e of ["pointerdown", "touchend", "keydown"]) addEventListener(e, wake, { capture: true, passive: true });
  document.addEventListener("visibilitychange", wake);
  addEventListener("pageshow", wake);
  snd.addEventListener("click", () => {
    const on = snd.getAttribute("aria-pressed") !== "true";
    snd.setAttribute("aria-pressed", String(on));
    tuneBtn.disabled = !on;
    if (!on) openTuner(false);
    playThrough(on);
    if (on) {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ac = new AC();
        ac.onstatechange = wake;
        pan = ac.createStereoPanner();
        master = chain(ac, pan);
        bend = ac.createConstantSource();
        bend.offset.value = pitch;
        bend.start();
        env = ac.createGain();
        env.gain.value = tune.notes === "pluck" ? SUSTAIN : 1;
        env.connect(master);
        const b = ac.createBuffer(1, 1, ac.sampleRate),
          s = ac.createBufferSource();
        s.buffer = b;
        s.connect(ac.destination);
        s.start(0); // iOS unlock
        lastUpd = 0;
        audioUpdate();
      }
      ac.resume().catch(() => {});
      const n = ac.currentTime;
      master.gain.cancelScheduledValues(n);
      master.gain.setTargetAtTime(level(), n, 0.08);
      if (tune.notes === "pluck") strike(env.gain, n); // a note right away, so on sounds on
    } else if (ac) {
      const n = ac.currentTime;
      master.gain.cancelScheduledValues(n);
      master.gain.setTargetAtTime(0, n, 0.05);
    }
  });
  // ---------- tuner ----------
  const NOTES = ["A", "A♯", "B", "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯"];
  function shown(k) {
    const v = tune[k];
    if (k === "volume" || k === "room") return v + "%";
    if (k === "root") return NOTES[((v % 12) + 12) % 12] + (3 + Math.floor((v + 9) / 12));
    if (k === "range") return v / 4 + " oct";
    if (k === "glide") return v + " ms";
    if (k === "overtones") return v >= 64 ? "all" : String(v);
    const c = cutoff();
    return c >= 1000 ? (c / 1000).toFixed(1) + " kHz" : Math.round(c) + " Hz";
  }
  function showTune() {
    for (const el of tuner.querySelectorAll("input")) {
      const k = el.dataset.k;
      el.value = String(tune[k]);
      el.style.setProperty("--p", ((tune[k] - el.min) / (el.max - el.min)) * 100 + "%");
      el.nextElementSibling.textContent = shown(k);
    }
    for (const b of tuner.querySelectorAll("[data-scale]"))
      b.setAttribute("aria-pressed", String(b.dataset.scale === tune.scale));
    for (const b of tuner.querySelectorAll("[data-notes]"))
      b.setAttribute("aria-pressed", String(b.dataset.notes === tune.notes));
  }
  function applyTune(k) {
    showTune();
    try {
      localStorage.setItem("sine-tune", JSON.stringify(tune));
    } catch (_) {}
    if (!ac) return;
    const t = ac.currentTime;
    if (snd.getAttribute("aria-pressed") === "true") {
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(level(), t, 0.05);
    }
    master.warm.frequency.setTargetAtTime(cutoff(), t, 0.05);
    master.wet.gain.setTargetAtTime((tune.room / 100) * 0.8, t, 0.05);
    if (k === "notes" || k === "all") {
      env.gain.cancelScheduledValues(t);
      env.gain.setTargetAtTime(tune.notes === "pluck" ? SUSTAIN : 1, t, 0.05);
    }
    if (k === "overtones" || k === "all") audioUpdate();
  }
  const expand = tuner.querySelector(".expand");
  function fullTuner(on) {
    tuner.classList.toggle("full", on);
    expand.setAttribute("aria-expanded", String(on));
    expand.textContent = on ? "Less" : "More";
  }
  function openTuner(on) {
    tuner.classList.toggle("open", on);
    tuneBtn.setAttribute("aria-expanded", String(on));
    if (!on) fullTuner(false);
  }
  tuneBtn.addEventListener("click", () => openTuner(!tuner.classList.contains("open")));
  tuner.addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (k) {
      tune[k] = +e.target.value;
      applyTune(k);
    }
  });
  tuner.addEventListener("click", (e) => {
    const b = e.target.closest("[data-scale]"),
      nb = e.target.closest("[data-notes]");
    if (b) {
      tune.scale = b.dataset.scale;
      applyTune("scale");
    } else if (nb) {
      tune.notes = nb.dataset.notes;
      applyTune("notes");
    } else if (e.target.closest(".reset")) {
      tune = { ...TUNE };
      applyTune("all");
    } else if (e.target.closest(".expand")) fullTuner(!tuner.classList.contains("full"));
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (tuner.classList.contains("open")) {
      openTuner(false);
      tuneBtn.focus();
    }
  });
  // a tap outside an open panel closes it, and does not also start a drawing
  addEventListener(
    "pointerdown",
    (e) => {
      if (!tuner.classList.contains("open")) return;
      if (tuner.contains(e.target) || tuneBtn.contains(e.target)) return;
      openTuner(false);
      if (e.target === cv) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
  showTune();

  // ---------- sound hint, every visit ----------
  // Once per visit, while sound is off: a quiet tooltip points at the sound button as soon as the first
  // drawing is done, or after 8 s of nothing if the visitor never draws. It goes away for good after 5 s,
  // on any tap or key, or when sound is turned on. The 5 s only counts down while the
  // mouse is off the note and the sound button and focus is not on the x: hovering holds it open.
  const hint = document.getElementById("hint"),
    hintTxt = document.getElementById("hint-t");
  document.getElementById("hint-x").addEventListener("click", hideHint);
  let hintT = 0,
    hintHeld = 0; // pointers over the note or the sound button, plus focus on the x
  let done = false, // per visit only: it comes back on every page load
    hinted = false,
    idleT = 0;
  const seen = () => done || hinted;
  // Tab and modifiers move focus to the x without closing the hint; Escape and other keys close it
  const HINT_KEEP = ["Tab", "Shift", "Control", "Alt", "Meta", "CapsLock"];
  function hintKey(e) {
    if (!HINT_KEEP.includes(e.key)) hideHint();
  }
  function placeHint() {
    // floats out of the layout, flush with the prompt's right edge and 8px above it, over empty canvas; with
    // no prompt on this deploy it sits above the controls instead. No caret: the prompt sits between the
    // note and the sound button, so one would point through the input. The button's gray fill ties them.
    const b = bar.getBoundingClientRect(),
      top = (ask.hidden ? bar.querySelector(".row") : ask).getBoundingClientRect().top;
    hint.style.left = Math.max(0, b.width - hint.offsetWidth) + "px";
    hint.style.setProperty("--hb", b.bottom - top + 8 + "px");
  }
  function hintCount() {
    clearTimeout(hintT);
    if (!done && !hintHeld) hintT = setTimeout(hideHint, 5000);
  }
  function hintHold(on) {
    hintHeld = Math.max(0, hintHeld + (on ? 1 : -1));
    hintCount();
  }
  for (const el of [hint, snd]) {
    el.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && hintHold(true));
    el.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && hintHold(false));
  }
  hint.addEventListener("focusin", () => hintHold(true));
  hint.addEventListener("focusout", () => hintHold(false));
  function hideHint() {
    clearTimeout(hintT);
    hintHeld = 0;
    removeEventListener("pointerdown", hideHint, true);
    removeEventListener("keydown", hintKey, true);
    removeEventListener("resize", placeHint);
    done = true;
    snd.classList.remove("hinted");
    snd.removeAttribute("aria-describedby");
    hint.classList.remove("open");
    setTimeout(() => {
      hint.hidden = true;
      hintTxt.textContent = "";
    }, 250);
  }
  function showHint() {
    clearTimeout(idleT);
    if (seen() || snd.getAttribute("aria-pressed") === "true") return;
    if (document.visibilityState !== "visible") {
      document.addEventListener("visibilitychange", () => setTimeout(showHint, 1200), { once: true });
      return;
    }
    hinted = true;
    hint.hidden = false;
    hintTxt.textContent = "Turn on sound to hear your drawing";
    placeHint();
    hint.getBoundingClientRect();
    hint.classList.add("open");
    snd.classList.add("hinted");
    snd.setAttribute("aria-describedby", "hint");
    addEventListener("pointerdown", hideHint, true);
    addEventListener("keydown", hintKey, true);
    addEventListener("resize", placeHint);
    hintHeld = (snd.matches(":hover") ? 1 : 0) + (hint.matches(":hover") ? 1 : 0);
    hintCount();
  }
  snd.addEventListener("click", () => {
    if (snd.getAttribute("aria-pressed") === "true" && !done) hideHint();
  });
  // the first drawing finishing is the cue; 8 s without any input is the fallback
  function armHint() {
    clearTimeout(idleT);
    if (seen()) return;
    idleT = setTimeout(() => {
      if (pid !== null || typing()) return armHint(); // mid-stroke or typing: not idle yet
      showHint();
    }, 8000);
  }
  for (const e of ["pointerdown", "keydown"]) addEventListener(e, armHint, { capture: true, passive: true });
  hintAfterDraw = () => {
    clearTimeout(idleT);
    setTimeout(showHint, 450);
  };
  armHint();

  // ---------- loop ----------
  function relayout() {
    if (typing()) return;
    layout();
    audioUpdate();
  }
  addEventListener("resize", relayout);
  addEventListener("orientationchange", relayout);
  if (window.visualViewport) visualViewport.addEventListener("resize", relayout);
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    relayout();
    // back from the back-forward cache counts as a new visit
    if (!done) return;
    done = false;
    hinted = false;
    armHint();
  });
  // The prompt box needs /api/draw (see README). Ask once, briefly, so the layout settles before
  // the first frame; without the endpoint the app works the same, minus the prompt.
  const probe = new AbortController();
  setTimeout(() => probe.abort(), 800);
  fetch("/api/draw", { signal: probe.signal })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((v) => {
      ask.hidden = !(v && v.ok);
      if (v && v.ok && v.free && typeof v.free.left === "number") free = v.free.left;
      if (!ask.hidden && !own && free === 0) {
        status(freeLabel());
        keyOpen(OUT);
      }
      start();
    });
  function start() {
    layout();
    slider.style.setProperty("--p", "0%");
    load(SHAPES.star(), { fresh: true });
    renderSaved();
    let last = performance.now();
    function loop(now) {
      const dt = Math.min(50, now - last);
      last = now;
      if (geom() !== measured) relayout();
      frame(dt);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
})();
