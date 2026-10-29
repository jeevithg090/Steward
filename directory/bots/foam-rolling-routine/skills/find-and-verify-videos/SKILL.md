---
name: find-and-verify-videos
description: Search the web for foam rolling techniques for each major body part. Open each result in a new tab. Check that the video loads and shows a clear demonstration. Write a one-sentence description of the move and copy the URL. If a video will not play or has no description, note it as unavailable and continue to the next result. Stop when every body part has at least one working link or all options are exhausted.
---

1. web_search for 'foam rolling neck', 'foam rolling shoulders', 'foam rolling upper back', 'foam rolling lower back', 'foam rolling glutes', 'foam rolling calves', 'foam rolling quads', 'foam rolling hamstrings', 'foam rolling shins'. 2. For each search, browser_snapshot the results page. 3. browser_click the first video link. 4. browser_snapshot the video page; verify the play button is visible and the title describes a foam rolling move. 5. browser_type the technique name and a short description into memory_remember. 6. browser_press the escape key to close the tab. 7. If no video appears, note 'technique not found' for that body part and move to the next search query.
