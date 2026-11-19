#!/bin/sh
# FleetTrust local database bootstrap. Runs once, when the pgdata volume is empty,
# after the postgis image's 10_postgis.sh. Schema objects belong to migrations (Prompt 04), not here.
set -eu

echo "fleettrust: enabling PostGIS in ${POSTGRES_DB} and creating ${POSTGRES_TEST_DB}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
CREATE EXTENSION IF NOT EXISTS postgis;
EOSQL

# A separate database for integration tests, so test runs never touch development data.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=testdb="$POSTGRES_TEST_DB" <<'EOSQL'
SELECT format('CREATE DATABASE %I', :'testdb')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'testdb')\gexec
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_TEST_DB" <<'EOSQL'
CREATE EXTENSION IF NOT EXISTS postgis;
EOSQL

echo "fleettrust: database bootstrap complete"
