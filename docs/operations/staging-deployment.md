# Staging deployment setup (replaced)

The manual `gcloud` setup that used to live here was replaced in Prompt 29 by Terraform and the
release workflows:

- [environments.md](environments.md): environments, what Terraform creates, one-time setup, GitHub variables.
- [release-and-rollback.md](release-and-rollback.md): how releases reach staging and production, and how to roll back.
- [dns-tls.md](dns-tls.md): domains, certificates and Cloud Armor.
