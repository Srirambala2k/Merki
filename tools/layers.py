"""Step 2: split each scene into a clean background plate + separate transparent cut-out components.
Outputs public/art/*.webp and public/art/layers.json (positions in % of the 1920x1080 frame)."""
import json, os, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

NAMES = ['hero', 'about', 'services', 'work', 'philosophy', 'process', 'clients', 'contact']
LIFT = {0: 0.14}            # brighten the hero plate so dark ink reads (matches the PDF's pale grey)
MIN_AREA = 250             # ignore specks
os.makedirs('public/art', exist_ok=True)

def push_pull_fill(img, hole, scale=4):
    """Fill `hole` with a harmonic (Laplace) interpolation of the surrounding pixels, solved at 1/4 resolution.
    Unlike a plain blur it follows gradients (sky glow, horizon) coming in from the edge of the hole."""
    from scipy import sparse
    from scipy.sparse.linalg import splu
    h, w = hole.shape
    sh, sw = h // scale, w // scale
    small = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize((sw, sh), Image.BOX), dtype=np.float32) / 255.
    hm = np.asarray(Image.fromarray((hole * 255).astype(np.uint8)).resize((sw, sh), Image.BILINEAR)) > 10
    idx = -np.ones((sh, sw), np.int64); n = int(hm.sum()); idx[hm] = np.arange(n)
    ys, xs = np.where(hm)
    rows, cols, vals = [], [], []
    rhs = np.zeros((n, 3), np.float64)
    diag = np.zeros(n, np.float64)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = ys + dy, xs + dx
        ok = (ny >= 0) & (ny < sh) & (nx >= 0) & (nx < sw)
        diag += ok
        nyc, nxc = np.clip(ny, 0, sh - 1), np.clip(nx, 0, sw - 1)
        nid = idx[nyc, nxc]
        unk = ok & (nid >= 0)
        rows.append(np.arange(n)[unk]); cols.append(nid[unk]); vals.append(-np.ones(unk.sum(), np.float64))
        known = ok & (nid < 0)
        rhs[known] += small[nyc[known], nxc[known]]
    rows.append(np.arange(n)); cols.append(np.arange(n)); vals.append(diag)
    A = sparse.csc_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n))
    lu = splu(A)
    sol = np.stack([lu.solve(rhs[:, c].astype(np.float64)) for c in range(3)], 1).astype(np.float32)
    filled = small.copy(); filled[hm] = sol
    up = np.asarray(Image.fromarray((np.clip(filled, 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.
    return up

manifest = []
for i, n in enumerate(NAMES):
    frame = np.asarray(Image.open(f'tools/work/{i}_{n}.png').convert('RGB'), dtype=np.float32) / 255.
    alpha = np.asarray(Image.open(f'tools/work/{i}_{n}_alpha.png').convert('L'), dtype=np.float32) / 255.
    H, W = alpha.shape

    # sharpen the matte: trim halo, keep soft edge
    a = np.clip((alpha - .18) / .62, 0, 1)
    a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(.8)), dtype=np.float32) / 255.

    # components
    binm = ndi.binary_closing(a > .5, iterations=6)
    lab, k = ndi.label(binm)
    areas = ndi.sum(binm, lab, range(1, k + 1))
    comps = [(j + 1, areas[j]) for j in range(k) if areas[j] >= MIN_AREA]
    comps.sort(key=lambda c: -c[1])

    # plate: remove every component + generator sparkle, then fill from surroundings
    union = ndi.binary_dilation(a > .04, iterations=26)
    spark = np.zeros_like(union); spark[int(H * .795):int(H * .865), int(W * .882):int(W * .93)] = True
    hole = union | spark
    plate = push_pull_fill(frame, hole)
    # keep original pixels where not in hole, feather the seam
    soft = np.asarray(Image.fromarray((hole * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(7)), dtype=np.float32)[..., None] / 255.
    soft = np.where(spark[..., None], np.maximum(soft, 1.), soft)
    plate = frame * (1 - soft) + plate * soft
    if i in LIFT: plate = np.clip(plate * (1 + LIFT[i]) + LIFT[i] * .35, 0, 1)
    Image.fromarray((plate * 255).astype(np.uint8)).save(f'public/art/{i}_plate.webp', quality=82, method=6)

    layers = []
    amax = max(c[1] for c in comps) if comps else 1
    for ci, (lid, area) in enumerate(comps):
        region = ndi.binary_dilation(lab == lid, iterations=10)
        ca = a * region
        ys, xs = np.where(ca > .02)
        y0, y1, x0, x1 = max(ys.min() - 4, 0), min(ys.max() + 5, H), max(xs.min() - 4, 0), min(xs.max() + 5, W)
        rgba = np.dstack([frame, ca])[y0:y1, x0:x1]
        fn = f'{i}_{ci}.webp'
        Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA').save(f'public/art/{fn}', quality=90, method=6, exact=True)
        layers.append(dict(file=fn, x=round(x0 / W * 100, 3), y=round(y0 / H * 100, 3), w=round((x1 - x0) / W * 100, 3), h=round((y1 - y0) / H * 100, 3),
                           area=round(float(area / amax), 3), cx=round((x0 + x1) / 2 / W, 3), cy=round((y0 + y1) / 2 / H, 3)))
    manifest.append(dict(name=n, plate=f'{i}_plate.webp', layers=layers))
    print(i, n, [(l['file'], l['area'], f"{l['w']:.0f}x{l['h']:.0f}") for l in layers])
json.dump(manifest, open('public/art/layers.json', 'w'), indent=1)
