---

name: search-error-pattern
description: Search the web for the exception and top frame to find known fixes.
---

1. Build a query: exception class + top method name + framework if visible (e.g., 'NullPointerException com.example.Service.run Spring').
2. Run web_search with the query.
3. Scan results for official docs, GitHub issues, or high-voted Stack Overflow answers.
4. Extract up to three distinct root causes mentioned.
5. If results are generic, note that and fall back to heuristic causes.
6. Return a list of { cause, source, confidence }.
