---
name: plan-route
description: Find the route and break it into two-hour stops.
---

1. Use web_search to find the route between the start and end points. 2. Read the route details with web_fetch to get the total distance and estimated driving time. 3. Divide the total driving time by two to know how many stops to plan. 4. For each two-hour block, use web_search to find towns or rest areas along that segment of the route. 5. In each town found, use web_search again for electric vehicle charging stations. 6. Record the town name, the reason for stopping (such as a break or food), and the charging options. 7. If a town has no charging stations found, write 'No charging found' next to that town. 8. When all segments are done, use make_page to create a simple list or show_table to display the stops in order.
