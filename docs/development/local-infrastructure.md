# Local infrastructure

Local backing services for development and integration tests. **Production never uses any of this.** It runs on managed Google Cloud services (Cloud SQL, Memorystore, Cloud Storage, Firebase); see [ADR-0004](../adr/0004-firebase-hybrid-platform.md).

| Service                                            | How it runs                     | Address                                                        | Needed from  |
| -------------------------------------------------- | ------------------------------- | -------------------------------------------------------------- | ------------ |
| PostgreSQL 17 + PostGIS 3.6                        | Docker Compose                  | `127.0.0.1:5432`, databases `fleettrust` and `fleettrust_test` | Prompt 04    |
| Redis 7.2 (password required)                      | Docker Compose                  | `127.0.0.1:6379`                                               | Prompt 06/17 |
| Mailpit (optional)                                 | Docker Compose, `email` profile | SMTP `127.0.0.1:1025`, UI http://127.0.0.1:8025                | Prompt 06/18 |
| Firebase Auth emulator                             | Firebase Local Emulator Suite   | `127.0.0.1:9099`                                               | Prompt 06    |
| Firebase Storage emulator (Cloud Storage stand-in) | Firebase Local Emulator Suite   | `127.0.0.1:9199`                                               | Prompt 09    |
| Emulator UI                                        | Firebase Local Emulator Suite   | http://127.0.0.1:4000                                          | —            |

Everything binds to `127.0.0.1`, so nothing is reachable from other machines on your network.

## Prerequisites

| Tool                                                        | Why                                                                         | Check                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------ |
| Docker Desktop (or another engine with `docker compose` v2) | Postgres, Redis, Mailpit                                                    | `docker compose version` |
| Java **21 or newer** (e.g. Eclipse Temurin 21)              | `firebase-tools` 15 refuses to start emulators on older Java                | `java -version`          |
| Node 24 + pnpm 12                                           | Repository tooling (`pnpm install` also installs a pinned `firebase-tools`) | `node -v`, `pnpm -v`     |

On Windows, Docker Desktop needs WSL 2 (`wsl --install`, then reboot). Docker Desktop's licence is free for personal use, education and small businesses; larger organisations need a paid subscription. Podman Desktop or Rancher Desktop are free alternatives that provide `docker compose`.

The PostGIS image is published for amd64 only. On Apple Silicon it runs under emulation: it works, but first start is slower.

## Everyday commands

```sh
pnpm infra:env       # once: writes infra/local/.env with random passwords (git-ignored)
pnpm infra:up        # start Postgres + Redis and wait until both are healthy
pnpm infra:up:all    # same, plus Mailpit
pnpm infra:status    # health of containers and emulators; exits 1 if Postgres or Redis is unhealthy
pnpm infra:down      # stop containers, keep data
pnpm emulators       # Firebase Auth + Storage emulators (foreground; Ctrl+C saves data to .firebase-data/)
```

`pnpm infra:up` runs `infra:env` automatically, so a fresh clone only needs `pnpm install && pnpm infra:up`.

Connection strings for the apps are written into `infra/local/.env` as `DATABASE_URL`, `DATABASE_URL_TEST`, `REDIS_URL` and `SMTP_URL`. Prompt 04 wires them into the API.

### Resetting

```sh
pnpm infra:destroy --yes   # DELETES local Postgres and Redis data (volumes), then stop
```

Without `--yes` the command refuses. The Postgres init script (`infra/local/postgres/20-fleettrust.sh`) only runs on an empty volume. Destroy and re-up after changing it, or after changing `POSTGRES_*` passwords in `.env`.

Emulator data lives in `.firebase-data/` (git-ignored). Delete the folder to start the emulators empty.

## Credentials

- No credential has a default anywhere in the repository. `compose.yaml` uses `${VAR:?message}`, so Compose refuses to start if `infra/local/.env` is missing a value. A test (`tools/local-infra/test/config-files.test.ts`) enforces this.
- `pnpm infra:env` generates a fresh 32-character random password per service per developer, and never overwrites values you've edited. To rotate one, delete its line and re-run. Then destroy and re-create the containers, because Postgres keeps the password it was initialised with.
- The Firebase emulators use the project ID `demo-fleettrust`. The `demo-` prefix guarantees they can never reach a real Firebase project, and no credentials are needed.
- Mailpit's web UI requires the generated `MAILPIT_UI_USER` / `MAILPIT_UI_PASSWORD`. Its SMTP port accepts mail without authentication, but only on `127.0.0.1`.

## Health checks

| Service   | Health check                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| Postgres  | `pg_isready` over TCP (fails during first-time initialisation) **and** PostGIS present in the test database |
| Redis     | `redis-cli ping` returns `PONG` (authenticated)                                                             |
| Mailpit   | `/mailpit readyz`                                                                                           |
| Emulators | `pnpm infra:status` probes the Auth and Storage emulator ports                                              |

`pnpm infra:up` uses `docker compose up --wait`, so it only returns once every started container reports healthy (timeout 180 s).

## Storage emulation

Local file storage uses the Firebase Storage emulator, not MinIO; see [ADR-0012](../adr/0012-local-storage-emulation.md). The emulator enforces `infra/firebase/storage.rules`, which deny all direct client access, exactly as in production ([ADR-0006](../adr/0006-object-storage-and-private-documents.md)).

## Troubleshooting

| Symptom                                                    | Fix                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Docker with the Compose plugin is required…`              | Install and start Docker Desktop, then retry                                                                                               |
| `firebase-tools no longer supports Java version before 21` | Install a JDK/JRE 21+, make sure `java -version` shows it (update `JAVA_HOME`/`PATH`), and open a new terminal                             |
| `required variable POSTGRES_PASSWORD is missing a value`   | Run `pnpm infra:env`                                                                                                                       |
| Port already in use                                        | Change `POSTGRES_PORT`, `REDIS_PORT`, … in `infra/local/.env`. Connection strings are recomputed on the next `pnpm infra:env` / `infra:up` |
| Postgres rejects the password after editing `.env`         | The volume still has the old password: `pnpm infra:destroy --yes && pnpm infra:up`                                                         |
