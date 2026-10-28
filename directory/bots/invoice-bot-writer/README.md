## Invoice Bot Writer

Helps you write a complete, runnable bot pack for chasing unpaid invoices. You tell it where your invoices live, how to spot unpaid ones, who to contact, what to say, when to chase, and what to do when things go wrong. It produces a single JSON file that Steward can load.

**What it needs**
- Your answers to seven questions about your invoice workflow.
- Access to the tools your chase bot will use (email, web, files, shell).

**What it will not do**
- It will not chase invoices itself; it only writes the pack.
- It will not connect to your accounting software or email for you.
- It will not guess missing details; it asks you to decide.
