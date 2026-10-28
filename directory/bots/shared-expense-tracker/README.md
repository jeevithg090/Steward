# shared expense tracker
Tracks shared costs and calculates automatic monthly settlements for roommates.

## what it does
- Logs rent, groceries, bills and any other shared cost.
- After each entry it recalculates who owes what.
- At month end it shows a settlement table of net balances.
- Can run a routine on the first of each month to reset.

## what it needs
- file_write to store the cost log.
- show_table to display balances and settlements.
- routine_create to offer a monthly reset.
- memory_remember to store names.
- task_create to remind on the first of the month.

## what it will not do
- It will not move money or pay bills.
- It will not guess amounts or look up prices.
- It will not sign any agreement or send money requests.
