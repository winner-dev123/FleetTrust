# Observability

## Logs

The API writes **one JSON object per line to stdout**. Cloud Run forwards stdout to Cloud Logging, which understands these fields natively:

| Field                                               | Meaning                                                                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `severity`                                          | `DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL` (mapped from the pino level)                                                                                            |
| `message`, `time`                                   | Human-readable message; ISO timestamp                                                                                                                                       |
| `service`, `role`, `version`                        | `fleettrust-api`, `api` or `worker`, release SHA                                                                                                                            |
| `requestId`                                         | Per-request ID, also returned as the `X-Request-Id` response header. A safe incoming `X-Request-Id` (8–128 chars of `[A-Za-z0-9._-]`) is reused, otherwise a UUID is minted |
| `traceId`, `spanId`, `logging.googleapis.com/trace` | Links the log line to its Cloud Trace trace (needs `GOOGLE_CLOUD_PROJECT`)                                                                                                  |
| `httpRequest`                                       | One line per request: method, **path only** (query strings can carry tokens), status, latency. Load-balancer probes are logged at debug level                               |

Set the level with `LOG_LEVEL` (`info` by default).

### Secret redaction

Secrets are removed in two independent ways:

1. **By field path:** authorization and cookie headers, the App Check header, `password`, `token`, `idToken`, `refreshToken`, `secret`, `apiKey`, `privateKey`, `DATABASE_URL`, `REDIS_URL`, … are replaced with `[REDACTED]`.
2. **By pattern, in every string:** messages, nested values and error messages and stacks. This covers credentials in URLs (`postgresql://user:…@`, `redis://:…@`), `Bearer` tokens, JWTs (Firebase ID and App Check tokens), and `password=` / `token=` / `api_key=` pairs.

`apps/api/src/observability/*.spec.ts` and `test/observability.e2e-spec.ts` assert that planted secrets never reach the output. Even so, **don't log request bodies, document contents or message bodies**. Redaction is a safety net, not a licence.

## Errors

Unexpected exceptions are caught by a global filter:

- The client gets a generic `500 { error: "internal_error", requestId }`, with no message or stack.
- The error is reported **once** through the `ErrorReporter` port. The default `LogErrorReporter` writes an `ERROR` entry with the stack trace and the `ReportedErrorEvent` type, which **Cloud Error Reporting** groups and alerts on automatically.
- Expected HTTP errors (4xx, the deliberate readiness 503) pass through unchanged and aren't reported.

A Sentry (or similar) adapter can implement `ErrorReporter` later without touching call sites.

## Traces

OpenTelemetry, vendor-neutral in the app:

- `dist/instrumentation.js` is preloaded with `node --import` (the image's `CMD`). When `OTEL_TRACES_EXPORTER` is unset or `none` (the local default) it does nothing.
- With `otlp` or `console`, it registers the ESM import hook and instruments **HTTP, Express and node-postgres**. Statement shapes are recorded, never parameter values. It continues incoming W3C `traceparent` headers.
- On Cloud Run the app exports OTLP to `localhost:4318`, where an **OpenTelemetry Collector sidecar** forwards to Cloud Trace (`deploy/cloudrun/api.service.yaml`). No Google SDK in the app.
- Spans are flushed during Nest's shutdown sequence (SIGTERM).

| Variable                      | Default                 | Notes                                                          |
| ----------------------------- | ----------------------- | -------------------------------------------------------------- |
| `OTEL_TRACES_EXPORTER`        | `none`                  | `none`, `console` (debugging) or `otlp`                        |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Standard OTel variable                                         |
| `OTEL_TRACES_SAMPLER_ARG`     | `1`                     | Fraction of new traces sampled (child spans follow the caller) |
| `OTEL_SERVICE_NAME`           | `fleettrust-<role>`     |                                                                |

Try it locally: `OTEL_TRACES_EXPORTER=console pnpm --filter @fleettrust/api start`.

## Health endpoints

| Endpoint            | Purpose                         | Checks                                                                                                       |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /health`       | Liveness and startup probe      | Nothing external; never fails because of a dependency                                                        |
| `GET /health/ready` | Readiness and deploy smoke test | Database ping with a 2 s timeout. 503 with coarse status (`unavailable`, `not_configured`), no error details |

## Alerts

Terraform creates these in each environment ([monitoring.tf](../../infra/terraform/modules/fleettrust/monitoring.tf)), emailing `alert_email`. Error Reporting notifications for new error groups are switched on in the console (Error Reporting → Configure notifications).

| Alert                    | Condition                                                                    | Why                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| API 5xx                  | More than 2 % of requests for 5 minutes                                      | Broken release or dependency: consider rolling back ([release-and-rollback.md](release-and-rollback.md)) |
| API latency              | p95 above 1 s for 10 minutes                                                 | SLOs are 400 ms (search) and 500 ms (writes) ([slo.md](slo.md))                                          |
| Load shedding            | More than 10 `overloaded:` warnings in 5 minutes                             | Pool or Cloud SQL saturated (Prompt 28); see the capacity levers in slo.md                               |
| **EMERGENCY** (critical) | Any emergency delivery failed after every retry, or a dispatcher tick failed | Someone's alert may not have reached a contact: follow the emergency playbook now                        |
| Cloud SQL                | CPU or disk above 80 % for 10 minutes                                        | Capacity                                                                                                 |
| Uptime                   | `/health/ready` failing from two or more regions                             | Outage (created once `api_host` is set)                                                                  |
| Budget                   | 50, 90 and 100 % of the monthly budget                                       | Cost (OQ-07)                                                                                             |
