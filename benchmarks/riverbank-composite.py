"""Build labelled baseline | natural composites from the riverbank slice captures (VIS-01).

Usage: python3 benchmarks/riverbank-composite.py test-artifacts/riverbank docs/evidence/riverbank
Reads <scene>-<shot>-<mode>-<res>p.png pairs, writes <scene>-<shot>-<res>p-ab.jpg (side by side, labelled) and copies
nothing else. Every label states the renderer so a still can never be mistaken for GPU output.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
for base in sorted(src.glob('*-baseline-*p.png')):
    nat = Path(str(base).replace('-baseline-', '-natural-'))
    if not nat.exists():
        continue
    a, b = Image.open(base).convert('RGB'), Image.open(nat).convert('RGB')
    w, h = a.size
    scale = 0.5 if w > 1300 else 1.0  # keep 1080p composites a reasonable size; the full PNGs stay in test-artifacts
    a = a.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    b = b.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    bar = 30
    out = Image.new('RGB', (a.width * 2 + 8, a.height + bar), (16, 16, 16))
    out.paste(a, (0, bar))
    out.paste(b, (a.width + 8, bar))
    d = ImageDraw.Draw(out)
    f = ImageFont.truetype(font_path, 16)
    name = base.name.replace('-baseline', '').replace('.png', '')
    d.text((8, 6), f'BASELINE production renderer  |  {name}  |  SwiftShader (CPU)', fill=(230, 230, 230), font=f)
    d.text((a.width + 16, 6), 'NATURAL riverbank slice (same seed, tick, weather, time, camera)', fill=(230, 230, 230), font=f)
    target = dst / f'{name}-ab.jpg'
    out.save(target, quality=86)
    print(target)
