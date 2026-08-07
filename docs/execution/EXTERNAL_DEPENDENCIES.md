# External Dependencies (BLOCKED_EXTERNAL registry)

Per SKILL §24: entries here have complete local code + fake + passing adapter tests; only the
external credential/resource is missing.

| Integration | Code status | Test status | Needed to activate | Validation once available |
|---|---|---|---|---|
| Microsoft Entra ID OIDC | in progress this slice (adapter contract + fake) | pending | AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, redirect URI registration | login round-trip on staging, group mapping check |
| SMTP email | not started (E20) | — | SMTP_URL creds | send test digest to sink + real inbox |
| Microsoft Teams | not started (E20) | — | Teams webhook/app registration | post test card |
| SharePoint/OneDrive documents | not started (E24) | — | Graph app registration | upload/download round-trip |
| S3 object storage (prod) | not started (E24) | — | bucket + keys | attachment round-trip |
| Production observability sink | not started (E00/E82) | — | OTLP endpoint | trace visible |
| Cloud deployment target | not started (E27/§151) | — | subscription/cluster | deploy + health green |
