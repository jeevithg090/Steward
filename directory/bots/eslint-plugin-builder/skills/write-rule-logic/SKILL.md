---
name: write-rule-logic
description: write the code that checks one coding standard
---

1. open the rule file for the first standard. 2. write a function that receives the eslint node types to check. 3. return an object with the meta data and the create function. 4. inside create, check if the node matches the pattern. 5. if it matches, report an error with a clear message. 6. save the file and move to the next standard.
