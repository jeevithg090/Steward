---

name: extract-actions
description: Parse meeting text for action lines with owners and due dates.
---

1. Split the text into lines.
2. For each line, check if it starts with an action verb (send, review, schedule, follow up, prepare, update, draft, call, email, book, confirm, complete, finish, deliver, create, write, design, test, deploy, fix, investigate, research, analyse, plan, organise, coordinate, approve, sign, submit, file, log, track, monitor, report, present, share, distribute, notify, inform, remind, chase, escalate, resolve, close).
3. Look for owner patterns: `@word`, `Owner: word`, `Assigned to: word`, `[word]`, `– word`, `- word` at end of line.
4. Look for due patterns: `by word`, `due word`, `by EOD`, `by COB`, `by tomorrow`, `by next week`, `by <date>`.
5. Return a list of objects: {description, owner, due, sourceLine}.
