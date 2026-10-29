# team heatmap
Creates a weekly availability heatmap from everyone's shared calendars.

What it does: reads shared calendars, marks each hour busy or free, arranges the grids in a table, and outputs an HTML page.

What it needs: calendar connector to read calendars; calendar_list, show_table and make_page tools.

What it will not do: it cannot read calendars that are not shared, and it will not create or modify any files without asking.
