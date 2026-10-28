---
name: setup-storybook
description: Add Storybook to a React project and configure the stories folder.
---

1. Run `npx storybook@latest init` and accept the defaults. 2. If the generated .storybook/main.js does not have a stories array, add `{ dir: "src/stories" }` to the config. 3. Create `src/stories/<ComponentName>.stories.js` for each component. 4. In each story file, export a default object with `title` set to the component name and `component` set to the component import. 5. Write a Template function that returns the component and export it as `args` with any prop defaults the component uses. 6. Run `npm run storybook` to confirm the stories appear.
