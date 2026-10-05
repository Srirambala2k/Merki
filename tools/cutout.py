"""Step 1: extract the 8 scene hero frames from the source video and compute a soft alpha matte for each
with the ISNet salient-object model (run directly through onnxruntime)."""
import subprocess, numpy as np, onnxruntime as ort
from PIL import Image
# scene order on the page -> time (s) in video/hero_video.mp4 of a clean, representative frame
TIMES = [1.5, 5.55, 2.5, 0.5, 6.55, 4.3, 7.75, 3.5]
NAMES = ['hero', 'about', 'services', 'work', 'philosophy', 'process', 'clients', 'contact']
sess = ort.InferenceSession('tools/models/isnet.onnx', providers=['CPUExecutionProvider'])
for i, (t, n) in enumerate(zip(TIMES, NAMES)):
    f = f'tools/work/{i}_{n}.png'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', 'video/hero_video.mp4', '-frames:v', '1', f], check=True)
    im = Image.open(f).convert('RGB')
    x = np.asarray(im.resize((1024, 1024), Image.BILINEAR), dtype=np.float32) / 255.
    x = (x - [0.485, 0.456, 0.406]) / [1., 1., 1.]
    out = sess.run(None, {'input_image': x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]
    out = (out - out.min()) / (out.max() - out.min() + 1e-8)
    a = Image.fromarray((out * 255).astype(np.uint8)).resize(im.size, Image.BICUBIC)
    a.save(f'tools/work/{i}_{n}_alpha.png')
    print(i, n, 'ok')
