(() => {
  const M = 2048,
    S = M,
    TAU = Math.PI * 2;
  const BASE = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128, 255, 512, 1000];
  const DRAW_N = 255; // prompt drawings form at this many waves; at 5 they read as a blob
  const cv = document.getElementById("c"),
    ctx = cv.getContext("2d");
  const slider = document.getElementById("n"),
    out = document.getElementById("out"),
    snd = document.getElementById("snd"),
    vol = document.getElementById("vol"),
    tuneBtn = document.getElementById("tune"),
    tuner = document.getElementById("tuner");
  const segBtns = [...document.querySelectorAll(".seg [data-s]")];
  const bar = document.querySelector(".bar"),
    header = document.querySelector("header");
  const ask = document.getElementById("ask"),
    q = document.getElementById("q"),
    go = document.getElementById("go"),
    statusEl = document.getElementById("status");
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
  function setN() {
    wt.fill(0);
    const n = Math.min(N, order.length);
    for (let i = 0; i < n; i++) wt[order[i]] = 1;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const j = order[i];
      kept += to.re[j] ** 2 + to.im[j] ** 2;
    }
    fid = 1 - Math.sqrt(Math.max(0, energy - kept) / (energy || 1));
    const pct = fid >= 0.9995 ? 100 : Math.min(99, Math.round(fid * 100));
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
    segBtns.forEach((o) => o.setAttribute("aria-pressed", String(o.dataset.s === name)));
    custom = null;
    showing = null;
    savedBtn.classList.remove("on");
    born = Math.min(born, clock - period);
  }

  // ---------- layout ----------
  let W = 0,
    H = 0,
    DPR = 1,
    L = {};
  function layout() {
    DPR = Math.min(2, devicePixelRatio || 1);
    W = innerWidth;
    H = innerHeight;
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
    const land = sw > sh * 1.15;
    if (land) {
      const bw = Math.min(sw * 0.42, sh * 1.1);
      const R = Math.min(bw, sh) * 0.42;
      L = { land, R, cx: left + bw / 2, cy: top + sh / 2, w0: left + bw / 2 + R * 1.18 + 40, w1: right };
    } else {
      const bh = sh * 0.56;
      const R = Math.min(sw, bh) * 0.42;
      L = { land, R, cx: W / 2, cy: top + bh / 2, w0: top + bh / 2 + R * 1.18 + 28, w1: bottom };
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
  function frame(dt) {
    clock += dt;
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
    const { R, cx, cy, land, w0, w1 } = L;
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
      if (land) {
        ctx.moveTo(w0, cy);
        ctx.lineTo(w1, cy);
      } else {
        ctx.moveTo(cx, w0);
        ctx.lineTo(cx, w1);
      }
      ctx.stroke();
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = `rgba(${INK},.28)`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      land ? ctx.lineTo(w0, y) : ctx.lineTo(x, w0);
      ctx.stroke();
      ctx.setLineDash([]);
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
          const px = land ? w0 + v * span : cx + p[0] * R,
            py = land ? cy + p[1] * R : w0 + v * span;
          k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
    }
    audioPen((x - cx) / R, (cy - y) / R);
    dot(x, y);
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
  let pid = null;
  cv.addEventListener("pointerdown", (e) => {
    if (pid !== null) return;
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
    drew(s, "Drawing");
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
    custom = null;
    renderShelf();
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
      status("");
    } else status(err === "busy" ? "one moment, try again" : "couldn’t draw that");
    if (!ok)
      setTimeout(() => {
        if (!live) status("");
      }, 3200);
    live = null;
    go.disabled = !q.value.trim();
  }
  ask.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = q.value.trim().slice(0, 60);
    if (!text || live) return;
    q.blur();
    promptStart(text);
    const id = job;
    try {
      const r = await fetch("/api/draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      if (!r.ok || !r.body) {
        promptEnd(r.status === 429 ? "busy" : "fail");
        return;
      }
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
  // points, normalized and rounded, and the wave count it was saved at.
  const KEY = "sine-shapes",
    MAX_PTS = 1200;
  const savedBtn = document.getElementById("saved"),
    shelf = document.getElementById("shelf"),
    keep = document.getElementById("keep"),
    nameEl = document.getElementById("name"),
    noneEl = document.getElementById("none"),
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
    renderShelf();
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
  function renderShelf() {
    keep.hidden = !custom;
    if (custom && document.activeElement !== nameEl) nameEl.value = custom.name;
    noneEl.textContent = "Draw a shape to save it here.";
    noneEl.hidden = !!custom || shapes.length > 0;
    listEl.innerHTML = shapes
      .map(
        (x) =>
          `<li><button type="button" class="item" data-id="${x.id}" aria-current="${x.id === showing}">${thumb(x.pts)}<span>${esc(x.name)}</span></button>` +
          `<button type="button" class="del" data-id="${x.id}" aria-label="Delete ${esc(x.name)}">${X}<span class="confirm" aria-hidden="true">Confirm delete</span></button></li>`,
      )
      .join("");
    savedBtn.classList.toggle("on", showing !== null);
  }
  function openShelf(on) {
    if (on) {
      openTuner(false);
      openConnect(false);
      const b = bar.getBoundingClientRect(),
        s = savedBtn.getBoundingClientRect();
      shelf.style.transformOrigin = `${s.left + s.width / 2 - b.left}px 100%`;
      renderShelf();
    }
    shelf.classList.toggle("open", on);
    savedBtn.setAttribute("aria-expanded", String(on));
  }
  savedBtn.addEventListener("click", () => openShelf(!shelf.classList.contains("open")));
  keep.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!custom) return;
    const nz = normalize(custom.pts.length > MAX_PTS ? resample(custom.pts, MAX_PTS) : custom.pts).pts;
    const r = (v) => Math.round(v * 1000) / 1000;
    const x = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: nameEl.value.trim().slice(0, 40) || custom.name,
      pts: nz.map((p) => [r(p[0]), r(p[1])]),
      n: N,
    };
    shapes.unshift(x);
    if (!persist()) {
      shapes.shift();
      nameEl.blur();
      noneEl.textContent = "No room left. Delete a shape first.";
      noneEl.hidden = false;
      return;
    }
    custom = null;
    showing = x.id;
    renderShelf();
    listEl.querySelector(".item").focus(); // focus follows the shape you just saved
  });
  listEl.addEventListener("click", (e) => {
    const del = e.target.closest(".del"),
      item = e.target.closest(".item");
    if (del) {
      // two taps: the first arms it, the second deletes
      if (!del.classList.contains("armed")) {
        for (const d of listEl.querySelectorAll(".armed")) disarm(d);
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
      if (showing === del.dataset.id) showing = null;
      renderShelf();
      // focus moves to the row that took its place, else the one above, else back to Saved
      const rows = listEl.querySelectorAll(".item");
      (rows[Math.min(i, rows.length - 1)] || (keep.hidden ? savedBtn : nameEl)).focus();
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
      openShelf(false);
      renderShelf();
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
  // The tone is the wave on screen: the y (side layout) or x (stacked layout) component of the
  // current Fourier series, as a PeriodicWave. Normalized by Web Audio, so loudness stays even
  // across shapes. Changes crossfade between two oscillators to avoid clicks. The pen plays the
  // drawing: its height picks the note, within the tuned range and scale, and its left/right
  // position pans it, both while the circles trace a shape and while you draw by hand. One shared
  // source (bend) carries the pitch into every voice. A soft low-pass and a small room keep the
  // shape's overtones warm instead of buzzy.
  // By default each new note is plucked, like a music box. The speaker's slider sets the volume and
  // the tuner panel changes the rest; both are remembered on this device.
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
      if (L.land) {
        re[h] += to.im[j];
        im[h] += f > 0 ? to.re[j] : -to.re[j];
      } else {
        re[h] += to.re[j];
        im[h] += f > 0 ? -to.im[j] : to.im[j];
      }
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
  snd.addEventListener("click", () => {
    const on = snd.getAttribute("aria-pressed") !== "true";
    snd.setAttribute("aria-pressed", String(on));
    vol.disabled = !on;
    tuneBtn.disabled = !on;
    if (!on) openTuner(false);
    if (on) {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ac = new AC();
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
      ac.resume();
      const n = ac.currentTime;
      master.gain.cancelScheduledValues(n);
      master.gain.setTargetAtTime(level(), n, 0.08);
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
    vol.value = String(tune.volume);
    vol.style.setProperty("--p", tune.volume + "%");
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
    if (on) {
      openShelf(false);
      openConnect(false);
    }
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
  vol.addEventListener("input", () => {
    tune.volume = +vol.value;
    applyTune("volume");
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
  // ---------- connect your agent: the MCP address to copy (api/mcp.js) ----------
  const agentBtn = document.getElementById("agent"),
    connect = document.getElementById("connect"),
    copyBtn = document.getElementById("copy"),
    mcpEl = document.getElementById("mcp");
  mcpEl.textContent = location.origin + "/api/mcp";
  function openConnect(on) {
    if (on) {
      openTuner(false);
      openShelf(false);
      // below the title and tagline, however many lines the tagline wraps to
      const top = Math.max(header.getBoundingClientRect().bottom, agentBtn.getBoundingClientRect().bottom);
      connect.style.setProperty("--top", Math.round(top + 8) + "px");
    }
    connect.classList.toggle("open", on);
    agentBtn.setAttribute("aria-expanded", String(on));
  }
  agentBtn.addEventListener("click", () => openConnect(!connect.classList.contains("open")));
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(mcpEl.textContent);
      copyBtn.textContent = "Copied";
    } catch (_) {
      getSelection().selectAllChildren(mcpEl); // no clipboard access: select it to copy by hand
      return;
    }
    clearTimeout(copyBtn.t);
    copyBtn.t = setTimeout(() => (copyBtn.textContent = "Copy"), 1600);
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (connect.classList.contains("open")) {
      openConnect(false);
      agentBtn.focus();
    } else if (tuner.classList.contains("open")) {
      openTuner(false);
      tuneBtn.focus();
    } else if (shelf.classList.contains("open")) {
      openShelf(false);
      savedBtn.focus();
    }
  });
  // a tap outside an open panel closes it, and does not also start a drawing
  addEventListener(
    "pointerdown",
    (e) => {
      const open = tuner.classList.contains("open")
        ? [tuner, tuneBtn]
        : shelf.classList.contains("open")
          ? [shelf, savedBtn]
          : connect.classList.contains("open")
            ? [connect, agentBtn]
            : null;
      if (!open || open.some((el) => el.contains(e.target))) return;
      openTuner(false);
      openShelf(false);
      openConnect(false);
      if (e.target === cv) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
  showTune();

  // ---------- loop ----------
  addEventListener("resize", () => {
    layout();
    audioUpdate();
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
      start();
    });
  // ---------- links: /?p=heart plays a preset, /?s=CODE plays a shape an agent drew (api/mcp.js) ----------
  // CODE is base64url of [1, count, then zigzag varint deltas of x and y on a 1000 box].
  function unpack(code) {
    const b = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
    let i = 0;
    const varint = () => {
      let v = 0,
        sh = 0,
        c;
      do {
        if (i >= b.length || sh > 28) throw 0;
        c = b.charCodeAt(i++);
        v |= (c & 0x7f) << sh;
        sh += 7;
      } while (c & 0x80);
      return v >>> 0;
    };
    const zz = (v) => (v & 1 ? -(v + 1) / 2 : v / 2);
    if (varint() !== 1) throw 0;
    const n = varint(),
      pts = [];
    if (n < 3 || n > 2000) throw 0;
    let x = 0,
      y = 0;
    for (let k = 0; k < n; k++) {
      x += zz(varint());
      y += zz(varint());
      pts.push([x, y]);
    }
    return pts;
  }
  function fromLink() {
    const qs = new URLSearchParams(location.search),
      p = qs.get("p");
    if (p && SHAPES[p]) {
      pick(p);
      load(SHAPES[p](), { fresh: true });
      return true;
    }
    let pts;
    try {
      pts = unpack(qs.get("s") || "");
    } catch (_) {
      return false;
    }
    pick("yours");
    const n = +qs.get("n"),
      i = steps.indexOf(steps.includes(n) ? n : DRAW_N);
    N = steps[i];
    slider.value = String(i);
    load(normalize(resample(pts, M)).pts, { fresh: true });
    drew(pts, (qs.get("t") || "").trim().slice(0, 40) || "Drawing");
    return true;
  }
  function start() {
    layout();
    slider.style.setProperty("--p", "0%");
    if (!fromLink()) load(SHAPES.star(), { fresh: true });
    renderShelf();
    let last = performance.now();
    function loop(now) {
      const dt = Math.min(50, now - last);
      last = now;
      frame(dt);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
})();
