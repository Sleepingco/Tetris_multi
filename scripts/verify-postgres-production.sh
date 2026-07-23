#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POSTGRES_IMAGE="postgres:17.10-alpine3.24@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"
suffix="$(openssl rand -hex 6)"
image_tag="tetris-multi:goal9d-${suffix}"
network_name="tetris-goal9d-network-${suffix}"
volume_name="tetris-goal9d-postgres-data-${suffix}"
database_container="tetris-goal9d-postgres-${suffix}"
application_container="tetris-goal9d-app-${suffix}"
database_name="tetris_goal9d"
restore_database="tetris_goal9d_restore"
migration_role="tetris_goal9d_migration"
runtime_role="tetris_goal9d_runtime"
maintenance_role="tetris_goal9d_maintenance"
admin_password="goal9d-admin-test-only"
migration_password="goal9d-migration-test-only"
runtime_password="goal9d-runtime-test-only"
maintenance_password="goal9d-maintenance-test-only"
temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/tetris-goal9d-production.XXXXXX")"
ca_certificate="${temporary_directory}/ca.crt"
application_log="${temporary_directory}/application.log"
backup_file="${temporary_directory}/synthetic-backup.dump"
application_created=false
database_created=false
network_created=false
volume_created=false
image_created=false

cleanup() {
    docker unpause "$database_container" >/dev/null 2>&1 || true
    if "$application_created"; then
        docker rm -f "$application_container" >/dev/null 2>&1 || true
    fi
    if "$database_created"; then
        docker rm -f "$database_container" >/dev/null 2>&1 || true
    fi
    if "$volume_created"; then
        docker volume rm "$volume_name" >/dev/null 2>&1 || true
    fi
    if "$network_created"; then
        docker network rm "$network_name" >/dev/null 2>&1 || true
    fi
    if "$image_created"; then
        docker image rm "$image_tag" >/dev/null 2>&1 || true
    fi
    rm -rf "$temporary_directory"
}
trap cleanup EXIT

for resource in "$application_container" "$database_container"; do
    if docker container inspect "$resource" >/dev/null 2>&1; then
        echo "GOAL9D_DOCKER_RESOURCE_COLLISION" >&2
        exit 1
    fi
done
if docker volume inspect "$volume_name" >/dev/null 2>&1 \
    || docker network inspect "$network_name" >/dev/null 2>&1; then
    echo "GOAL9D_DOCKER_RESOURCE_COLLISION" >&2
    exit 1
fi

openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 2 \
    -subj "/CN=Tetris Goal 9D Test CA" \
    -keyout "${temporary_directory}/ca.key" \
    -out "$ca_certificate" >/dev/null 2>&1
openssl req -newkey rsa:2048 -sha256 -nodes \
    -subj "/CN=${database_container}" \
    -keyout "${temporary_directory}/server.key" \
    -out "${temporary_directory}/server.csr" >/dev/null 2>&1
printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\n' "$database_container" \
    > "${temporary_directory}/server.ext"
openssl x509 -req -sha256 -days 2 \
    -in "${temporary_directory}/server.csr" \
    -CA "$ca_certificate" \
    -CAkey "${temporary_directory}/ca.key" \
    -CAcreateserial \
    -extfile "${temporary_directory}/server.ext" \
    -out "${temporary_directory}/server.crt" >/dev/null 2>&1
chmod 600 "${temporary_directory}/ca.key" "${temporary_directory}/server.key"

docker build --pull --tag "$image_tag" "$ROOT"
image_created=true
docker run --rm --entrypoint sh "$image_tag" -c '
    ! command -v postgres
    ! command -v initdb
    ! env | grep -Eq "^(DATABASE_URL|MIGRATION_DATABASE_URL|IMPORT_DATABASE_URL|PGPASSWORD)="
    test ! -d /var/lib/postgresql/data
    test ! -d /app/src
    test ! -d /app/test
    test ! -d /app/e2e
'
docker run --rm "$image_tag" node -e '
const runtime = require("./dist/server/server/services/runtimeEventStorage.js");
const ticker = require("./dist/server/server/services/authoritativeTickerService.js");
if (runtime.POSTGRES_RUNTIME_POOL_MAX !== 4 ||
    runtime.POSTGRES_RUNTIME_IN_FLIGHT_MAX !== 16 ||
    ticker.AUTHORITATIVE_TICK_MS !== 100) process.exit(1);
'

docker network create \
    --label com.sleepingco.tetris.scope=goal9d-test \
    "$network_name" >/dev/null
