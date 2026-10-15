#!/usr/bin/env python3
"""친구가 카메라 쪽으로 걸어오는 짧은 영상 → 배경 제거된 걷기 프레임 (game/assets/walk/).

사용법:
  pip install pillow pillow-heif rembg onnxruntime
  python3 game/tools/make_walk.py walk.mp4 --start 1.0 --end 3.5 --fps 12

영상은 3~5초, 정면에서 카메라 쪽으로 걸어오는 모습, 배경은 단순할수록 좋습니다.
프레임마다 사람만 남기고 키를 같은 높이로 맞춰 저장하며, 게임은 walk.json 이 있으면 리그 대신 이 프레임을 씁니다.
"""
import argparse, json, os, subprocess, sys, tempfile
from PIL import Image, ImageFilter
ap = argparse.ArgumentParser(); ap.add_argument("video"); ap.add_argument("--start", type=float, default=0); ap.add_argument("--end", type=float, default=None)
ap.add_argument("--fps", type=int, default=12); ap.add_argument("--height", type=int, default=900); ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "assets", "walk"))
a = ap.parse_args()
from rembg import remove, new_session
sess = new_session("u2net_human_seg")
os.makedirs(a.out, exist_ok=True)
with tempfile.TemporaryDirectory() as td:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(a.start)] + (["-to", str(a.end)] if a.end else []) + ["-i", a.video, "-vf", f"fps={a.fps}", os.path.join(td, "f_%03d.png")]
    subprocess.run(cmd, check=True)
    files = sorted(f for f in os.listdir(td) if f.endswith(".png")); frames = []
    for i, f in enumerate(files):
        im = Image.open(os.path.join(td, f)).convert("RGB")
        if im.height > 1400: im = im.resize((int(im.width * 1400 / im.height), 1400), Image.LANCZOS)
        o = remove(im, session=sess)
        bb = o.split()[3].point(lambda v: 255 if v > 20 else 0).getbbox()
        if not bb: continue
        o = o.crop(bb); al = o.split()[3].filter(ImageFilter.GaussianBlur(0.8)); o.putalpha(al)
        o = o.resize((int(o.width * a.height / o.height), a.height), Image.LANCZOS)   # 키를 같은 높이로
        name = f"walk_{len(frames):03d}.png"; o.save(os.path.join(a.out, name)); frames.append(name); print(name, o.size)
json.dump({"fps": a.fps, "height": 1.82, "frames": frames}, open(os.path.join(a.out, "walk.json"), "w"), indent=1)
print("done:", len(frames), "frames →", a.out)
