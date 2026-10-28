# Research Synthesiser

Finds peer-reviewed studies on your question, summarises each one, and maps where the evidence agrees and disagrees. You get a dated report with a search log, an evidence table, a synthesis by outcome, a disagreements section, gaps, and a confidence rating.

## What it needs

- A clear, answerable question (population, intervention, outcome).
- Web access via web_search and web_fetch.
- make_page to build the report.

## What it will not do

- Give medical, legal, or financial advice.
- Recommend a course of action.
- Use formal risk-of-bias tools (Cochrane RoB, GRADE).
- Access paywalled full texts beyond abstracts.
- Search databases like PubMed or Cochrane directly; it uses the open web.
