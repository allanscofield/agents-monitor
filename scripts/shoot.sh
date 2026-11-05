#!/bin/bash
# Uso: shoot.sh <arquivo.svg> <prefixo>  ->  <prefixo>.png com o SVG inteiro.
# O Quick Look só rasteriza quadrado, então o SVG é fatiado em quadrados da
# largura dele, rasterizado e costurado de volta (precisa do Pillow).
set -euo pipefail
svg="$1"
out="$2"
dir=$(cd "$(dirname "$out")" && pwd)
base=$(basename "$out")
rm -f "$dir/$base"-*.svg "$dir/$base"-*.svg.png
python3 - "$svg" "$dir/$base" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
s = open(src).read()
W, H = map(int, re.search(r'viewBox="0 0 (\d+) (\d+)"', s).groups())
y = i = 0
while y < H:
    tile = s.replace(f'viewBox="0 0 {W} {H}" width="{W}" height="{H}"', f'viewBox="0 {y} {W} {W}" width="{W}" height="{W}"', 1)
    open(f'{out}-{i}.svg', 'w').write(tile)
    y += W
    i += 1
PY
(cd "$dir" && qlmanage -t -s 1400 -o "$dir" "$base"-*.svg >/dev/null 2>&1)
python3 - "$svg" "$dir/$base" <<'PY'
import glob, re, sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
W, H = map(int, re.search(r'viewBox="0 0 (\d+) (\d+)"', open(src).read()).groups())
files = sorted(glob.glob(out + '-*.svg.png'), key=lambda f: int(re.search(r'-(\d+)\.svg\.png$', f).group(1)))
tiles = [Image.open(f) for f in files]
w = tiles[0].width
sheet = Image.new('RGB', (w, w * len(tiles)))
for i, tile in enumerate(tiles):
    sheet.paste(tile, (0, i * w))
sheet.crop((0, 0, w, int(H * w / W))).save(out + '.png')
print(out + '.png')
PY
rm -f "$dir/$base"-*.svg "$dir/$base"-*.svg.png
