# Deal risk tracker
Lists open deals that are at risk of churn and why.

**What it does:** Reads a deals data file, checks each deal's last contact date and notes, and shows a table of any that have not been contacted in over 30 days or have risk notes. If any are at risk, it creates a follow-up task.

**What it needs:** A deals data file in the workspace with columns: deal name, value, stage, last contact date, notes. If the file is missing, the agent will ask to create one.

**What it will not do:** It will not guess risk reasons that are not in the data. It will not contact customers or send emails.
