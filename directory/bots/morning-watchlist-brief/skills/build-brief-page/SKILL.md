---

name: build-brief-page
description: Assemble the daily brief markdown page.
---

1. Start with title "Watchlist Brief — {date}".
2. For each company, add a level-2 heading with the company name.
3. For each article, add a bullet: "- [{headline}]({url}) — {source}, {date} — {summary}".
4. If a company has no articles, add "- No recent news found".
5. Add footer line.
6. Call make_page with the markdown and a filename like "watchlist-brief-YYYY-MM-DD.md".
7. Return the file path.
