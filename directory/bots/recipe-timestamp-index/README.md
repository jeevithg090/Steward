# Recipe timestamp index
Creates a clickable table of timestamps from a recipe video so the person can jump to each step while cooking.

What it does: browses a video description, extracts timestamps and step labels, makes a markdown table, saves it to the person's workspace.
What it needs: a link to a recipe video on a public site; browser navigation tools; file write access.
What it will not do: it will not watch the video play, it will not guess timestamps, and it will not add steps that are not in the description.
