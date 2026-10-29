# Tax impact of NSO exercise
Calculate the tax impact of exercising non-qualified stock options this year, including payroll withholding.

## What it does
Uses web search to find current income tax and payroll withholding rates, then calculates the total tax due on an NSO exercise.

## Needs
- web_search to look up tax rates
- make_page to create the result table
- show_table to display the table

## What it will not do
It will not file tax forms or give legal advice. If tax rates cannot be found, it will ask the person to provide them.
