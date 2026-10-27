# "sine" as one pen path: cubic Bezier segments drawn like a type designer would,
# x-height 1, baseline 0, y up, then slanted. Sampled densely along the centerline.
import math
SLANT = math.tan(math.radians(9))
START = (0.00, 0.06)

def _split(p0, c1, c2, p3, t):
    L = lambda a, b: (a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t)
    a, b, c = L(p0, c1), L(c1, c2), L(c2, p3)
    d, e = L(a, b), L(b, c)
    m = L(d, e)
    return (p0, a, d, m), (m, e, c, p3)
# The exit retraces the bottom of the belly (so it reads as one line), then leaves it on
# the same tangent and rises into the i.
_BELLY = ((0.82,0.32),(0.80,0.06),(0.56,-0.02),(0.38,0.01))
_head, _tail = _split(*_BELLY, 0.62)            # _tail: from the split point to the bottom
_m = _tail[0]; _tan = (_head[2][0]-_m[0], _head[2][1]-_m[1])  # direction back up the belly
_k = 0.9
RETRACE_OUT = [
 (_tail[2], _tail[1], _m),                      # bottom -> split point, reversed
 ((_m[0]+_tan[0]*_k*0.55, _m[1]+_tan[1]*_k*0.55 + 0.0), (0.96,0.44), (1.02,0.92)),
]
SEGS = [
 # s: curved entry upstroke, small round turn at the top, belly, close near the upstroke
 ((0.16,0.28),(0.30,0.70),(0.42,0.96)),
 ((0.46,1.04),(0.55,1.02),(0.56,0.92)),
 ((0.62,0.76),(0.84,0.58),(0.82,0.32)),
 ((0.80,0.06),(0.56,-0.02),(0.38,0.01)),
 ((0.26,0.03),(0.16,0.08),(0.16,0.15)),
 # retrace the curl exactly (reads as one line), then rise into i
 ((0.16,0.08),(0.26,0.03),(0.38,0.01)),
 *RETRACE_OUT,
 # i: round top, stem, round bowl
 ((1.04,1.02),(1.11,1.02),(1.11,0.92)),
 ((1.11,0.62),(1.09,0.30),(1.11,0.16)),
 ((1.13,0.01),(1.31,-0.03),(1.42,0.10)),
 # n: rise into a round first shoulder, stem to the baseline
 ((1.54,0.30),(1.62,0.92),(1.77,0.99)),
 ((1.88,1.03),(1.92,0.88),(1.90,0.68)),
 ((1.89,0.44),(1.88,0.20),(1.88,0.00)),
 # back up the stem into the round arch, down, bowl
 ((1.89,0.42),(1.98,0.98),(2.13,1.00)),
 ((2.28,1.02),(2.32,0.80),(2.32,0.56)),
 ((2.32,0.32),(2.30,0.14),(2.36,0.06)),
 ((2.43,-0.02),(2.56,0.00),(2.64,0.10)),
 # e: rise, loop over the top, round bottom, exit
 ((2.76,0.24),(3.00,0.40),(3.02,0.62)),
 ((3.04,0.86),(2.86,1.00),(2.74,0.96)),
 ((2.58,0.90),(2.54,0.62),(2.56,0.42)),
 ((2.58,0.14),(2.72,0.00),(2.88,0.00)),
 ((3.04,0.00),(3.16,0.08),(3.24,0.18)),
]
DOT = (1.14, 1.40)

XW = 1.18  # widen: hello-style scripts are round, not condensed
def sheared(p): return (p[0]*XW + p[1]*SLANT, p[1])

def path(per=40):
    out = [START]; p0 = START
    for c1, c2, p3 in SEGS:
        for j in range(1, per+1):
            t = j/per; u = 1-t
            out.append((u**3*p0[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t**3*p3[0],
                        u**3*p0[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t**3*p3[1]))
        p0 = p3
    return [sheared(p) for p in out], sheared(DOT)
