---
name: plugin-scaffolding
description: Create a new Babel plugin file. Import the necessary Babel modules. Define a visitor for ImportDeclaration. Use node.path to get the source and replace it with the target syntax. Export the plugin configuration object.
---

1. Read the project structure with file_read to locate source files. 2. Check for existing plugins or configurations. 3. Write the plugin file using file_write, following the Babel plugin API. 4. Run shell_run to execute Babel on a test file and verify the output. 5. If errors appear, read the error messages and adjust the plugin code accordingly.
