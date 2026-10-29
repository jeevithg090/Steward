---
name: load-portfolio-data
description: Read the user's portfolio file to extract sector weights for each holding.
---

1. Use file_read to open the portfolio data file. 2. Check that the file lists holdings with sector tags. 3. If the file is empty or has no sector information, stop and say that sector data was not found. 4. If sector data exists, extract the weight for each sector and note any missing sectors.
