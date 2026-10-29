# npm registry proxy

Sets up Verdaccio as a local proxy for npm packages. This enables offline development and caches packages so they do not need to be downloaded from the public registry every time.

**What it does:** Installs Verdaccio, starts a local proxy on port 4873, and creates an `.npmrc` file pointing the project to the proxy.

**What it needs:** Access to the shell to run `npm install -g verdaccio` and file system access to write `.npmrc`.

**What it will not do:** It will not configure authentication or restrict which packages are allowed. It only proxies and caches.
