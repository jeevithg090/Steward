# meeting buffer scheduler
Adds 15-minute follow-up blocks after every external meeting in the calendar.

What it does: Scans the next two weeks of events. For any event with a video conference link or titled "External", it prepares a 15-minute block starting right after the meeting, titled "Follow-up: [meeting title]". The person must approve each block before it is saved.

What it needs: Calendar access to list and create events.

What it will not do: Change internal meetings, add blocks where events already overlap, or create blocks without the person's approval.
