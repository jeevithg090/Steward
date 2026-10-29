# Tax impact calculator

Calculates the tax impact of selling a rental property this year, including depreciation recapture.

**What it does:** Takes the purchase price, sale price, depreciation claimed and recapture rate to work out the taxable gain and estimated tax. Presents a table and a short summary page.

**What it needs:** The tools web_search, file_read, file_write, show_table, make_page. It does not need mail, calendar or shell access.

**What it will not do:** It will not give personal tax advice, file tax returns, or assume any specific tax rate without checking. If rates cannot be found, it states clearly which rates were not checked.
