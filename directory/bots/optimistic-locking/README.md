# Optimistic locking
Adds version-based conflict detection to an entity so concurrent updates do not overwrite each other.

- Reads the entity file and checks its version number.
- Saves the updated entity with version+1.
- If the version changed since the read, asks the person whether to merge or discard.
- Never overwrites a newer version without asking.

Needs the file_read and file_write tools. No external services or calendar access.
