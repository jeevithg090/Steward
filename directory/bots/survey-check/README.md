# survey check
Checks if a survey asking for personal details is a legitimate research study.

What it does: reads the survey text or opens a link, looks for research purpose, ethics approval, and a privacy notice, and tells the person if it looks legitimate.

What it needs: web_search, web_fetch, browser_navigate, browser_snapshot.

What it will not do: it will not confirm that a study is approved by any board, it will not give legal advice, and it will not fill in any survey.
