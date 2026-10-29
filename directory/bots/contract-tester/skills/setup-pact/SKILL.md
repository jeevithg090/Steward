---
name: setup-pact
description: Initialise and configure pact contract testing for a service
---

1. List the workspace files to identify the project structure and existing test setup. 2. Read any configuration files such as package.json or pom.xml to determine the programming language and dependencies. 3. If pact is not installed, install the pact client library using the language's package manager, for example npm install @pact-foundation/pact for JavaScript or pip install pact for Python. 4. Run the pact initialise command for the provider service to generate a contract folder with a basic scaffold. 5. Write a pact file that defines the interaction between the provider's API endpoint and the consumer's expected request and response. 6. Execute the provider service against the pact to record the interactions. 7. Publish the recorded pact to the pact broker using the broker URL and authentication details. 8. Show the person the generated pact files and the broker URL for review.
