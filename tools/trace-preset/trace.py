# Turns a picture into one closed pen path for a Sine preset.
#   outline: the outer edge of a dark shape on a light or transparent ground.
#   lines:   the strongest edges of a picture, joined into one stroke. Each line is walked
#            out and back, so the pen can reach every branch without lifting.
# Output is simplified points in a 0..1000 box, printed as JSON (and a preview PNG with --png).
import argparse, json, math, sys
import cv2, numpy as np
from PIL import Image

def load(path, crop):
    im = Image.open(path)
    if crop:
        x0, y0, x1, y1 = crop
        im = im.crop((x0, y0, x1, y1))
    return im

def outline(im, thresh):
    im = im.convert("RGBA")
    a = np.array(im)
    ink = (a[..., 3] > 128) & (a[..., :3].mean(-1) < thresh)
    ink = cv2.morphologyEx(ink.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    cs, _ = cv2.findContours(ink, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)[:, 0, :].astype(float)
    return c, ink

def lines(im, a):
    from skimage.morphology import skeletonize
    from skimage.feature import canny
    from scipy import ndimage as ndi
    W = a.width
    H = round(im.height * W / im.width)
    g = np.array(im.convert("L").resize((W, H), Image.LANCZOS))

    def edges(blur, sigma, lo, hi):
        h = g.copy()
        for _ in range(blur):
            h = cv2.bilateralFilter(h, 9, 40, 9)
        return canny(h, sigma=sigma, low_threshold=lo, high_threshold=hi)

    # two scales: coarse edges everywhere, finer edges inside the --focus oval (the features),
    # and nothing outside the --limit oval (the background)
    yy, xx = np.mgrid[0:H, 0:W]
    oval = lambda cx, cy, rx, ry: ((xx / W - cx) / rx) ** 2 + ((yy / H - cy) / ry) ** 2 <= 1
    e = edges(int(a.coarse[0]), *a.coarse[1:])
    if a.focus:
        e = np.where(oval(*a.focus), edges(int(a.fine[0]), *a.fine[1:]), e)
    if a.limit:
        e &= oval(*a.limit)
    e = cv2.dilate(e.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    sk = prune(skeletonize(e), a.spur)
    lab, n = ndi.label(sk, structure=np.ones((3, 3)))
    sizes = ndi.sum(sk, lab, range(1, n + 1))
    keep = [i + 1 for i in np.argsort(-sizes) if sizes[i] >= a.min_line]
    return tour([np.argwhere(lab == k)[:, ::-1] for k in keep]), sk

def prune(sk, n):
    sk = sk.copy()
    k = np.ones((3, 3), np.uint8)
    for _ in range(n):
        nb = cv2.filter2D(sk.astype(np.uint8), -1, k, borderType=cv2.BORDER_CONSTANT) - sk
        ends = sk & (nb <= 1)
        if not ends.any():
            break
        sk &= ~ends
    return sk

def tour(comps):
    # Join the lines with the shortest bridges (a minimum spanning tree over every pixel plus the
    # nearest pair of pixels between each two lines), then walk that tree depth-first, out and back.
    import networkx as nx
    from scipy.spatial import cKDTree
    G = nx.Graph()
    for c in comps:
        S = {tuple(p) for p in c}
        for x, y in S:
            for dx, dy in ((1, 0), (0, 1), (1, 1), (1, -1)):
                if (x + dx, y + dy) in S:
                    G.add_edge((x, y), (x + dx, y + dy), w=math.hypot(dx, dy))
    trees = [cKDTree(c) for c in comps]
    for i in range(len(comps)):
        for j in range(i + 1, len(comps)):
            d, k = trees[j].query(comps[i])
            m = int(np.argmin(d))
            G.add_edge(tuple(comps[i][m]), tuple(comps[j][k[m]]), w=float(d[m]))
    T = nx.minimum_spanning_tree(G, weight="w")
    root = min(T.nodes)
    out = [root]
    stack = [(root, None, iter(T[root]))]
    while stack:
        u, parent, it = stack[-1]
        for v in it:
            if v != parent:
                out.append(v)
                stack.append((v, u, iter(T[v])))
                break
        else:
            stack.pop()
            if parent is not None:
                out.append(parent)
    return np.array(out, float)

def finish(pts, tol, size=1000):
    pts = np.asarray(pts, float)
    c = cv2.approxPolyDP(pts.astype(np.float32).reshape(-1, 1, 2), tol, False)[:, 0, :]
    lo, hi = c.min(0), c.max(0)
    s = size / max(hi - lo)
    c = (c - (lo + hi) / 2) * s + size / 2
    return np.round(c).astype(int)

def preview(pts, path, size=900):
    img = np.full((size, size, 3), 255, np.uint8)
    p = (np.asarray(pts, float) * (size - 40) / 1000 + 20).astype(np.int32)
    cv2.polylines(img, [p.reshape(-1, 1, 2)], True, (20, 20, 20), 1, cv2.LINE_AA)
    cv2.imwrite(path, img)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("mode", choices=["outline", "lines"])
    ap.add_argument("--crop", type=int, nargs=4, metavar=("X0", "Y0", "X1", "Y1"))
    ap.add_argument("--thresh", type=int, default=100, help="outline: darkness cutoff")
    ap.add_argument("--width", type=int, default=500, help="lines: working width in px")
    ap.add_argument("--coarse", type=float, nargs=4, default=[6, 3.5, 0.04, 0.12],
                    metavar=("BLUR", "SIGMA", "LOW", "HIGH"), help="lines: edges everywhere")
    ap.add_argument("--fine", type=float, nargs=4, default=[3, 2.0, 0.08, 0.2],
                    metavar=("BLUR", "SIGMA", "LOW", "HIGH"), help="lines: edges inside --focus")
    ap.add_argument("--focus", type=float, nargs=4, metavar=("CX", "CY", "RX", "RY"),
                    help="lines: oval (fractions of the crop) that gets the fine edges")
    ap.add_argument("--limit", type=float, nargs=4, metavar=("CX", "CY", "RX", "RY"),
                    help="lines: oval (fractions of the crop) outside which edges are dropped")
    ap.add_argument("--min-line", type=int, default=45, help="lines: drop lines shorter than this many px")
    ap.add_argument("--spur", type=int, default=6, help="lines: trim branches shorter than this")
    ap.add_argument("--tol", type=float, default=1.0, help="simplify tolerance, in 0..1000 units")
    ap.add_argument("--png")
    ap.add_argument("--out")
    a = ap.parse_args()
    im = load(a.image, a.crop)
    if a.mode == "outline":
        pts, _ = outline(im, a.thresh)
    else:
        pts, _ = lines(im, a)
    # scale to 0..1000 first so --tol means the same on every picture
    q = finish(pts, 0.001)
    q = finish(q.astype(float), a.tol)
    if a.png:
        preview(q, a.png)
    s = json.dumps(q.flatten().tolist(), separators=(",", ":"))
    if a.out:
        open(a.out, "w").write(s)
    print(f"{len(q)} points", file=sys.stderr)