network_created=true
docker volume create \
    --label com.sleepingco.tetris.scope=goal9d-test \
    "$volume_name" >/dev/null
volume_created=true
docker run --detach \
    --name "$database_container" \
    --label com.sleepingco.tetris.scope=goal9d-test \
    --network "$network_name" \
    --network-alias "$database_container" \
    --env "POSTGRES_PASSWORD=${admin_password}" \
    --volume "${volume_name}:/var/lib/postgresql/data" \
    --mount "type=bind,src=${temporary_directory},dst=/goal9d-host-certs,readonly" \
    --entrypoint /bin/sh \
    "$POSTGRES_IMAGE" \
    -c 'set -eu
        mkdir -p /goal9d-certs
        cp /goal9d-host-certs/server.crt /goal9d-certs/server.crt
        cp /goal9d-host-certs/server.key /goal9d-certs/server.key
        chown postgres:postgres /goal9d-certs/server.crt /goal9d-certs/server.key
        chmod 600 /goal9d-certs/server.key
        exec docker-entrypoint.sh postgres -c ssl=on \
            -c ssl_cert_file=/goal9d-certs/server.crt \
            -c ssl_key_file=/goal9d-certs/server.key' >/dev/null
database_created=true

database_ready=false
for _ in $(seq 1 100); do
    if docker exec "$database_container" \
        pg_isready --quiet --username postgres --dbname postgres; then
        database_ready=true
        break
    fi
    sleep 0.2
done
"$database_ready"

docker exec -i "$database_container" \
    psql --quiet --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
    >/dev/null <<SQL
CREATE ROLE ${migration_role}
    LOGIN PASSWORD '${migration_password}'
    NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE ${runtime_role}
    LOGIN PASSWORD '${runtime_password}'
    NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE ${maintenance_role}
    LOGIN PASSWORD '${maintenance_password}'
    NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE ${database_name} OWNER ${migration_role};
REVOKE ALL ON DATABASE ${database_name} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${database_name}
    TO ${runtime_role}, ${maintenance_role};
ALTER ROLE ${migration_role} IN DATABASE ${database_name}
    SET search_path TO tetris_analytics, pg_catalog;
ALTER ROLE ${runtime_role} IN DATABASE ${database_name}
    SET search_path TO tetris_analytics, pg_catalog;
ALTER ROLE ${maintenance_role} IN DATABASE ${database_name}
    SET search_path TO tetris_analytics, pg_catalog;
SQL

migration_url="postgresql://${migration_role}:${migration_password}@${database_container}:5432/${database_name}?sslmode=verify-full"
runtime_url="postgresql://${runtime_role}:${runtime_password}@${database_container}:5432/${database_name}?sslmode=verify-full"

run_migration() {
    docker run --rm \
        --network "$network_name" \
        --mount "type=bind,src=${ca_certificate},dst=/run/secrets/goal9d-ca.crt,readonly" \
        --env NODE_EXTRA_CA_CERTS=/run/secrets/goal9d-ca.crt \
        --env "MIGRATION_DATABASE_URL=${migration_url}" \
        "$image_tag" node dist/server/server/db/migrateCli.js
}

migration_first="$(run_migration)"
migration_second="$(run_migration)"
test "$migration_first" = "PostgreSQL migrations applied=2 skipped=0"
test "$migration_second" = "PostgreSQL migrations applied=0 skipped=2"

docker exec -i "$database_container" \
    psql --quiet --set ON_ERROR_STOP=1 --username postgres --dbname "$database_name" \
    >/dev/null <<SQL
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA tetris_analytics TO ${runtime_role}, ${maintenance_role};
GRANT INSERT (
    identity_version, event_id, event_type, schema_version, game_id,
    player_id, piece_index, trust_level, occurred_at, payload, event_sha256
) ON tetris_analytics.game_events TO ${runtime_role};
GRANT SELECT (
    event_id, event_type, game_id, player_id, piece_index, event_sha256
) ON tetris_analytics.game_events TO ${runtime_role};
GRANT SELECT (version, name, checksum)
    ON tetris_analytics.schema_migrations TO ${runtime_role};
GRANT SELECT, DELETE ON tetris_analytics.game_events TO ${maintenance_role};
SQL

