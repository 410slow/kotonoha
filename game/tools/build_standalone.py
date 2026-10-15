#!/usr/bin/env python3
"""game/ 전체를 더블클릭으로 열리는 HTML 파일 하나로 묶는다 (사진·소리·3D 엔진 모두 내장).
사용법: python3 game/tools/build_standalone.py [출력경로]
"""
import base64, json, os, re, sys, mimetypes
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "dist", "균승이개패기.html")
def read(p, mode="r"):
    with open(os.path.join(root, p), mode, **({} if "b" in mode else {"encoding": "utf-8"})) as f: return f.read()
def data_uri(p):
    mt = mimetypes.guess_type(p)[0] or "application/octet-stream"
    return f"data:{mt};base64," + base64.b64encode(read(p, "rb")).decode()
assets = {}
for d in ("assets", "assets/walk", "voice"):
    dp = os.path.join(root, d)
    if not os.path.isdir(dp): continue
    for f in sorted(os.listdir(dp)):
        rel = f"{d}/{f}"
        if f.endswith((".png", ".jpg", ".mp3", ".m4a")): assets[rel] = data_uri(rel)
        elif f.endswith(".json"): assets[rel] = json.loads(read(rel))
html = read("index.html")
html = re.sub(r'src="\./assets/([^"]+)"', lambda m: f'src="{assets.get("assets/" + m.group(1), "./assets/" + m.group(1))}"', html)
html = html.replace('<script src="./vendor/three.min.js"></script>', "<script>" + read("vendor/three.min.js") + "</script>")
html = html.replace('<script src="./firebase-config.js" onerror="void 0"></script>', "")
html = html.replace('<script src="./game.js"></script>', "<script>window.ENGMA_ASSETS=" + json.dumps(assets, ensure_ascii=False) + ";</script>\n<script>" + read("game.js") + "</script>")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f: f.write(html)
print("wrote", out, round(os.path.getsize(out) / 1e6, 1), "MB", "assets:", len(assets))
