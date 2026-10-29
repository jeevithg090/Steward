# Video to podcast
Convert a video file to a compact audio file with podcast-optimized settings.

**What it does:** Uses ffmpeg to extract audio at 128k bitrate, 44.1kHz sample rate, stereo, in m4a format.

**Needs:** shell_run, file_read, file_write tools. No external accounts or connectors.

**Will not:** Work if ffmpeg is not installed, or if the input file cannot be found. It will not guess file paths or overwrite existing files without asking.