start_application() {
    if ! docker container inspect "$application_container" >/dev/null 2>&1; then
        docker run --detach \
            --read-only \
            --name "$application_container" \
            --label com.sleepingco.tetris.scope=goal9d-test \
            --network "$network_name" \
            --publish 127.0.0.1:5510:5500 \
            --mount "type=bind,src=${ca_certificate},dst=/run/secrets/goal9d-ca.crt,readonly" \
            --env NODE_EXTRA_CA_CERTS=/run/secrets/goal9d-ca.crt \
            --env NODE_ENV=production \
            --env GAME_EVENT_STORAGE=postgres \
            --env "DATABASE_URL=${runtime_url}" \
            --env SOCKET_ALLOWED_ORIGINS=http://127.0.0.1:5510 \
            --env CSP_CONNECT_ORIGINS=ws://127.0.0.1:5510 \
            --env SOCKET_RATE_LIMIT_PROFILE=test \
            "$image_tag" >/dev/null
        application_created=true
    else
        docker start "$application_container" >/dev/null
    fi

    application_ready=false
    for _ in $(seq 1 150); do
        if curl --fail --silent --show-error http://127.0.0.1:5510/ >/dev/null 2>&1; then
            application_ready=true
            break
        fi
        if test "$(docker inspect --format '{{.State.Running}}' "$application_container")" != true; then
            docker logs "$application_container"
            return 1
        fi
        sleep 0.1
    done
    "$application_ready"
}

stop_application() {
    started_at="$(node -e 'process.stdout.write(String(Date.now()))')"
    docker stop --time 8 "$application_container" >/dev/null
    finished_at="$(node -e 'process.stdout.write(String(Date.now()))')"
    shutdown_milliseconds=$((finished_at - started_at))
    test "$shutdown_milliseconds" -lt 8000 || {
        echo "GOAL9D_SHUTDOWN_DEADLINE_EXCEEDED" >&2
        return 1
    }
    test "$(docker inspect --format '{{.State.ExitCode}}' "$application_container")" = 0 || {
        echo "GOAL9D_SHUTDOWN_EXIT_NONZERO" >&2
        return 1
    }
    open_pool_connections="$(docker exec "$database_container" \
        psql --quiet --tuples-only --no-align \
        --username postgres --dbname "$database_name" \
        --command "SELECT pg_catalog.count(*) FROM pg_catalog.pg_stat_activity WHERE application_name = 'tetris-goal9b-runtime';")"
    test "$open_pool_connections" = 0 || {
        echo "GOAL9D_POOL_CONNECTIONS_REMAIN" >&2
        return 1
    }
    printf '[test:docker:postgres] shutdown_ms=%s pool_connections=0\n' \
        "$shutdown_milliseconds"
}

event_snapshot() {
    docker exec "$database_container" \
        psql --quiet --tuples-only --no-align \
        --username postgres --dbname "$1" --command "
            SELECT pg_catalog.count(*) || ':' ||
                   pg_catalog.md5(COALESCE(
                       pg_catalog.string_agg(
                           event_id || event_sha256,
                           '' ORDER BY event_id
                       ),
                       ''
                   ))
            FROM tetris_analytics.game_events;"
}

start_application
test "$(docker inspect --format '{{.Config.User}}' "$application_container")" = node
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$application_container")" = true
test -z "$(docker inspect --format \
    '{{range .Mounts}}{{if eq .Destination "/app/data/logs"}}{{.Destination}}{{end}}{{end}}' \
    "$application_container")"
docker exec "$application_container" sh -c \
    'test ! -e /app/data/logs/game-events.jsonl && test ! -w /app/dist'

for path in \
    / \
    /pages/index.html \
    /pages/multiLobby.html \
    /pages/tetrisSingle.html \
    /pages/tetrisMulti.html \
    /socket.io/socket.io.js
do
    curl --fail --silent --show-error "http://127.0.0.1:5510${path}" >/dev/null
done
headers="${temporary_directory}/headers.txt"
root_html="$(curl --fail --silent --show-error \
    --dump-header "$headers" http://127.0.0.1:5510/)"
