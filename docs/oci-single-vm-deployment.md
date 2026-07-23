# OCI 단일 VM 배포 Runbook

2026-07-23~24 실제 실행 과정과 실패 원인은
[OCI 단일 VM 운영 배포 실행 기록](oci-production-deployment-session-2026-07-24.md)에
정리되어 있다.
명령과 option의 의미는
[OCI 운영 배포 명령어 해설](oci-production-deployment-command-guide-2026-07-24.md)에
정리되어 있다.

## 고정 경계

- VM: 기존 OCI `VM.Standard.E2.1.Micro` 한 대
- 공개 주소: `https://tetra-arena.duckdns.org`
- 공개 포트: `80`, `443`
- 비공개 포트: application `5500`, PostgreSQL `5432`
- 초기 sink: JSONL
- 최종 승인 후 sink: PostgreSQL
- JSONL과 PostgreSQL dual-write는 하지 않는다.

현재 VM은 RAM 954 MiB, swap 0, boot volume 여유 42 GiB다. 운영 전 2 GiB
swap을 추가하고 app 320 MiB, PostgreSQL 256 MiB, Caddy 96 MiB 제한을
사용한다. 지속적인 swap 증가나 전체 memory 85% 이상이면 PostgreSQL
cutover를 중단한다.

## 1. VM 준비

아래 변경 전에는 OCI Security List에서 TCP 80/443이 열려 있어야 한다.
현재 `22` source가 `0.0.0.0/0`이므로 두 번째 SSH 연결을 확인한 뒤 운영자
공인 IPv4 `/32`로 제한한다. DuckDNS token이 terminal, log 또는 repository에
노출됐다면 먼저 재발급하고 새 token은 repository에 저장하지 않는다.
DNS A record가 VM public IP와 같은지 확인한다.

```bash
getent ahostsv4 tetra-arena.duckdns.org

sudo apt update
sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y
sudo apt install -y docker-compose-v2

sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
grep -q '^/swapfile ' /etc/fstab \
    || printf '/swapfile none swap sw 0 0\n' | sudo tee -a /etc/fstab

sudo iptables -C INPUT -p tcp -m multiport --dports 80,443 \
    -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 5 -p tcp -m multiport --dports 80,443 \
        -m conntrack --ctstate NEW -j ACCEPT
sudo netfilter-persistent save

sudo install -d -o ubuntu -g ubuntu -m 750 /srv/tetris
sudo install -d -o ubuntu -g ubuntu -m 700 \
    /srv/tetris/secrets /srv/tetris/certs /srv/tetris/backups \
    /srv/tetris/import /srv/tetris/import/source /srv/tetris/import/reports
```

`/var/run/reboot-required`가 생기면 재부팅하고 Docker, swap, firewall 규칙을
다시 확인한다.

## 2. 저장소와 JSONL 기준선

배포 branch가 main에 반영된 뒤 정확한 main SHA를 사용한다.

```bash
cd /srv/tetris
git clone git@github.com:Sleepingco/Tetris_multi.git repository
cd repository
git switch --detach <approved-main-sha>

APP_IMAGE_TAG=<approved-main-sha> \
    sudo -E docker compose -f compose.jsonl.yml build app
APP_IMAGE_TAG=<approved-main-sha> \
    sudo -E docker compose -f compose.jsonl.yml up -d
```

확인:

```bash
sudo docker compose -f compose.jsonl.yml ps
curl --fail --silent --show-error https://tetra-arena.duckdns.org/ >/dev/null
sudo docker inspect tetris-app-1 \
    --format 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}}'
```

Single/PVP/PVE를 확인하고 container restart 뒤에도 `tetris_game_events`
volume의 JSONL hash prefix가 유지되는지 검증한다. 이 상태의 application
image ID를 rollback 기준으로 기록한다.

## 3. PostgreSQL secret과 private CA

아래 secret 원문은 terminal output, repository, image와 운영 기록에 남기지
않는다. password는 URL quoting이 필요 없는 hex로 생성한다.

```bash
umask 077
openssl rand -hex 24 > /srv/tetris/secrets/postgres-admin-password
openssl rand -hex 24 > /srv/tetris/secrets/migration-password
openssl rand -hex 24 > /srv/tetris/secrets/runtime-password
openssl rand -hex 24 > /srv/tetris/secrets/import-password
openssl rand -hex 24 > /srv/tetris/secrets/maintenance-password

openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
    -subj '/CN=Tetris PostgreSQL Private CA' \
    -keyout /srv/tetris/certs/ca.key \
    -out /srv/tetris/certs/ca.crt
openssl req -newkey rsa:2048 -sha256 -nodes \
    -subj '/CN=postgres' \
    -keyout /srv/tetris/certs/postgres.key \
    -out /srv/tetris/certs/postgres.csr
printf 'subjectAltName=DNS:postgres\nextendedKeyUsage=serverAuth\n' \
    > /srv/tetris/certs/postgres.ext
openssl x509 -req -sha256 -days 825 \
    -in /srv/tetris/certs/postgres.csr \
    -CA /srv/tetris/certs/ca.crt \
    -CAkey /srv/tetris/certs/ca.key \
    -CAcreateserial \
    -extfile /srv/tetris/certs/postgres.ext \
    -out /srv/tetris/certs/postgres.crt
chmod 600 /srv/tetris/certs/ca.key /srv/tetris/certs/postgres.key
chmod 644 /srv/tetris/certs/ca.crt /srv/tetris/certs/postgres.crt
openssl x509 -in /srv/tetris/certs/postgres.crt \
    -noout -checkhost postgres
```

