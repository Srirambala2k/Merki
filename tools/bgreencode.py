"""Re-encode the cached clean frames (tools/work/bg/*/clean) with a different slow-down factor. Usage: python tools/bgreencode.py 2.5"""
import os, sys, subprocess
SLOW = float(sys.argv[1]) if len(sys.argv) > 1 else 2.5
WIN = [(1, .04, .96), (5, .30, .72), (2, .04, .96), (0, .04, .96), (6, .40, .72), (4, .04, .50), (7, .50, .98), (3, .04, .90)]
for i, (seg, a, b) in enumerate(WIN):
    d = f'tools/work/bg/{i}'
    n = len([f for f in os.listdir(d + '/clean') if f.endswith('.jpg')])
    length = n / 24.0
    fwd = round(length * SLOW, 2); k = SLOW
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', '24', '-i', f'{d}/clean/%04d.jpg', '-vf',
                    f'scale=1600:900,setpts=PTS*{k},minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:vsbmc=1:me_mode=bidir', '-t', str(fwd), f'{d}/fwd.mp4'], check=True, stderr=subprocess.DEVNULL)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f'{d}/fwd.mp4', '-filter_complex',
                    '[0]split[a][b];[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1[o]', '-map', '[o]',
                    '-c:v', 'libx264', '-crf', '26', '-preset', 'slow', '-g', '30', '-pix_fmt', 'yuv420p', '-r', '30', '-an', '-movflags', '+faststart', f'public/bg/{i}.mp4'], check=True, stderr=subprocess.DEVNULL)
    print(i, n, 'frames ->', fwd, 's forward', round(os.path.getsize(f'public/bg/{i}.mp4') / 1e6, 2), 'MB', flush=True)
