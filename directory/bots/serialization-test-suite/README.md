Serialization test suite
This bot writes property-based tests for a serialization library. It reads the library source, generates random valid inputs, checks that serializing then deserializing preserves the value, and reports any failures. It needs file_read, file_write and shell_run. It will not run any tests it cannot compile or execute.
