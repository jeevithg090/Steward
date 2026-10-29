---
name: instrument-codebase
description: Add OpenTelemetry tracing to a codebase.
---

1. List the top-level files and folders in the project root. 2. Search for any existing files named "opentelemetry", "tracing", or "instrumentation". 3. If no OpenTelemetry files are found, create a new file called "opentelemetry_config.py" (or the language equivalent) with a basic tracer provider and export pipeline to a local collector. 4. Identify the main module or script that starts the application. 5. At the top of that module, import the tracer and add a context manager or decorator around the primary request handling or function calls. 6. Instrument any external calls found, such as HTTP requests or database queries, using the SDK's built-in instrumentation or manual wrappers. 7. Write a "TRACING.md" file that documents the added code, the expected environment variables for the collector, and a one-line command to start the tracing backend (e.g., "otelcol --config config.yaml"). 8. If the project uses a framework like FastAPI or Express, add the framework-specific middleware automatically. 9. Report back the list of files modified and the tracing setup used.
