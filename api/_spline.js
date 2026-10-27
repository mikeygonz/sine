// Centripetal Catmull-Rom: the model places sparse key points, this fills in the curve between
// them. Centripetal spacing keeps the curve from looping or overshooting at sharp turns.
// spline() works on a stream: push each key point as it arrives and get back the smooth points
// for the segment that just became complete; end() flushes the last one.
const STEP = 18; // box units per inserted point; long gentle curves get up to MAX_PER points
const MAX_PER = 3;

function segment(p0, p1, p2, p3) {
  const d = (a, b) => Math.max(1e-3, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t1 = d(p0, p1),
    t2 = t1 + d(p1, p2),
    t3 = t2 + d(p2, p3);
  const n = Math.min(MAX_PER, Math.max(1, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / STEP)));
  const lerp = (a, b, ta, tb, t) => [
    a[0] + ((b[0] - a[0]) * (t - ta)) / (tb - ta),
    a[1] + ((b[1] - a[1]) * (t - ta)) / (tb - ta),
  ];
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + ((t2 - t1) * i) / n;
    const a1 = lerp(p0, p1, 0, t1, t),
      a2 = lerp(p1, p2, t1, t2, t),
      a3 = lerp(p2, p3, t2, t3, t);
    const b1 = lerp(a1, a2, 0, t2, t),
      b2 = lerp(a2, a3, t1, t3, t);
    out.push(lerp(b1, b2, t1, t2, t));
  }
  return out;
}

export function spline() {
  const k = [];
  return {
    push(p) {
      k.push(p);
      if (k.length === 1) return [p];
      if (k.length < 3) return [];
      const n = k.length; // segment k[n-3] -> k[n-2] is now complete
      return segment(k[n - 4] || k[n - 3], k[n - 3], k[n - 2], k[n - 1]);
    },
    end() {
      const n = k.length;
      return n < 2 ? [] : segment(k[n - 3] || k[n - 2], k[n - 2], k[n - 1], k[n - 1]);
    },
  };
}
