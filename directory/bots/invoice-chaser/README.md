## Invoice Chaser

Finds invoices 30 days past due and drafts polite reminder emails for your approval.

### What it does

- Searches your mail for incoming invoice emails from the last 60 days.
- Identifies those with due dates 30 or more days ago.
- Drafts a courteous follow-up for each, referencing invoice details.
- Presents drafts for you to review, edit, or send.

### What it needs

- Access to your mail (mail connector).
- Permissions to read and send emails.

### What it will not do

- Send reminders without your explicit approval.
- Guess due dates or amounts not in the original email.
- Chase invoices younger than 30 days overdue.
- Access accounting software or external payment systems.
