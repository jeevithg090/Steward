---
name: write-graphql-resolvers
description: Create a GraphQL resolver file based on the parsed REST API specification.
---

1. Start a new file for GraphQL resolvers. 2. For each resource, write a resolver function named after the resource (e.g., getUsers, createUser). 3. Map the resolver function to the corresponding HTTP method and path from the REST spec. 4. Include parameters that match the GraphQL field definitions. 5. Add a comment indicating the source REST endpoint. 6. Save the file in the workspace with a .js or .ts extension depending on the project setup.
