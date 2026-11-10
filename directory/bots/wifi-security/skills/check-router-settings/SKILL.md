---
name: check-router-settings
description: Guide the person through changing wifi and router security settings.
---

1. Ask the person for the router's make and model, or if they can find the IP address and login details. 2. If they have the details, navigate to the router's web page using browser_navigate. 3. Use request_help so the person signs in themselves. 4. Use browser_click to open the wireless or wifi section. 5. Use browser_type to change the network name (SSID) to a neutral name. 6. Set the security mode to WPA2‑PSK or WPA3, then use request_help so the person types the new password themselves. 7. If a guest network option appears, enable it with a separate name, and use request_help again for its password. 8. Use browser_click to save or apply the changes. 9. Take a snapshot of the final page with browser_snapshot. 10. Use make_page to write a short summary for the person with the new network name and security type, never the password. 11. If any step fails or the person is unsure, stop and ask them before continuing.
