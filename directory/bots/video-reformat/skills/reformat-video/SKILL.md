---
name: reformat-video
description: Resize and overlay a video for vertical platforms
---

1. Use file_read to list all video files in the workspace. 2. For each video, run shell_run with ffmpeg -i input.mp4 -vf "scale=1080:1920,drawtext=text='Safe zone':x=(w-overlay_w)/2:y=(h-overlay_h)/2" output.mp4. 3. Use file_read again to confirm the new file exists. 4. Show the person the list of output files with their sizes.
