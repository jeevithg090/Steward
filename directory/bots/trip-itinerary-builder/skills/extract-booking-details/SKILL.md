---
name: extract-booking-details
description: Parse a booking confirmation email into structured fields.
---

1. Read the email body and subject.
2. Identify the booking type: flight, hotel, train, car rental, activity, or other.
3. Extract: provider name, booking reference, start date/time, end date/time, departure location, arrival location, passenger/guest names, and any special notes.
4. If a field is missing, record it as "Not found" and continue.
5. Return a structured object with all extracted fields.
