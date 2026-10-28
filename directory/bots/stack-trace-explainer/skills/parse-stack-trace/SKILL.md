---

name: parse-stack-trace
description: Extract exception type, message, and top frames from raw trace text.
---

1. Split the input by lines.
2. Find the first line that looks like an exception (contains 'Exception', 'Error', 'Traceback', or 'at ').
3. Capture the exception class and message.
4. Collect the next 10 stack frames (lines starting with 'at ', 'File ', or ' at ').
5. Note any 'Caused by' sections and repeat for the root cause.
6. Return a structured object: { exception, message, frames[], rootCause }.
7. If no recognisable pattern, return what you have and flag as uncertain.
