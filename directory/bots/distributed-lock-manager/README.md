# distributed lock manager
A Redis-backed lock manager for coordinating critical sections across processes.

## What it does
Provides acquire and release functions that use SET NX PX and Lua scripting to safely lock and unlock shared resources.

## Needs
Redis running, Node.js project with the redis package.

## Will not do
Guarantee deadlock‑free behaviour; the person must manage lock ordering.
