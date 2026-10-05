"""Step 3: build a LIVE background video per scene with the subject(s) removed.
For every frame of the scene's clean window: matte the subject (ISNet), then fill the removed region with a harmonic
interpolation of its surroundings. The removed region is the union over the whole clip so the fill never flickers.
The cleaned frames are slowed with frame interpolation and played forward+backward (seamless loop).
Outputs public/bg/{i}.mp4 (+ {i}.jpg poster)."""
import os, subprocess, shutil, time, numpy as np, onnxruntime as ort
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
from scipy import sparse
from scipy.sparse.linalg import splu

NAMES = ['hero', 'about', 'services', 'work', 'philosophy', 'process', 'clients', 'contact']
# scene -> (segment second, window start, window end) inside video/hero_video.mp4 (same windows used for the stills)
WIN = [(1, .04, .96), (5, .30, .72), (2, .04, .96), (0, .04, .96), (6, .40, .72), (4, .04, .50), (7, .50, .98), (3, .04, .90)]
LIFT = {0: 0.14}
SRC = 'video/hero_video.mp4'
WORK = 'tools/work/bg'
os.makedirs('public/bg', exist_ok=True)
sess = ort.InferenceSession('tools/models/isnet.onnx', providers=['CPUExecutionProvider'])


def matte(im):
    x = np.asarray(im.resize((1024, 1024), Image.BILINEAR), dtype=np.float32) / 255.
    x = (x - [0.485, 0.456, 0.406]).transpose(2, 0, 1)[None].astype(np.float32)
    o = sess.run(None, {'input_image': x})[0][0, 0]
    o = (o - o.min()) / (o.max() - o.min() + 1e-8)
    return np.asarray(Image.fromarray((o * 255).astype(np.uint8)).resize(im.size, Image.BICUBIC), dtype=np.float32) / 255.


class Harmonic:
    """Laplace fill for a fixed hole; the sparse system is factorised once and reused for every frame."""
    def __init__(self, hole, scale=4):
        self.h, self.w = hole.shape
        self.sh, self.sw = self.h // scale, self.w // scale
        hm = np.asarray(Image.fromarray((hole * 255).astype(np.uint8)).resize((self.sw, self.sh), Image.BILINEAR)) > 10
        self.hm = hm
        idx = -np.ones((self.sh, self.sw), np.int64); n = int(hm.sum()); idx[hm] = np.arange(n)
        ys, xs = np.where(hm)
        rows, cols, vals, diag = [], [], [], np.zeros(n)
        self.nb = []
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = ys + dy, xs + dx
            ok = (ny >= 0) & (ny < self.sh) & (nx >= 0) & (nx < self.sw)
            diag += ok
            nyc, nxc = np.clip(ny, 0, self.sh - 1), np.clip(nx, 0, self.sw - 1)
            nid = idx[nyc, nxc]
            unk = ok & (nid >= 0)
            rows.append(np.arange(n)[unk]); cols.append(nid[unk]); vals.append(-np.ones(unk.sum()))
            known = ok & (nid < 0)
            self.nb.append((known, nyc, nxc))
        rows.append(np.arange(n)); cols.append(np.arange(n)); vals.append(diag)
        A = sparse.csc_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n))
        self.lu = splu(A); self.n = n

    def fill(self, img):
        small = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize((self.sw, self.sh), Image.BOX), dtype=np.float32) / 255.
        rhs = np.zeros((self.n, 3))
        for known, nyc, nxc in self.nb:
            rhs[known] += small[nyc[known], nxc[known]]
        sol = np.stack([self.lu.solve(rhs[:, c]) for c in range(3)], 1).astype(np.float32)
        filled = small.copy(); filled[self.hm] = sol
        return np.asarray(Image.fromarray((np.clip(filled, 0, 1) * 255).astype(np.uint8)).resize((self.w, self.h), Image.BICUBIC), dtype=np.float32) / 255.


for i, (seg, a, b) in enumerate(WIN):
    t0 = time.time()
    d = f'{WORK}/{i}'
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d + '/raw'); os.makedirs(d + '/clean')
    start, length = seg + a, b - a
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', str(length), '-i', SRC, '-vf', 'fps=24', f'{d}/raw/%04d.png'], check=True, stderr=subprocess.DEVNULL)
    files = sorted(os.listdir(d + '/raw'))
    H = W = None
    union = None
    for f in files:
        im = Image.open(f'{d}/raw/{f}').convert('RGB')
        W, H = im.size
        m = matte(im) > .04
        union = m if union is None else (union | m)
    # the hold-frame subject must be inside the hole too (its cut-out was made from it)
    hold = np.asarray(Image.open(f'tools/work/{i}_{NAMES[i]}_alpha.png').convert('L'), dtype=np.float32) / 255. > .04
    union |= hold
    hole = ndi.binary_dilation(union, iterations=24)
    spark = np.zeros_like(hole); spark[int(H * .795):int(H * .865), int(W * .882):int(W * .93)] = True
    hole |= spark
    fillr = Harmonic(hole)
    soft = np.asarray(Image.fromarray((hole * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(7)), dtype=np.float32)[..., None] / 255.
    soft = np.where(spark[..., None], np.maximum(soft, 1.), soft)
    for f in files:
        fr = np.asarray(Image.open(f'{d}/raw/{f}').convert('RGB'), dtype=np.float32) / 255.
        out = fr * (1 - soft) + fillr.fill(fr) * soft
        if i in LIFT: out = np.clip(out * (1 + LIFT[i]) + LIFT[i] * .35, 0, 1)
        Image.fromarray((out * 255).astype(np.uint8)).save(f'{d}/clean/{f[:-4]}.jpg', quality=95)
    # slow it down with frame interpolation, then play forward+backward so it loops forever
    fwd = min(5.0, round(length * 6, 2)); k = fwd / length
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', '24', '-i', f'{d}/clean/%04d.jpg', '-vf',
                    f'scale=1600:900,setpts=PTS*{k},minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:vsbmc=1:me_mode=bidir', '-t', str(fwd), f'{d}/fwd.mp4'], check=True, stderr=subprocess.DEVNULL)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f'{d}/fwd.mp4', '-filter_complex',
                    '[0]split[a][b];[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1[o]', '-map', '[o]',
                    '-c:v', 'libx264', '-crf', '26', '-preset', 'slow', '-g', '30', '-pix_fmt', 'yuv420p', '-r', '30', '-an', '-movflags', '+faststart', f'public/bg/{i}.mp4'], check=True, stderr=subprocess.DEVNULL)
    shutil.copy(f'{d}/clean/0001.jpg', f'public/bg/{i}.jpg')
    print(f'scene {i} {NAMES[i]}: {len(files)} frames, {time.time() - t0:.0f}s, {os.path.getsize(f"public/bg/{i}.mp4") / 1e6:.2f} MB', flush=True)
