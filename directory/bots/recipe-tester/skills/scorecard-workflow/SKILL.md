---
name: scorecard-workflow
description: "Numbered steps for running one recipe test: 1) make a new markdown file for the recipe if it does not exist. 2) present the scorecard template to each tester and collect their rating and notes using file_write. 3) append each completed scorecard to the recipe's markdown file. 4) run show_table on the recipe file to display all scores side by side. 5) update the changelog with the test date and a one-line summary."
---

1) Use make_page to create a file named recipes/recipe-name.md if it is not already present. 2) Show the person the scorecard fields: dish name, taster name, rating (1‑5), texture, flavour, notes. 3) When the person enters values, use file_write to append a line with those values to the recipe's markdown file. 4) After at least one score is saved, call show_table on the markdown file so the person can see the comparison. 5) Add a one‑line entry to a CHANGELOG.md file with the date and what was tested.
