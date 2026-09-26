r"""Give the G502 LIGHTSPEED model recolourable LED zones.

The exported model lights its LEDs with blue emissive textures, and paints
the same blue into the base colour underneath. A blue emissive texture can
only be dimmed or shifted, not recoloured, so this turns each zone into a
greyscale emissive mask -- the page then lights it in any colour through the
emissive factor, or switches it off -- and paints the lit area of the base
colour neutral, so a zone that is off looks unlit rather than blue:

- Material2 (shell): the G logo, the ``logo`` zone. Its emissive texture also
  glows the "G502 LIGHTSPEED" print and a dark patch that are not lights on
  the real mouse, so only the logo's area is kept.
- Material4 (left buttons): the three DPI stripes, the ``primary`` zone.

The emissive factor defaults to Logitech blue, so the file looks as before.

It also writes two extra masks beside the model, ``<model>-bars-1.png`` and
``<model>-bars-2.png``: the DPI stripes mask with only the first one or two
stripes lit, so the page can show the battery level on them.

Run once, on the original export as downloaded (it is not kept in the repo):

    uv run --no-project --with pygltflib --with pillow --with numpy \
        scripts/g502_led_masks.py original.glb \
        src/frontend/public/models/g502-lightspeed-black-stalker.glb
"""
import io
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image
from pygltflib import GLTF2

#: Material name -> the area of its texture holding the LED, as fractions
#: (x0, x1, y0, y1), or None for the whole texture.
ZONES = {
    "Material2": (0.45, 0.65, 0.83, 1.0),
    "Material4": None,
}
#: The material whose mask holds the three DPI stripes.
BARS_MATERIAL = "Material4"
#: Bars fill from the bottom stripe up, like a gauge. On the model the bottom
#: stripe is the smallest in the texture (its UVs are packed tighter).
BARS_SMALLEST_FIRST = True
LOGITECH_BLUE = (56 / 255, 150 / 255, 209 / 255)
UNLIT = np.array([34, 34, 36], dtype=float)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def decode(blob, view):
    start = view.byteOffset or 0
    return Image.open(io.BytesIO(blob[start:start + view.byteLength])).convert("RGB")


def encode(array):
    buf = io.BytesIO()
    Image.fromarray(array.astype(np.uint8), "RGB").save(buf, "PNG", optimize=True)
    return buf.getvalue()


def texture_image(gltf, ref):
    return gltf.images[gltf.textures[ref.index].source]


def components(mask):
    """Label the separate shapes of a mask (8-connected), largest last."""
    on = mask > 0
    h, w = on.shape
    label = np.zeros(on.shape, dtype=int)
    count = 0
    for y, x in zip(*np.nonzero(on), strict=True):
        if label[y, x]:
            continue
        count += 1
        label[y, x] = count
        queue = deque([(y, x)])
        while queue:
            cy, cx = queue.popleft()
            for ny in (cy - 1, cy, cy + 1):
                for nx in (cx - 1, cx, cx + 1):
                    if 0 <= ny < h and 0 <= nx < w and on[ny, nx] and not label[ny, nx]:
                        label[ny, nx] = count
                        queue.append((ny, nx))
    sizes = {i: int((label == i).sum()) for i in range(1, count + 1)}
    return label, sorted(sizes, key=sizes.get)


def write_bar_masks(mask, dst):
    """The stripes mask with only the first one or two stripes lit."""
    label, by_size = components(mask)
    # The three largest shapes are the stripes; anything else is a faint speck.
    stripes = by_size[-3:]
    if len(stripes) != 3:
        raise SystemExit(f"expected 3 DPI stripes, found {len(by_size)} shapes")
    order = stripes if BARS_SMALLEST_FIRST else stripes[::-1]
    stem = Path(dst).with_suffix("")
    for bars in (1, 2):
        lit = np.isin(label, order[:bars])
        out = f"{stem}-bars-{bars}.png"
        Image.fromarray((mask * lit * 255).astype(np.uint8), "L").save(out, optimize=True)
        print("written", out)


src, dst = sys.argv[1], sys.argv[2]
gltf = GLTF2().load(src)
blob = gltf.binary_blob()
replaced = {}  # bufferView index -> new bytes

for material in gltf.materials:
    if material.name not in ZONES:
        continue
    area = ZONES[material.name]
    emissive_image = texture_image(gltf, material.emissiveTexture)
    base_image = texture_image(gltf, material.pbrMetallicRoughness.baseColorTexture)

    emissive = np.asarray(decode(blob, gltf.bufferViews[emissive_image.bufferView])).astype(float)
    h, w, _ = emissive.shape
    # The glow's brightest channel, normalised: 1 where the LED is fully lit.
    mask = np.clip(emissive.max(axis=2) / 180, 0, 1)
    if area is not None:
        x0, x1, y0, y1 = area
        keep = np.zeros_like(mask)
        keep[int(h * y0):int(h * y1), int(w * x0):int(w * x1)] = 1
        mask *= keep
    print(material.name, "lit pixels:", int((mask > 0.5).sum()))
    if material.name == BARS_MATERIAL:
        write_bar_masks(mask, dst)

    base = np.asarray(decode(blob, gltf.bufferViews[base_image.bufferView])).astype(float)
    if base.shape[:2] != mask.shape:
        base_mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize(
            (base.shape[1], base.shape[0]))).astype(float) / 255
    else:
        base_mask = mask
    base = base * (1 - base_mask[..., None]) + UNLIT * base_mask[..., None]

    replaced[emissive_image.bufferView] = encode(np.repeat((mask * 255)[..., None], 3, axis=2))
    replaced[base_image.bufferView] = encode(base)
    material.emissiveFactor = [srgb_to_linear(c) for c in LOGITECH_BLUE]

# Rebuild the binary buffer with the new images, every other view unchanged.
out = bytearray()
for i, view in enumerate(gltf.bufferViews):
    start = view.byteOffset or 0
    data = replaced.get(i, blob[start:start + view.byteLength])
    while len(out) % 4:
        out.append(0)
    view.byteOffset = len(out)
    view.byteLength = len(data)
    out += data
gltf.buffers[0].byteLength = len(out)
gltf.set_binary_blob(bytes(out))
gltf.save_binary(dst)
print("written", dst)
