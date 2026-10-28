---

name: extract-and-synthesise
description: Pull key data from each study and write the synthesis with disagreements.
---

1. For each selected source, use web_fetch to retrieve the abstract or full text. If blocked, note the citation and "Full text not accessible."
2. Extract into a table: citation, design, sample size, population, intervention/exposure, comparator, primary outcome, effect size (95% CI), authors' conclusion, notable limitations, funding source.
3. Group rows by outcome.
4. For each outcome, write a synthesis paragraph: direction of effect, range of effect sizes, consistency across designs.
5. Write a disagreements paragraph: list each specific contradiction (different direction, magnitude, population, measure, follow-up time).
6. Note gaps: outcomes not measured, populations not studied, comparisons not made.
7. Assign confidence: high (multiple large low-bias RCTs agree), moderate (some limitations or mixed designs), low (few studies, small samples, high bias, or only observational). Give a one-sentence reason.
8. Use make_page to create the final report with all sections.
