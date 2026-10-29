# k8s cluster setup

Sets up a local Kubernetes cluster with Kind and deploys a microservice stack. Reads existing config, starts the cluster, loads images, and applies manifests. Shows status and URLs at the end.

Needs: file_read, file_write, shell_run

Will not run shell commands without asking. Will not deploy images it cannot verify.
