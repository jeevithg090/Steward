# Transparency (build plan S8.6)

`allowlist.json` lists the image digests a device may release keys to (S8.4). CI writes it
after each release build (`release-images`, manual on tags), signs it with cosign, and checks
the signature before deploying anything. Anyone can check it:

```bash
cosign verify-blob --key deploy/transparency/cosign.pub --signature allowlist.json.sig allowlist.json
```

## Keys (one-time setup; not done yet)

| Key | Made with | Lives in | Used for |
|---|---|---|---|
| cosign key pair | `cosign generate-key-pair` | private: GitLab CI masked variables `COSIGN_PRIVATE_KEY`, `COSIGN_PASSWORD`; public: commit as `cosign.pub` here | signing images and this allowlist |
| deploy report key (Ed25519) | `python -c "from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey as K; ..."` | private: RunPod secret `DEPLOY_SIGNING_KEY`; public: shipped with the PWA | signing worker reports (S8.4) |

Until `cosign.pub` is committed and a tag is released, there is no allowlist: devices refuse
every worker, which is the safe default.
