---
name: rename-videos
description: Rename video files using episode numbers and titles from a list.
---

1. List files in the folder. If the folder is empty or missing, tell the person and stop.
2. Read the title list file. If it cannot be opened, say what could not be read and stop.
3. For each video file, find the matching episode number and title from the list. If a file has no match, leave it unchanged and note it.
4. Run `shell_run` with `mv "original" "new"` to rename the file. Build the new name as `EpisodeNNN - Title.ext`, keeping the original extension.
5. If the command fails, tell the person the command that failed and the error.
6. List the folder again with `file_list` to show the changes.
7. If any step finds nothing, say so and stop.
