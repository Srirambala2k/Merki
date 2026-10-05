# The Merki — website

Layered, scroll-driven agency site: GSAP + Lenis, Vite, vanilla JS.

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # outputs dist/
```

## How the artwork works
Each of the 8 slides is a **background video loop** (`public/bg/*.mp4`, subject removed) with the **subjects as separate
transparent cut-outs** (`public/art/*.webp`) layered above it and the headline in front. Positions live in `public/art/layers.json`.

## Rebuilding the artwork (optional, needs Python 3 + ffmpeg)
```bash
pip install onnxruntime numpy pillow scipy
# download isnet-general-use.onnx into tools/models/isnet.onnx
#   https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx
python tools/cutout.py     # frames + mattes from video/hero_video.mp4
python tools/layers.py     # background plates + cut-out layers
python tools/bgvideo.py    # per-scene live background videos
python tools/bgreencode.py 2.5   # re-encode at a different slow-down
```

## Content to add
- Work images: drop files into `photos/work/` — they appear in the "Our work" panel automatically.
- WhatsApp number and per-slide messages: `src/main.js` (`WA_NUMBER`, `WA_MSG`).
- Contact form currently sends to a placeholder `hello@themerki.com` (`src/main.js`).
