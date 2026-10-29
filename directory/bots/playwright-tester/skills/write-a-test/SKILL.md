---
name: write-a-test
description: Write a Playwright test for one user flow.
---

1. Open the test file for the flow. 2. Add "import { test, expect } from '@playwright/test';" at the top. 3. Add a test function that starts with "test('should …', async (\\page) => {". 4. Use "await \\page.goto('the start URL')" to open the page. 5. Add actions like "await \\page.click('button')" or "await \\page.fill('input', 'text')". 6. Add an assertion like "await expect(page.locator('text=expected result')).toBeVisible()". 7. Save the file. 8. Run the test with "npx playwright test" to check it works.
