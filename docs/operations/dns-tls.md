# DNS and TLS

Domains aren't chosen yet. Replace `example.com` below with the real domain once it's registered (owner action).

| Name                      | Points to                                                  | Certificate                                     |
| ------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| `example.com` (website)   | Firebase App Hosting (custom domain on the backend)        | Managed by App Hosting, renewed automatically   |
| `api.example.com` (API)   | The load balancer's IP (Terraform output `api_ip_address`) | Google-managed certificate on the load balancer |
| `staging.example.com`     | Staging App Hosting backend                                | Managed by App Hosting                          |
| `api.staging.example.com` | Staging load balancer IP                                   | Google-managed                                  |
| Email-link sign-in domain | Firebase Hosting (Auth settings → authorised domains)      | Managed by Firebase                             |

## Steps

1. **API.** Set `api_domain` in `<env>.tfvars` and run `terraform apply`. Create an **A record** for the domain pointing to `terraform output api_ip_address`. The certificate becomes active once DNS resolves, usually within an hour. Check with:

   ```sh
   curl -sI https://api.example.com/health
   ```

   Expect `200` with `strict-transport-security`.

2. **Website.** Firebase console → App Hosting → backend → Settings → Domains → add the domain, then create the DNS records it shows.
3. **Firebase Auth.** Add both domains to Authentication → Settings → Authorised domains.
4. **Configuration.**
   - Set `PUBLIC_API_URL` and `WEB_URL` on the GitHub environment.
   - Set `NEXT_PUBLIC_API_URL` in `apps/web/apphosting.<env>.yaml`.
   - Set the mobile EAS environment variables.
   - Set `web_origins`, `api_host` and `web_host` in tfvars, and apply again (CORS for uploads, uptime checks).
5. **Email.** When the email provider is chosen (OQ-06), add its SPF, DKIM and DMARC records to the sending domain before the first emergency fallback email goes out.

## TLS settings

- **API load balancer:** the TLS policy is `MODERN` with a minimum of TLS 1.2. Plain HTTP answers `301` to HTTPS. The API sends HSTS (`max-age=31536000; includeSubDomains`) in staging and production.
- **Website:** App Hosting serves TLS 1.2 or later. The site sends HSTS and a strict Content-Security-Policy ([security-headers.ts](../../apps/web/src/lib/security-headers.ts)).
- **Cloud SQL:** the instance accepts encrypted connections only (`ENCRYPTED_ONLY`).
- **Redis:** private VPC address with AUTH. In-transit encryption is off because the Memorystore connection stays inside the VPC. Turn on `SERVER_AUTHENTICATION` (and use `rediss://`) if compliance requires it.

## Edge protection (Cloud Armor)

The load balancer has a Cloud Armor policy ([edge.tf](../../infra/terraform/modules/fleettrust/edge.tf)):

- **Per-IP rate ban:** above 1,200 requests a minute, the IP is banned for 5 minutes (429). This is far above any real client.
- **Adaptive DDoS protection (layer 7):** on.
- **OWASP SQL injection and XSS rules:** in **preview** (logged, not blocking). FleetTrust carries free text such as messages and articles. Review the preview hits in Cloud Logging for two weeks of pilot traffic, add exceptions for false positives, then set `preview = false`.

The Cloud Run URL (`*.run.app`) stays reachable so each release candidate can be smoke-tested before it gets traffic. The API's own rate limits, authentication and App Check (enforced in production) apply there as well. This trade-off is recorded in [ADR-0036](../adr/0036-staging-production-and-launch.md).
