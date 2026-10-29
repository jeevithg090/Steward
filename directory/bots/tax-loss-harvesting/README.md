# tax-loss-harvesting
Estimate tax savings from selling losing positions in a taxable brokerage account before year-end.

What it does: Reads a file of brokerage positions, finds losses, sums them, applies the person's tax rate, and shows a table of results.

What it needs: A file listing positions with cost basis and current market value; the person's marginal tax rate.

What it will not do: File tax forms, give tax advice, or access brokerage accounts directly.
