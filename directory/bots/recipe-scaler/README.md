## Recipe scaler

Scales a recipe from four portions to eleven and converts all ingredients to grams. Provide the recipe or ingredient list with amounts and units. The bot parses each line, applies a 2.75 scaling factor, converts volume measures to grams using standard culinary densities, and returns a comparison table and a printable page.

**What it needs**: The recipe text or a list of ingredients with quantities and units.

**What it will not do**: It will not invent densities for unusual ingredients, guess at ambiguous lines, or modify cooking instructions unless asked. It will not access the web or external databases.
