"""Make the white background of product photos transparent, so they sit on any theme.

Only the white connected to the edges of the picture goes: white parts of the product itself
(a logo, a highlight) are kept. The outline is anti-aliased from how white each edge pixel is,
and grey drop shadows become translucent black ones. Run it only on photos that still have a
white background (micro2-1 and qc45 were transparent already):

    python scripts/transparent_photos.py public/devices/micro2-{2,3,4,5,6}.webp

Needs Pillow, numpy and scipy. Files are rewritten in place (lossless WebP with alpha);
the originals are in git history.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

#: A pixel whose darkest channel is at least this is background-white.
WHITE = 238
#: Below this the edge pixel is fully opaque; between it and WHITE it fades.
SOLID = 200
#: An island with no pixel darker than this is a drop shadow, not part of the product.
SHADOW = 140


def process(path: Path) -> None:
    image = Image.open(path).convert("RGBA")
    rgba = np.asarray(image).astype(np.float32)
    lightness = rgba[..., :3].min(axis=2)

    # White regions that touch the border are the background.
    labels, _ = ndimage.label(lightness >= WHITE)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    background = np.isin(labels, border[border > 0])

    alpha = np.where(background, 0.0, 255.0)
    rgb = rgba[..., :3].copy()

    # Drop shadows: separate light-grey islands with nothing dark in them. They become black at
    # the opacity that gives the same grey over white, so they read as shadows on any theme.
    objects, count = ndimage.label(~background)
    darkest = ndimage.minimum(lightness, objects, index=np.arange(1, count + 1))
    shadow_ids = np.flatnonzero(np.asarray(darkest) >= SHADOW) + 1
    shadow = np.isin(objects, shadow_ids)
    near_shadow = ndimage.binary_dilation(shadow, iterations=2) & background
    soft = shadow | near_shadow
    alpha[soft] = 255 - lightness[soft]
    rgb[soft] = 0

    # Anti-alias the product's outline: pixels just outside the background fade with their whiteness.
    edge = ndimage.binary_dilation(background, iterations=2) & ~background & ~shadow
    fade = np.clip((WHITE - lightness) / (WHITE - SOLID), 0, 1) * 255
    alpha[edge] = np.minimum(alpha[edge], fade[edge])

    # Remove the white the edge pixels were blended with, so no light fringe shows on dark themes.
    a = np.clip(alpha / 255, 1e-3, 1)[..., None]
    rgb = np.where(edge[..., None], np.clip((rgb - 255 * (1 - a)) / a, 0, 255), rgb)

    out = np.dstack([rgb, alpha]).round().astype(np.uint8)
    Image.fromarray(out, "RGBA").save(path, "WEBP", lossless=True, quality=100, method=6)
    print(f"{path}: {background.mean():.0%} background removed")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for name in sys.argv[1:]:
        process(Path(name))
