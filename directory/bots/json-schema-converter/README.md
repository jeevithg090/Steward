# JSON schema converter

Converts JSON data into a typed schema and a validator.

What it needs: file_read, file_write.
What it will not do: it cannot guess the person's preferred language or create documentation beyond the schema and validator files.

The agent reads the input JSON, generates a JSON Schema document and a matching validator script, writes them to files, and presents both to the person.
