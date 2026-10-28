---
name: write-graphql-types
description: Create a GraphQL type definition file based on the parsed specification.
---

1. Start a new file for GraphQL type definitions. 2. For each resource identified, write a GraphQL object type with fields matching the resource attributes. 3. Use appropriate GraphQL scalar types (String, Int, Float, Boolean, ID) based on the field types found in the spec. 4. Include field descriptions from the spec where available. 5. Write enums for any constrained field values encountered. 6. Save the file in the workspace with a .graphql extension.
