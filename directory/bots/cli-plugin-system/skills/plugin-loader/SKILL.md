---
name: plugin-loader
description: Create a script that scans a plugins directory, imports each module dynamically using importlib, verifies it implements the required interface, and registers it in a central registry. Handle errors for missing modules, interface mismatches, and circular imports. Provide clear feedback on each plugin's status.
---

1. Define a base Plugin class with required methods: activate(), deactivate(), and get_dependencies(). 2. Write a loader script that iterates over .py files in the plugins directory. 3. For each file, use importlib.util.module_from_spec to load the module without executing top-level code. 4. Check if the module has a Plugin subclass or function matching the interface. 5. Instantiate the plugin and collect its get_dependencies() return value. 6. Add the plugin to the registry dictionary mapping names to instances. 7. Log successes and failures to a file or stdout. 8. Save the registry as JSON for the CLI to use at startup.
