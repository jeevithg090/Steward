---
name: write-dockerfile
description: Create a Dockerfile based on the detected project type.
---

1. Choose an official base image for the detected language (e.g., node:20 for Node.js). 2. Set the working directory to /app. 3. Copy package.json or requirements.txt into the image. 4. Install dependencies using the appropriate command (npm install or pip install). 5. Copy the rest of the project source code. 6. Expose the default port for the framework. 7. Define the command to start the application.
