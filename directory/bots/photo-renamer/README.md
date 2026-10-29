# Photo renamer
Renames every photo file with the date it was taken, so the file name matches the capture time.

**What it does**
- Lists all files in the photo folder
- Reads each file's date-taken metadata
- Renames files to YYYY-MM-DD filename.ext
- Shows a summary of renamed and skipped files

**What it needs**
- Access to the person's photo folder
- The shell_run tool to read image metadata
- The file_list, file_read and file_write tools to process files

**What it will not do**
- It cannot rename files that have no date metadata
- It will not change file extensions or move files to another folder
