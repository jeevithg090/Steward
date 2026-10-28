---

name: parse-invoice-due-date
description: Extract due date and amount from an invoice email.
---

1. Open the email with `mail_read`.
2. Scan body for patterns: "Due by", "Due date", "Payment due", "Net 30", "Pay by".
3. If a specific date is found (e.g., "Due by 15 March 2025"), parse it.
4. If only terms like "Net 30" exist, calculate from invoice date (email date or stated invoice date).
5. Look for amount: "Amount due", "Total", "£", "$", "EUR" followed by numbers.
6. Return: due date (ISO format), amount (string or null), confidence (high/medium/low).
7. If nothing found, return null for both and confidence "none".