grep -qi '^Content-Security-Policy: ' "$headers"
grep -qi '^X-Content-Type-Options: nosniff' "$headers"
grep -qi '^X-Frame-Options: DENY' "$headers"
module_path="$(printf '%s' "$root_html" \
    | sed -n 's/.*src="\([^"]*\.js\)".*/\1/p' \
    | head -n 1)"
test -n "$module_path"
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    http://127.0.0.1:5510/pages/index.tsx)" = 404
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    "http://127.0.0.1:5510${module_path}.map")" = 404

PLAYWRIGHT_EXTERNAL_SERVER=1 npx --no-install playwright test \
    e2e/multiplayerGameOver.spec.js \
    e2e/multiplayerPve.spec.js \
    --grep 'server game over|PVE server gameOver'

stop_application

event_counts="$(docker exec "$database_container" \
    psql --quiet --tuples-only --no-align --field-separator '|' \
    --username postgres --dbname "$database_name" --command "
        SELECT
            pg_catalog.count(*) FILTER (
                WHERE event_type = 'game_start' AND payload->>'mode' = 'multi'
            ),
            pg_catalog.count(*) FILTER (
                WHERE event_type = 'placement_decision' AND payload->>'mode' = 'multi'
            ),
            pg_catalog.count(*) FILTER (
                WHERE event_type = 'game_over' AND payload->>'mode' = 'multi'
            ),
            pg_catalog.count(*) FILTER (
                WHERE event_type = 'game_start' AND payload->>'mode' = 'pve'
            ),
            pg_catalog.count(*) FILTER (
                WHERE event_type = 'placement_decision' AND payload->>'mode' = 'pve'
            ),
            pg_catalog.count(*) FILTER (
                WHERE event_type = 'game_over' AND payload->>'mode' = 'pve'
            )
        FROM tetris_analytics.game_events;")"
IFS='|' read -r pvp_start pvp_placement pvp_over pve_start pve_placement pve_over \
    <<< "$event_counts"
for count in \
    "$pvp_start" "$pvp_placement" "$pvp_over" \
    "$pve_start" "$pve_placement" "$pve_over"
do
    test "$count" -gt 0 || {
        echo "GOAL9D_EVENT_COUNT_INVALID" >&2
        exit 1
    }
done

privacy_count="$(docker exec "$database_container" \
    psql --quiet --tuples-only --no-align \
    --username postgres --dbname "$database_name" --command "
        SELECT pg_catalog.count(*)
        FROM tetris_analytics.game_events
        WHERE payload::text ~* 'nickname|token|socketid|cookie|useragent';")"
test "$privacy_count" = 0 || {
    echo "GOAL9D_PRIVACY_CHECK_FAILED" >&2
    exit 1
}
duplicate_count="$(docker exec "$database_container" \
    psql --quiet --tuples-only --no-align \
    --username postgres --dbname "$database_name" --command "
        SELECT pg_catalog.count(*) - pg_catalog.count(DISTINCT event_id)
        FROM tetris_analytics.game_events;")"
test "$duplicate_count" = 0 || {
    echo "GOAL9D_DUPLICATE_CHECK_FAILED" >&2
    exit 1
}
row_snapshot="$(event_snapshot "$database_name")"
test -n "$row_snapshot" || {
    echo "GOAL9D_ROW_SNAPSHOT_EMPTY" >&2
    exit 1
}

docker exec "$database_container" pg_dump \
    --format custom --username postgres "$database_name" > "$backup_file"
docker exec "$database_container" createdb \
    --username postgres "$restore_database"
docker exec -i "$database_container" pg_restore \
    --username postgres --dbname "$restore_database" \
    --no-owner --exit-on-error < "$backup_file"
restore_snapshot="$(event_snapshot "$restore_database")"
test "$restore_snapshot" = "$row_snapshot" || {
    echo "GOAL9D_RESTORE_SNAPSHOT_MISMATCH" >&2
    exit 1
}

start_application
restart_snapshot="$(event_snapshot "$database_name")"
test "$restart_snapshot" = "$row_snapshot" || {
    echo "GOAL9D_RESTART_SNAPSHOT_MISMATCH" >&2
    exit 1
}
docker exec "$application_container" \
    test ! -e /app/data/logs/game-events.jsonl || {
        echo "GOAL9D_JSONL_FILE_CREATED" >&2
        exit 1
    }

docker pause "$database_container" >/dev/null
set +e
PLAYWRIGHT_EXTERNAL_SERVER=1 npx --no-install playwright test \
    e2e/multiplayerPve.spec.js \
    --grep 'PVE normal'
db_down_status=$?
set -e
docker unpause "$database_container" >/dev/null
test "$db_down_status" = 0
docker logs "$application_container" > "$application_log" 2>&1
grep -q 'write_failed code=POSTGRES_EVENT_APPEND_FAILED' "$application_log"
grep -q 'attempts=3' "$application_log"
for secret in \
    "$admin_password" "$migration_password" "$runtime_password" \
    "$maintenance_password" 'postgresql://'
do
    if grep -Fq "$secret" "$application_log"; then
        echo "GOAL9D_CREDENTIAL_LOGGED" >&2
        exit 1
    fi
done
if grep -Eqi 'boardBefore|boardAfter|nickname|socketId|userAgent' "$application_log"; then
    echo "GOAL9D_PAYLOAD_LOGGED" >&2
    exit 1
fi

docker exec -i "$database_container" \
    psql --quiet --set ON_ERROR_STOP=1 --username postgres --dbname "$database_name" \
    >/dev/null <<'SQL'
INSERT INTO tetris_analytics.game_events (
    identity_version, event_id, event_type, schema_version, game_id,
    player_id, piece_index, trust_level, occurred_at, payload,
    event_sha256, ingested_at
) VALUES (
    'identity-v1', repeat('a', 64), 'game_start', 1, 'goal9d-retention-synthetic',
    NULL, NULL, 'server_authoritative',
    pg_catalog.clock_timestamp() - interval '91 days',
    '{"mode":"multi","synthetic":true}'::jsonb,
    repeat('b', 64),
    pg_catalog.clock_timestamp() - interval '91 days'
);
SQL

if docker exec "$database_container" \
    psql --quiet --set ON_ERROR_STOP=1 \
    --username "$runtime_role" --dbname "$database_name" \
    --command "DELETE FROM tetris_analytics.game_events WHERE event_id = repeat('a', 64);" \
    >/dev/null 2>&1; then
    echo "GOAL9D_RUNTIME_DELETE_ALLOWED" >&2
    exit 1
fi

cutoff="$(node -e \
    'process.stdout.write(new Date(Date.now() - 90 * 86400000).toISOString())')"
retention_dry_run="$(docker exec -i "$database_container" \
    psql --quiet --tuples-only --no-align --field-separator '|' \
    --set ON_ERROR_STOP=1 \
    --set "cutoff=${cutoff}" \
    --set max_rows=10 \
    --set max_bytes=1048576 \
    --username "$maintenance_role" --dbname "$database_name" <<'SQL'
PREPARE goal9d_retention_dry_run(timestamptz, bigint, bigint) AS
WITH candidates AS (
    SELECT event_id, pg_catalog.pg_column_size(game_events) AS row_bytes
    FROM tetris_analytics.game_events
    WHERE ingested_at < $1
    ORDER BY ingested_at, event_id
    LIMIT $2
)
SELECT pg_catalog.count(*), COALESCE(pg_catalog.sum(row_bytes), 0)
FROM candidates
HAVING pg_catalog.count(*) <= $2
   AND COALESCE(pg_catalog.sum(row_bytes), 0) <= $3;
EXECUTE goal9d_retention_dry_run(:'cutoff', :max_rows, :max_bytes);
SQL
)"
test "${retention_dry_run%%|*}" = 1
first_confirmation="DELETE_SYNTHETIC_GOAL9D"
second_confirmation="DELETE_SYNTHETIC_GOAL9D"
test "$first_confirmation" = DELETE_SYNTHETIC_GOAL9D
test "$second_confirmation" = DELETE_SYNTHETIC_GOAL9D
retention_deleted="$(docker exec -i "$database_container" \
    psql --quiet --tuples-only --no-align \
    --set ON_ERROR_STOP=1 \
    --set "cutoff=${cutoff}" \
    --set max_rows=10 \
    --set max_bytes=1048576 \
    --username "$maintenance_role" --dbname "$database_name" <<'SQL'
