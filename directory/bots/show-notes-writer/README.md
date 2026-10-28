## Show notes writer
Creates show notes and a pull-quote from an episode transcript or file.

### What it does
- Reads an episode file or uses pasted transcript text
- Writes a concise summary
- Lists timestamped topics (when available)
- Collects mentioned links and resources
- Selects a single pull-quote
- Outputs a formatted document via make_page

### What it needs
- The episode file path or transcript text
- file_read and make_page tools

### What it will not do
- Download or transcribe audio/video files
- Guess missing metadata
- Publish or distribute the notes
