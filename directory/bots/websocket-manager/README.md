# websocket manager
A script that maintains a websocket connection with automatic reconnection and queues messages when the link is down.

What it does: opens a websocket, tries to stay connected, and holds outgoing messages until the connection returns.

What it needs: file_read and file_write to look at and create scripts; shell_run to install dependencies.

What it will not do: it cannot connect to a private server without the person giving the address and credentials.