PREPARE goal9d_retention_delete(timestamptz, bigint, bigint) AS
WITH ordered_candidates AS (
    SELECT
        event_id,
        pg_catalog.sum(pg_catalog.pg_column_size(game_events)) OVER (
            ORDER BY ingested_at, event_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_bytes
    FROM tetris_analytics.game_events
    WHERE ingested_at < $1
    ORDER BY ingested_at, event_id
    LIMIT $2
), bounded_candidates AS (
    SELECT event_id
    FROM ordered_candidates
    WHERE cumulative_bytes <= $3
)
DELETE FROM tetris_analytics.game_events AS game_events
USING bounded_candidates
WHERE game_events.event_id = bounded_candidates.event_id
RETURNING game_events.event_id;
EXECUTE goal9d_retention_delete(:'cutoff', :max_rows, :max_bytes);
SQL
)"
test "$retention_deleted" = "$(printf 'a%.0s' $(seq 1 64))"

stop_application
relation_bytes="$(docker exec "$database_container" \
    psql --quiet --tuples-only --no-align \
    --username postgres --dbname "$database_name" --command "
        SELECT pg_catalog.pg_total_relation_size(
            'tetris_analytics.game_events'::regclass
        );")"
printf '[test:docker:postgres] events=%s relation_bytes=%s privacy=0 duplicates=0 verification=complete\n' \
    "${row_snapshot%%:*}" "$relation_bytes"
