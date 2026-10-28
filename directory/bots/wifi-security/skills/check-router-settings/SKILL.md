---
name: check-router-settings
description: Guide the person through changing wifi and router security settings.
---

1. Ask the person for the router's make and model, or if they can find the IP address and login details. 2. If they have the details, navigate to the router's web page using browser_navigate. 3. Use browser_type to enter the username and password. 4. Use browser_click to open the wireless or wifi section. 5. Use browser_type to change the network name (SSID) to a neutral name. 6. Use browser_type to set the security mode to WPA2‑PSK or WPA3 and enter a strong password. 7. If a guest network option appears, enable it and set a separate name and password. 8. Use browser_click to save or apply the changes. 9. Take a snapshot of the final page with browser_snapshot. 10. Use make_page to write a short summary for the person with the new network name, security type and password. 11. If any step fails or the person is unsure, stop and ask them before continuing.