runtime, migration, import credential은 서로 다른 파일에 둔다. 아래 명령은
hex password라 URL encoding이 필요 없다는 전제다. 이 파일은 Git에 추가하지
않는다.

```bash
approved_sha=<approved-main-sha>
printf 'APP_IMAGE_TAG=%s\nDATABASE_URL=postgresql://tetris_runtime:%s@postgres:5432/tetris?sslmode=verify-full\n' \
    "$approved_sha" "$(cat /srv/tetris/secrets/runtime-password)" \
    > /srv/tetris/secrets/production.env
printf 'MIGRATION_DATABASE_URL=postgresql://tetris_migration:%s@postgres:5432/tetris?sslmode=verify-full\n' \
    "$(cat /srv/tetris/secrets/migration-password)" \
    > /srv/tetris/secrets/migration.env
printf 'IMPORT_DATABASE_URL=postgresql://tetris_import:%s@postgres:5432/tetris?sslmode=verify-full\n' \
    "$(cat /srv/tetris/secrets/import-password)" \
    > /srv/tetris/secrets/import.env
chmod 600 /srv/tetris/secrets/*.env
```

## 4. PostgreSQL provisioning

PostgreSQL만 먼저 시작한다.

```bash
cd /srv/tetris/repository
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml up -d postgres
```

`tetris_migration`, `tetris_runtime`, `tetris_import`,
`tetris_maintenance` role과 `tetris` database를 만든다. 아래 명령은 최초
provisioning에서 한 번만 실행한다.

```bash
migration_password=$(cat /srv/tetris/secrets/migration-password)
runtime_password=$(cat /srv/tetris/secrets/runtime-password)
import_password=$(cat /srv/tetris/secrets/import-password)
maintenance_password=$(cat /srv/tetris/secrets/maintenance-password)

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml exec -T postgres \
    psql --set ON_ERROR_STOP=1 --username postgres --dbname postgres <<SQL
CREATE ROLE tetris_migration LOGIN PASSWORD '${migration_password}'
    NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE tetris_runtime LOGIN PASSWORD '${runtime_password}'
    NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE tetris_import LOGIN PASSWORD '${import_password}'
    NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE tetris_maintenance LOGIN PASSWORD '${maintenance_password}'
    NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE tetris OWNER tetris_migration;
REVOKE ALL ON DATABASE tetris FROM PUBLIC;
GRANT CONNECT ON DATABASE tetris
    TO tetris_runtime, tetris_import, tetris_maintenance;
ALTER ROLE tetris_migration IN DATABASE tetris
    SET search_path TO tetris_analytics, pg_catalog;
ALTER ROLE tetris_runtime IN DATABASE tetris
    SET search_path TO tetris_analytics, pg_catalog;
ALTER ROLE tetris_import IN DATABASE tetris
    SET search_path TO tetris_analytics, pg_catalog;
ALTER ROLE tetris_maintenance IN DATABASE tetris
    SET search_path TO tetris_analytics, pg_catalog;
SQL
unset migration_password runtime_password import_password maintenance_password
```

migration은 application 시작과 분리해 같은 image로 두 번 실행한다.

```bash
sudo docker run --rm \
    --network tetris_database \
    --mount type=bind,src=/srv/tetris/certs/ca.crt,dst=/run/secrets/postgres-ca.crt,readonly \
    --env-file /srv/tetris/secrets/migration.env \
    --env NODE_EXTRA_CA_CERTS=/run/secrets/postgres-ca.crt \
    tetris-app:<approved-main-sha> \
    node dist/server/server/db/migrateCli.js
```

첫 실행은 migration을 적용하고 두 번째 실행은 모두 `skipped`여야 한다.
그 뒤 최소 권한을 부여한다.

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml exec -T postgres \
    psql --set ON_ERROR_STOP=1 --username postgres --dbname tetris <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA tetris_analytics
    TO tetris_runtime, tetris_import, tetris_maintenance;
GRANT INSERT (
    identity_version, event_id, event_type, schema_version, game_id,
    player_id, piece_index, trust_level, occurred_at, payload, event_sha256
) ON tetris_analytics.game_events TO tetris_runtime, tetris_import;
GRANT SELECT (
    event_id, event_type, game_id, player_id, piece_index, event_sha256
) ON tetris_analytics.game_events TO tetris_runtime, tetris_import;
GRANT SELECT (version, name, checksum)
    ON tetris_analytics.schema_migrations TO tetris_runtime;
