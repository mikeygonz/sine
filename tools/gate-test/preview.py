"""Checks a deployed Sine preview over HTTP and in a headless browser.

  python3 tools/gate-test/preview.py "<preview url, with its share link if protected>" [--shots DIR]

What it checks on the deployment:
  1. GET /api/draw answers with the free tries left, and a fresh visitor has 3
  2. a script that posts to /api/draw without BotID's browser signals is blocked
  3. an automated headless browser using the real page is blocked by BotID too, and the page says so
  4. with the server's count shown as 0 (GET is stubbed in the browser, because this machine's IP changes on
     every connection, so no real IP can be held at 0), the page opens the key panel on load and the prompt box
     does not move when it opens or closes, at 390px and 1280px. Screenshots go to --shots.
  5. an own key skips the bot check and reaches the gateway; a malformed key is refused before any call; a key
     the gateway rejects is reported, cleared from the tab, never echoed and never put in localStorage
Not covered here: a person's own browser passing BotID and drawing 3 times (headless browsers are blocked on
purpose, so that is a by-hand check), and the 3-try counting itself, which local.mjs proves against real Redis.
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright


def read_url(a):
    # "@file": a file holding the URL, or a saved get_access_to_vercel_url result
    if not a.startswith("@"):
        return a
    t = open(a[1:]).read()
    m = re.search(r'"shareableUrl":\s*"([^"]+)"', t)
    return m.group(1) if m else t.strip()


args = [a for a in sys.argv[1:] if not a.startswith("--")]
opt = lambda n, d: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d
URL = read_url(args[0])
SHOTS = opt("--shots", "/workspace/sine-gate-shots")
os.makedirs(SHOTS, exist_ok=True)
FAKE_KEY = "vck_" + "Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp"  # well formed, not a real key
results = []


def check(name, cond, detail=""):
    results.append(bool(cond))
    print(("pass " if cond else "FAIL ") + name + (f"  [{detail}]" if not cond else ""))


def api_get(page):
    return page.evaluate("fetch('/api/draw').then(r => r.json())")


def rect(page, sel):
    return page.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }", sel)


def launch(p):
    # every call is a brand new profile: no cookies, no storage
    return p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox"])


def post(page, prompt, key=None):
    return page.evaluate(
        """async ([prompt, key]) => {
          const h = {'content-type': 'application/json'}; if (key) h['x-gateway-key'] = key;
          const r = await fetch('/api/draw', {method: 'POST', headers: h, body: JSON.stringify({prompt})});
          const t = await r.text(); let code = null; try { code = JSON.parse(t).code } catch (e) {}
          return [r.status, code, t.includes(key || '\\u0000')];
        }""",
        [prompt, key],
    )


STUB = json.dumps({"ok": True, "free": {"left": 0, "limit": 3}})


def stub_get(page):
    # answer GET /api/draw as if this IP had used its 3 tries; everything else goes to the real deployment
    page.route("**/api/draw", lambda r: r.fulfill(status=200, content_type="application/json", body=STUB) if r.request.method == "GET" else r.continue_())


with sync_playwright() as p:
    b1 = launch(p)
    ctx = b1.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(URL, wait_until="load")
    page.wait_for_selector("#ask:not([hidden])", timeout=15000)
    g = api_get(page)
    check("GET reports 3 free tries for a fresh visitor", g.get("ok") is True and g["free"] == {"left": 3, "limit": 3}, g)
    check("the key panel is closed while tries are left", not page.is_visible("#key"))

    base = URL.split("?")[0].rstrip("/")
    r = ctx.request.post(base + "/api/draw", data=json.dumps({"prompt": "a cat"}), headers={"content-type": "application/json"})
    code = r.json().get("code") if "json" in r.headers.get("content-type", "") else None
    check("a scripted POST without BotID signals is blocked", r.status == 403 and code == "bot", f"{r.status} {code}")

    page.fill("#q", "a cat")
    with page.expect_response(lambda r: "/api/draw" in r.url and r.request.method == "POST", timeout=30000) as ri:
        page.press("#q", "Enter")
    st = ri.value.status
    try:
        c = ri.value.json().get("code")
    except Exception:
        c = None
    page.wait_for_timeout(500)
    check("a headless browser using the real page is blocked by BotID", (st, c) == (403, "bot"), f"{st} {c}")
    check("the page says so and keeps the prompt", page.inner_text("#status").strip() == "blocked" and page.input_value("#q") == "a cat", page.inner_text("#status"))

    # the out-of-tries screen, 390px
    page3 = b1.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True).new_page()
    stub_get(page3)
    page3.goto(URL, wait_until="load")
    page3.wait_for_selector("#key:not([hidden])", timeout=8000)
    check("the key panel opens on load when the server says 0 left", "3 free tries" in page3.inner_text("#key-t"), page3.inner_text("#key-t"))
    check("the count shows in the prompt row", page3.inner_text("#status").strip() == "0 free", page3.inner_text("#status"))
    open390 = rect(page3, "#q")
    page3.wait_for_timeout(400)
    page3.screenshot(path=f"{SHOTS}/out-of-tries-390.png")
    page3.click("#key-x")
    page3.wait_for_timeout(300)
    check("the key panel closes with its x", not page3.is_visible("#key"))
    check("the prompt box did not move at 390px (open vs closed)", rect(page3, "#q") == open390 and page3.is_visible("#q"), f"{open390} {rect(page3, '#q')}")

    # 1280px
    b2 = launch(p)
    page2 = b2.new_context(viewport={"width": 1280, "height": 800}).new_page()
    stub_get(page2)
    page2.goto(URL, wait_until="load")
    page2.wait_for_selector("#key:not([hidden])", timeout=8000)
    open1280 = rect(page2, "#q")
    page2.wait_for_timeout(400)
    page2.screenshot(path=f"{SHOTS}/out-of-tries-1280.png")
    page2.click("#key-x")
    page2.wait_for_timeout(300)
    check("the prompt box did not move at 1280px (open vs closed)", rect(page2, "#q") == open1280, f"{open1280} {rect(page2, '#q')}")

    # own key
    st, code, echoed = post(page2, "a cat", FAKE_KEY)
    check("an own key skips the bot check and reaches the gateway, which rejects this made-up one", (st, code) == (401, "key"), f"{st} {code}")
    check("the key is not echoed in the response", not echoed)
    check("a malformed key is refused before any call", post(page2, "a cat", "vck_short")[:2] == [400, "key"])
    page2.reload(wait_until="load")
    page2.wait_for_selector("#key:not([hidden])", timeout=8000)
    page2.fill("#q", "a cat")
    page2.fill("#gk", FAKE_KEY)
    page2.dispatch_event("#gk", "change")  # a paste does the same
    page2.wait_for_function("() => document.getElementById('key-t').textContent.includes('did not work')", timeout=20000)
    check("pasting a rejected key shows a plain note", "did not work" in page2.inner_text("#key-t"), page2.inner_text("#key-t"))
    check("the rejected key is gone from sessionStorage", page2.evaluate("sessionStorage.getItem('sine-gateway-key')") is None)
    check("no key in localStorage", FAKE_KEY not in json.dumps(page2.evaluate("Object.fromEntries(Object.entries(localStorage))")))
    check("the prompt box is still there, with its text", page2.is_visible("#q") and page2.input_value("#q") == "a cat")
    page2.screenshot(path=f"{SHOTS}/key-rejected-1280.png")
    b2.close()
    b1.close()

bad = results.count(False)
print(f"\n{len(results) - bad}/{len(results)} passed")
sys.exit(1 if bad else 0)
