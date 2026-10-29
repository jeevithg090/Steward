---
name: extract-audio
description: Turn a video into podcast-ready audio with ffmpeg.
---

1. Ask for the video file path and the desired output name. 2. Verify the input file exists with a shell command. 3. Run ffmpeg with -codec:a aac -b:a 128k -ar 44100 -ac 2 to create an m4a file. 4. Check the output file size; if it is zero, report the failure. 5. Tell the person the conversion is done and where the file is saved.
