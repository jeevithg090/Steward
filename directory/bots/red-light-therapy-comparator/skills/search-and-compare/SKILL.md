---
name: search-and-compare
description: Find and lay out red light therapy device specs.
---

1. Use web_search with the query "red light therapy device muscle recovery wavelength power protocol". 2. Scan the results for product pages that list wavelength in nanometres, power output in mW/cm² and recommended treatment time. 3. Select up to three devices that provide all three data points. 4. If a device lacks a spec, note that it is not available rather than invent a value. 5. Run show_comparison with the chosen devices, asking it to display wavelength, power and protocol in columns. 6. If show_comparison returns an error or empty result, use make_page to create a markdown table with the gathered data. 7. Show the table or comparison to the person and ask if they want more info on any model.
