---
name: explain-sleep-study-results
description: Turn numbers from a sleep report into plain language.
---

1. Check if a file named 'sleep-study.txt' or similar exists in the workspace. 2. If it exists, read it line by line. 3. For each number found, write a short sentence in plain language, such as 'Your AHI was X, which means Y breathing pauses per hour.' 4. If a number is not found, note that the value was not in the report. 5. If no report file is found, search the web for 'sleep apnea AHI normal range' and give a general explanation without using the person's numbers. 6. After the explanations, add a line that says 'I could not find your report. Here is general information about AHI:' and then give the general explanation. 7. Save the text as 'sleep-apnea-summary.txt' using file_write.
