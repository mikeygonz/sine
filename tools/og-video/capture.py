# Sine's share video: the site's own epicycles (app.js drawing code, via patch.py) write "sine"
# stroke by stroke, with the site's wave below. Forward time only. Write, hold, the tail erases
# forward toward the pen, the pen glides home along the closing chord, and the loop restarts blank.
# Headless Chrome at 600x315 CSS px, DPR 2 -> 1200x630, on a fixed clock.
import json, math, os, sys, threading, functools, http.server, subprocess, tempfile
from playwright.sync_api import sync_playwright
REPO, OUT = os.path.abspath(sys.argv[1]), sys.argv[2]
ONLY = [int(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else None
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from path import path
FPS = 60
NWAVES = int(os.environ.get('NWAVES', 255))
ARMS = int(os.environ.get('ARMS', 10))
LAY = dict(R=176, cx=300, cy=118, w0=127, w1=471, wy=258, A=64, side=False)
# seconds: rest, write, hold, erase, return, rest
SEG = [0.15, 2.10, 0.90, 0.70, 0.60, 0.15]
T = sum(SEG); NF = int(round(T * FPS))

P, D = path(60)
word = [(x, -y) for x, y in P]                     # canvas y points down
dot = [D[0], -D[1]]
s = [0.0]
for a, b in zip(word, word[1:]): s.append(s[-1] + math.dist(a, b))
LW = s[-1]; chord = math.dist(word[-1], word[0])
U_E = LW / (LW + chord)                            # where the word ends on the closed curve
# pen slows into turns: time cost per unit length grows with turning
def turn(i):
    a = math.atan2(word[i][1]-word[i-1][1], word[i][0]-word[i-1][0])
    b = math.atan2(word[i+1][1]-word[i][1], word[i+1][0]-word[i][0])
    return abs((b - a + math.pi) % (2*math.pi) - math.pi)
k = [0.0] + [turn(i) for i in range(1, len(word)-1)] + [0.0]
ks = [sum(k[max(0, i-6):i+7]) / 13 for i in range(len(k))]
cost = [0.0]
for i in range(1, len(word)):
    cost.append(cost[-1] + (s[i]-s[i-1]) * (1 + 14.0 * ks[i] / max(1e-9, (s[i]-s[i-1]))))
cost = [c / cost[-1] for c in cost]
def interp(x, xs, ys):
    lo, hi = 0, len(xs) - 1
    while hi - lo > 1:
        m = (lo + hi) // 2
        if xs[m] <= x: lo = m
        else: hi = m
    f = (x - xs[lo]) / max(1e-12, xs[hi] - xs[lo])
    return ys[lo] + (ys[hi] - ys[lo]) * f
itop = min(range(int(len(word)*0.25), int(len(word)*0.45)), key=lambda i: word[i][1])
U_I = s[itop] / (LW + chord)
def ease(u): return 0.5 - 0.5 * math.cos(math.pi * max(0, min(1, u)))
def write_ease(u): return u - math.sin(2*math.pi*u) / (2*math.pi)  # gentle start and finish

def state(sec):
    b = [sum(SEG[:i]) for i in range(len(SEG) + 1)]
    if sec < b[1]:
        return dict(t=0.0, tail=0.0, fade=0.0, len=0.0, dotA=0.0)
    if sec < b[2]:
        p = write_ease((sec - b[1]) / SEG[1])
        u = interp(p, cost, s) / (LW + chord)
        return dict(t=u, tail=u, fade=0.0, len=p, dotA=min(1, max(0, (u - U_I) / 0.01)))
    if sec < b[3]:
        return dict(t=U_E, tail=U_E, fade=0.0, len=1.0, dotA=1.0)
    if sec < b[4]:
        e = ease((sec - b[3]) / SEG[3])
        tail = U_E * (1 - e)
        start = U_E - tail
        return dict(t=U_E, tail=tail, fade=min(1, e / 0.3), len=1 - e,
                    dotA=min(1, max(0, (U_I - start) / 0.01)))
    if sec < b[5]:
        e = ease((sec - b[4]) / SEG[4])
        return dict(t=U_E + (1 - U_E) * e, tail=0.0, fade=1.0, len=0.0, dotA=0.0)
    return dict(t=0.0, tail=0.0, fade=0.0, len=0.0, dotA=0.0)

work = tempfile.mkdtemp(); hooked = os.path.join(work, 'app.og.js')
subprocess.run([sys.executable, os.path.join(HERE, 'patch.py'), os.path.join(REPO, 'app.js'), hooked], check=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=REPO))
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'),
                           args=['--disable-gpu', '--force-color-profile=srgb'])
    pg = br.new_page(viewport={'width': 600, 'height': 315}, device_scale_factor=2)
    pg.add_init_script("window.requestAnimationFrame = () => 0; window.__og = { ghost: false, arms: %d, hist: true };" % ARMS)
    pg.route('**/app.js', lambda r: r.fulfill(path=hooked, content_type='text/javascript'))
    pg.goto('http://127.0.0.1:%d/' % srv.server_address[1])
    pg.add_style_tag(content='header,.bar,.gh{display:none!important}')
    pg.wait_for_function('!!(window.__og && window.__og.setup)')
    pg.evaluate('(u) => { __og.ue = u; }', U_E)
    info = pg.evaluate('([p,n,l,d]) => __og.setup(p,n,l,d)', [word, NWAVES, LAY, dot])
    print('engine', info, 'u_end %.3f u_i %.3f' % (U_E, U_I), file=sys.stderr)
    for f in (ONLY or range(NF)):
        pg.evaluate('(s) => __og.render(s)', state(f / FPS))
        pg.screenshot(path=os.path.join(OUT, 'f%04d.png' % f))
    br.close()
print('frames', NF, 'seconds', T, file=sys.stderr)
