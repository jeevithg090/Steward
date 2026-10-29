---
name: find-class-components
description: scan the codebase for files defining class components with react.Component or extends React.Component
---

1. use file_list to get all source files in the project. 2. read each file with file_read. 3. look for patterns like 'class' followed by a name extending React.Component. 4. record the file path and line numbers of each class component found. 5. if none are found, say so and stop.
