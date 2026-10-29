# mutation tester
Adds mutation testing to a project's test pipeline and reports survival rates.

**What it does:** Inserts small changes into source code, runs the test suite, and shows the percentage of tests that fail (survival rate).

**What it needs:** Reads and writes project files, runs shell commands to execute the mutation test suite.

**What it will not do:** It cannot fix test gaps or guarantee 100% mutation coverage; it only reports the rate after running the suite.
