# Sine's share image: one still from the share video's engine (tools/og-video/patch.py), the
# word "sine" fully written by the site's circles with its wave below, at the hold pose.
# Rendered at a smaller CSS size and a higher pixel ratio so strokes stay readable as a thumbnail.
# usage: still.py REPO OUT.png '{"W":400,"R":100,...}'
import json, math, os, sys, threading, functools, http.server, subprocess, tempfile
from playwright.sync_api import sync_playwright
REPO, OUT = os.path.abspath(sys.argv[1]), sys.argv[2]
C = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.join(HERE, '..', 'og-video')
sys.path.insert(0, VID)
from path import path
W = C.get('W', 400); H = W * 630 // 1200; DPR = 1200 / W
LAY = dict(R=100, cx=W/2, cy=H*0.40, w0=W*0.25, w1=W*0.75, wy=H*0.80, A=H*0.12, side=False)
LAY.update({k: C[k] for k in ('R', 'cx', 'cy', 'w0', 'w1', 'wy', 'A') if k in C})
P, D = path(60)
word = [(x, -y) for x, y in P]
dot = [D[0], -D[1]]
LW = sum(math.dist(a, b) for a, b in zip(word, word[1:]))
U_E = LW / (LW + math.dist(word[-1], word[0]))
hist = C.get('wave', True)
if not hist: LAY.update(w0=0, w1=0)
work = tempfile.mkdtemp(); hooked = os.path.join(work, 'app.og.js')
subprocess.run([sys.executable, os.path.join(VID, 'patch.py'), os.path.join(REPO, 'app.js'), hooked], check=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=REPO))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'),
                           args=['--disable-gpu', '--force-color-profile=srgb'])
    pg = br.new_page(viewport={'width': W, 'height': H}, device_scale_factor=DPR,
                     reduced_motion='reduce' if C.get('flat') else 'no-preference')
    pg.add_init_script("window.requestAnimationFrame = () => 0; window.__og = { ghost: false, arms: %d, hist: %s, dpr: %r, still: true, armA: %r };"
                       % (C.get('arms', 10), 'true' if hist else 'false', DPR, C.get('armA', 0.38)))
    pg.route('**/app.js', lambda r: r.fulfill(path=hooked, content_type='text/javascript'))
    pg.goto('http://127.0.0.1:%d/' % srv.server_address[1])
    pg.add_style_tag(content='header,.bar,.gh{display:none!important}')
    pg.wait_for_function('!!(window.__og && window.__og.setup)')
    pg.evaluate('(u) => { __og.ue = u; }', U_E)
    pg.evaluate('([p,n,l,d]) => __og.setup(p,n,l,d)', [word, C.get('n', 255), LAY, dot])
    if C.get('sine'): print('sine', pg.evaluate('() => __og.fitSine()'), file=sys.stderr)
    pg.evaluate('(s) => __og.render(s)', dict(t=U_E, tail=U_E, fade=C.get('fade', 0.0), len=1.0, dotA=1.0))
    pg.screenshot(path=OUT)
    br.close()
