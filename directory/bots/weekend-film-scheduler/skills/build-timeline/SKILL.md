---
name: build-timeline
description: Turns shot lists and constraints into a timed daily schedule.
---

1. List all scenes per location with durations.
2. Add fixed constraints (call times, golden hour, permits).
3. Insert travel buffers between locations.
4. Add meal breaks (default 1 hour at 1pm unless told otherwise).
5. Add 15-minute setup/turnover buffers between scenes.
6. Calculate wrap time. If past desired end time, flag it.
7. Output a table per day: Time, Activity, Location, Notes.
