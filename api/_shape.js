// Shapes for the MCP server (mcp.js): turn an agent's points or SVG path into one closed line on
// a 1000 by 1000 box, then pack it into a short code for a share link (/?s=CODE). The page
// decodes the same code (unpack in app.js), so a shared drawing needs no database.
// Code: base64url of [1, count, then each point as zigzag varint deltas of x and y].
import { spline } from "./_spline.js";

export const MAX_IN = 5000, // points accepted from an agent
  MAX_OUT = 400; // points kept in a link; corners survive, straight runs collapse

// ---------- svg path -> points ----------
const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

export function pathPoints(d) {
  const toks = String(d).match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) || [];
  const out = [];
  let i = 0,
    cmd = "",
    x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    cx = 0,
    cy = 0,
    prev = "";
  const num = () => {
    const v = +toks[i++];
    if (!Number.isFinite(v)) throw new Error("bad number in path");
    return v;
  };
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const n = 16;
    for (let k = 1; k <= n; k++) {
      const t = k / n,
        u = 1 - t;
      out.push([
        u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
  };
  const arc = (rx, ry, phi, large, sweep, x2, y2) => {
    // endpoint to center form (SVG spec, appendix F.6)
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!rx || !ry) return out.push([x2, y2]);
    const c = Math.cos((phi * Math.PI) / 180),
      s = Math.sin((phi * Math.PI) / 180);
    const dx = (x - x2) / 2,
      dy = (y - y2) / 2;
    const x1p = c * dx + s * dy,
      y1p = -s * dx + c * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) {
      rx *= Math.sqrt(lam);
      ry *= Math.sqrt(lam);
    }
    const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p,
      den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const f = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
    const cxp = (f * rx * y1p) / ry,
      cyp = (-f * ry * x1p) / rx;
    const ccx = c * cxp - s * cyp + (x + x2) / 2,
      ccy = s * cxp + c * cyp + (y + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const a1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let da = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && da > 0) da -= 2 * Math.PI;
    if (sweep && da < 0) da += 2 * Math.PI;
    const n = Math.max(4, Math.ceil(Math.abs(da) / (Math.PI / 16)));
    for (let k = 1; k <= n; k++) {
      const a = a1 + (da * k) / n;
      out.push([ccx + rx * Math.cos(a) * c - ry * Math.sin(a) * s, ccy + rx * Math.cos(a) * s + ry * Math.sin(a) * c]);
    }
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    else if (!cmd) throw new Error("path must start with M");
    const lo = cmd.toLowerCase(),
      rel = cmd !== cmd.toUpperCase();
    if (!(lo in ARGS)) throw new Error(`unsupported path command ${cmd}`);
    if (lo === "z") {
      out.push([sx, sy]);
      x = sx;
      y = sy;
      prev = "z";
      continue;
    }
    if (i + ARGS[lo] > toks.length) throw new Error("path ends early");
    const ox = rel ? x : 0,
      oy = rel ? y : 0;
    if (lo === "m") {
      x = ox + num();
      y = oy + num();
      sx = x;
      sy = y;
      out.push([x, y]); // a new subpath joins the last one with a straight pen move
      cmd = rel ? "l" : "L";
    } else if (lo === "l") {
      x = ox + num();
      y = oy + num();
      out.push([x, y]);
    } else if (lo === "h") {
      x = ox + num();
      out.push([x, y]);
    } else if (lo === "v") {
      y = (rel ? y : 0) + num();
      out.push([x, y]);
    } else if (lo === "c" || lo === "s") {
      let x1, y1;
      if (lo === "c") {
        x1 = ox + num();
        y1 = oy + num();
      } else {
        const smooth = prev === "c" || prev === "s";
        x1 = smooth ? 2 * x - cx : x;
        y1 = smooth ? 2 * y - cy : y;
      }
      const x2 = ox + num(),
        y2 = oy + num(),
        x3 = ox + num(),
        y3 = oy + num();
      cubic(x1, y1, x2, y2, x3, y3);
      cx = x2;
      cy = y2;
      x = x3;
      y = y3;
    } else if (lo === "q" || lo === "t") {
      let qx, qy;
      if (lo === "q") {
        qx = ox + num();
        qy = oy + num();
      } else {
        const smooth = prev === "q" || prev === "t";
        qx = smooth ? 2 * x - cx : x;
        qy = smooth ? 2 * y - cy : y;
      }
      const x3 = ox + num(),
        y3 = oy + num();
      cubic(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x3 + (2 / 3) * (qx - x3), y3 + (2 / 3) * (qy - y3), x3, y3);
      cx = qx;
      cy = qy;
      x = x3;
      y = y3;
    } else if (lo === "a") {
      const rx = num(),
        ry = num(),
        phi = num(),
        large = num() ? 1 : 0,
        sweep = num() ? 1 : 0,
        x2 = ox + num(),
        y2 = oy + num();
      arc(rx, ry, phi, large, sweep, x2, y2);
      x = x2;
      y = y2;
    }
    prev = lo;
    if (out.length > MAX_IN * 4) throw new Error("path is too long");
  }
  return out;
}

// ---------- points -> one clean line on the 1000 box ----------
export function readPoints(list) {
  if (!Array.isArray(list)) throw new Error("points must be a list of [x, y] pairs");
  const pts = list
    .map((p) => (Array.isArray(p) ? [+p[0], +p[1]] : p && typeof p === "object" ? [+p.x, +p.y] : null))
    .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length !== list.length) throw new Error("every point needs a finite x and y");
  return pts;
}

// Douglas-Peucker: drop points that sit on the line between their neighbours.
function simplify(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a],
      [bx, by] = pts[b],
      len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1,
      dmax = eps;
    for (let i = a + 1; i < b; i++) {
      const d =
        len === 1 && ax === bx && ay === by
          ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
          : Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > dmax) {
        dmax = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function shape(raw, { smooth = false } = {}) {
  if (raw.length > MAX_IN * 4) throw new Error(`at most ${MAX_IN} points`);
  if (raw.length < 3) throw new Error("a shape needs at least 3 points");
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of raw) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const span = Math.max(x1 - x0, y1 - y0);
  if (!(span > 0)) throw new Error("the points are all in one place");
  // fit the longer side to 40..960, centred, keeping the aspect
  const k = 920 / span,
    ox = 500 - ((x0 + x1) / 2) * k,
    oy = 500 - ((y0 + y1) / 2) * k;
  let pts = raw.map(([x, y]) => [x * k + ox, y * k + oy]);
  if (smooth) {
    const c = spline(),
      s = [];
    for (const p of pts) s.push(...c.push(p));
    s.push(...c.end());
    pts = s;
  }
  pts = pts
    .map(([x, y]) => [Math.round(x), Math.round(y)])
    .filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  let eps = 0.6,
    out = simplify(pts, eps);
  while (out.length > MAX_OUT) out = simplify(pts, (eps *= 1.5));
  if (out.length < 3) throw new Error("the shape is a straight line");
  return out;
}

// ---------- pack ----------
export function pack(pts) {
  const bytes = [1];
  const varint = (v) => {
    do {
      let b = v & 0x7f;
      v >>>= 7;
      bytes.push(v ? b | 0x80 : b);
    } while (v);
  };
  varint(pts.length);
  let px = 0,
    py = 0;
  for (const [x, y] of pts) {
    for (const d of [x - px, y - py]) varint(d < 0 ? -2 * d - 1 : 2 * d);
    px = x;
    py = y;
  }
  return Buffer.from(bytes).toString("base64url");
}
