# Callback-to-promise
Converts a callback-based API to use promises with proper error handling.

**What it does:** Reads a source file, finds callback-based functions, and creates promise wrappers that reject on error and resolve on success.

**What it needs:** Access to the file system to read and write source files.

**What it will not do:** Modify files it cannot read or guarantee correct conversion if the API pattern is unclear.