GRANT SELECT, DELETE
    ON tetris_analytics.game_events TO tetris_maintenance;
SQL
```

`SET ROLE`로 runtime의 version 조회와 import의 `INSERT`/`SELECT`가
성공하는지 확인한다. runtime의 DDL/UPDATE/DELETE/TRUNCATE와 import의
UPDATE/DELETE, maintenance의 INSERT/UPDATE가 거부되어야 한다.

## 5. Backup/restore와 JSONL import

JSONL 원본은 app을 잠시 pause한 뒤 immutable snapshot으로 복사한다.

```bash
app_id=$(sudo docker compose -f compose.jsonl.yml ps -q app)
sudo docker compose -f compose.jsonl.yml pause app
sudo docker cp \
    "$app_id:/app/data/logs/game-events.jsonl" \
    /srv/tetris/import/source/game-events.jsonl
sudo docker compose -f compose.jsonl.yml unpause app
sudo chown ubuntu:ubuntu /srv/tetris/import/source/game-events.jsonl
sudo chmod 400 /srv/tetris/import/source/game-events.jsonl
sha256sum /srv/tetris/import/source/game-events.jsonl
```

import image에는 source와 report directory만 mount한다. OCI의 `ubuntu`와
image의 `node`는 numeric UID가 다르므로 host 사용자의 UID/GID로 실행한다.

```bash
sudo docker run --rm \
    --user "$(id -u):$(id -g)" \
    --mount type=bind,src=/srv/tetris/import/source,dst=/import/source,readonly \
    --mount type=bind,src=/srv/tetris/import/reports,dst=/import/reports \
    tetris-app:<approved-main-sha> \
    node dist/server/server/db/importJsonl.js \
    --dry-run --report /import/reports/dry-run.json \
    /import/source/game-events.jsonl
```

dry-run 결과 승인 뒤 import 전 backup과 restore rehearsal을 수행한다.

```bash
backup_file=/srv/tetris/backups/pre-import-$(date -u +%Y%m%dT%H%M%SZ).dump
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml exec -T postgres \
    pg_dump --username postgres --dbname tetris --format=custom \
    > "$backup_file"
chmod 400 "$backup_file"
sha256sum "$backup_file"

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml exec -T postgres \
    createdb --username postgres --owner tetris_migration tetris_restore_check
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml exec -T postgres \
    pg_restore --username postgres --dbname tetris_restore_check \
    --exit-on-error \
    < "$backup_file"
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml exec -T postgres \
    psql --username postgres --dbname tetris_restore_check \
    --command 'SELECT count(*) FROM tetris_analytics.game_events;'
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml exec -T postgres \
    dropdb --username postgres --force tetris_restore_check
```

restore가 성공한 뒤 import를 실행한다.

```bash
sudo docker run --rm \
    --user "$(id -u):$(id -g)" \
    --network tetris_database \
    --mount type=bind,src=/srv/tetris/certs/ca.crt,dst=/run/secrets/postgres-ca.crt,readonly \
    --mount type=bind,src=/srv/tetris/import/source,dst=/import/source,readonly \
    --mount type=bind,src=/srv/tetris/import/reports,dst=/import/reports \
    --env-file /srv/tetris/secrets/import.env \
    --env NODE_EXTRA_CA_CERTS=/run/secrets/postgres-ca.crt \
    tetris-app:<approved-main-sha> \
    node dist/server/server/db/importJsonl.js \
    --report /import/reports/import.json /import/source/game-events.jsonl
```

같은 입력을 다시 실행해 전부 duplicate인지 확인한다. 원본 SHA-256,
row count와 completeness 결과가 예상과 다르면 cutover를 중단한다.

## 6. PostgreSQL single-sink cutover

짧은 maintenance window에서 JSONL app을 정상 종료한 뒤 PostgreSQL
Compose로 바꾼다.

```bash
sudo docker compose -f compose.jsonl.yml down
APP_IMAGE_TAG=<approved-main-sha> \
    sudo -E docker compose \
        --env-file /srv/tetris/secrets/production.env \
        -f compose.production.yml up -d
```

app container에는 JSONL volume이 없어야 하고 PostgreSQL은 host port를
publish하지 않아야 한다. HTTPS/WSS, Single/PVP/PVE, synthetic event,
restart row 보존, SIGTERM exit `0`, `OOMKilled=false`, pool connection `0`,
CPU/RAM/swap/disk를 확인한다.

## 7. Rollback

실패하면 PostgreSQL app을 정상 종료하고 보존한 JSONL volume과 승인된
이전 image로 복귀한다.

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml down
APP_IMAGE_TAG=<approved-main-sha> \
    sudo -E docker compose -f compose.jsonl.yml up -d
```

PostgreSQL row, data volume과 기존 JSONL은 삭제하지 않는다.
