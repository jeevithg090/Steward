# Price drop monitor
Monitors a product page and emails when the price falls below a target.

What it needs: web_fetch to look at pages, mail_send to email you, routine_create to check daily.

What it will not do: it cannot guess prices on pages that do not show a clear number, and it will not send email unless the price is at or below your target.
