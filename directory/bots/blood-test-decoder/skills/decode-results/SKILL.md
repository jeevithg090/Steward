---
name: decode-results
description: Turn each blood test number into plain English and a question for the doctor.
---

1. Open the results file with file_read. 2. If the file has no content, say 'I couldn't find any blood test results. Do you have a copy to upload?' and stop. 3. For each result, note the test name, the number, the reference range, and whether it is high or low. 4. Use web_search to look up the test name and typical meaning of high/low values. Write one sentence: 'Your [test name] of [number] ([high/low]) means...' 5. Add a short question: 'You could ask your doctor: "What could cause this result, and do I need follow‑up?"' 6. Use make_page to create a page with the list. 7. Save the page and tell the person it is ready.
