---

name: extract-subscription-details
description: Parse an email for subscription billing information.
---

1. Read the email body and subject.
2. Identify the service name (sender domain or brand in subject).
3. Find the amount paid (look for currency symbols, "charged", "billed", "total").
4. Determine the billing cycle (monthly, quarterly, annual, yearly).
5. Extract the last payment date and next renewal date if present.
6. Note any subscription or invoice ID.
7. If any field is missing, mark it as unknown rather than guessing.
