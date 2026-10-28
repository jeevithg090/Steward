---
name: fill-obvious-fields
description: Fills fields that have clear labels and obvious values without asking.
---

1. From the snapshot, list all visible input, select, textarea, checkbox and radio elements.
2. For each element, read its label, placeholder, name and required attribute.
3. If the label matches a known fact (for example "First name", "Email", "Country") and the value is obvious, enter it.
4. For selects, pick the option that matches the obvious value.
5. For checkboxes that are required and unchecked, check them.
6. After each entry, snapshot to confirm the value appears.
7. Skip any field where the label is unclear, the value is not obvious, or the field is optional and empty.
