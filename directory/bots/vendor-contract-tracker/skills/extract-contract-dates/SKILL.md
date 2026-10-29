---
name: extract-contract-dates
description: Read each email attachment and note the contract end date, renewal deadline and any reference number. If the file type is not supported, say so and move to the next email.
---

1. Use mail_list to show the most recent 30 days of mail. 2. For each email that mentions a vendor or contract, use mail_read to open it. 3. Use file_read to read the attachment. 4. Scan the text for dates such as "contract ends on", "renewal by" or a reference number. 5. Record the end date and the renewal deadline. 6. If the attachment cannot be read, say which file type could not be opened and continue with the next email.
