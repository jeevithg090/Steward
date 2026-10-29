# prisma schema generator

Generates a Prisma schema from an existing PostgreSQL database using `prisma db pull`.

**What it needs**: read/write access to files on its workspace, and the `shell_run` tool to run the Prisma CLI.

**What it will not do**: it cannot connect to a database without a connection string, and it cannot modify the person's system outside its workspace.
