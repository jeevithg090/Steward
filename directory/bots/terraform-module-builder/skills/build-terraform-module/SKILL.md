---
name: build-terraform-module
description: Create a terraform module from existing project files.
---

1. List workspace files with file_read to understand the project structure. 2. Read any existing terraform files to learn the naming patterns and resources already in use. 3. Ask the person which cloud provider (aws, azure, gcp) and which resources they want (instance, bucket, vpc, etc.). 4. Write a new file named "main.tf" (or a descriptive name) that includes a provider block for the chosen cloud, a resources block for the requested resources, a variables block for any configurable inputs, and an outputs block for useful values. 5. If the person provided specific names or sizes, use those exactly; otherwise use sensible defaults. 6. Write the file with file_write, using the .tf extension. 7. Read the file back with file_read to confirm it was written correctly. 8. Show the person the complete module file and ask if they want to add or change anything before they run terraform init and terraform apply.
