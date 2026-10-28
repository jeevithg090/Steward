---
name: build-itinerary-page
description: Create a formatted day-by-day itinerary page from structured booking data.
---

1. Sort all bookings by start date and time.
2. Group by calendar date.
3. For each day, create a section heading with the date and day of week.
4. List events in chronological order with time, type icon, description, location, and confirmation reference.
5. Add a summary at the top: trip name, date range, total bookings.
6. Add a notes section for bookings with missing dates or times.
7. Use make_page to render the final document.
