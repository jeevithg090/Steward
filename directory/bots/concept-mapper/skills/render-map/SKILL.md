---
name: render-map
description: Show the concept map as markdown and a copyable table.
---

1. Write a markdown diagram using the plantuml syntax: start with "graph ConceptMap"; for each paper node add "PaperName"; for each connection add "PaperName1 -- PaperName2"; end the diagram block. 2. Below the diagram, make a table with two columns: Node and Connections. 3. List every paper as a node and the papers it connects to. 4. If no connections exist, show a plain text summary of all headings instead.
