# PostgreSQL Event Storage 운영 Runbook

이 문서는 2026-07-24 활성화한 OCI 단일 VM production 운영 기준이다.

- 공개 주소: `https://tetra-arena.duckdns.org`
- application sink: PostgreSQL single-sink
- application image 기준선: `tetris-app:2411cd3`
- PostgreSQL: Docker internal network의 17.10
- public ingress: Caddy의 80/443만 사용
- PostgreSQL 5432: host에 publish하지 않음
- Compose: `/srv/tetris/repository/compose.production.yml`
- production env: `/srv/tetris/secrets/production.env`
- backup: `/srv/tetris/backups`

최초 배포 과정은 [OCI 배포 실행 기록](../history/oci/oci-production-deployment-session-2026-07-24.md),
명령 설명은 [OCI 배포 명령어 해설](../history/oci/oci-production-deployment-command-guide-2026-07-24.md),
장애 원인은 [OCI 배포 트러블슈팅 기록](../history/oci/oci-production-deployment-troubleshooting-2026-07-24.md)을
참고한다. 구현 계약은
[PostgreSQL event storage blueprint](../database/database-event-storage-blueprint.md), local
rehearsal은 [production boundary script](../../../scripts/verify-postgres-production.sh)를
기준으로 한다.

## 운영 원칙

1. 정상 운영 중에는 `compose.production.yml`만 사용한다.
2. application에는 runtime credential만 전달한다.
3. migration은 application 시작과 분리해 명시적으로 실행한다.
4. backup 파일의 존재만 믿지 않고 임시 DB restore를 정기적으로 확인한다.
5. rollback에서 PostgreSQL row, volume과 JSONL 보존본을 삭제하지 않는다.
6. 실제 사용자 data 삭제는 자동화하지 않는다.
7. 명령 실행 전 prompt가 OCI인지 확인한다.

```text
ubuntu@primary-vnic:/srv/tetris/repository$
```

다음 명령은 운영 중 실행하지 않는다.

```text
docker compose down -v
docker volume prune
docker system prune --volumes
DROP DATABASE tetris
TRUNCATE tetris_analytics.game_events
```

## 운영 주기

| 주기 | 작업 |
|---|---|
| 매일 또는 접속할 때 | container health, HTTPS, DB 최신 row, RAM/swap/disk 확인 |
| 주 1회 | custom-format backup, hash와 dump 목록 확인 |
| 월 1회 | 최신 backup을 임시 DB에 restore해 row와 owner 확인 |
| 새 버전 배포 전 | local verify, production backup, migration 두 번, app만 교체 |
| OS/kernel update | maintenance 시간 확보, backup 후 upgrade/reboot, 전체 재검증 |
| 장애 발생 시 | 상태를 보존하고 service별 inspect/log 확인, volume 삭제 금지 |

자동 backup·retention·무중단 배포는 아직 구성하지 않았다. 현재는 아래 절차를
운영자가 수동으로 실행한다.

## 일상 점검

### 1. service와 HTTPS

```bash
cd /srv/tetris/repository

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    ps

curl -fsS \
    --retry 3 \
    --retry-delay 2 \
    --retry-all-errors \
    -o /dev/null \
    -w 'HTTPS_STATUS=%{http_code}\n' \
    https://tetra-arena.duckdns.org
```

정상 기준:

```text
app       healthy
postgres  healthy
caddy     running
HTTPS_STATUS=200
```

### 2. DB row와 최신 저장 시각

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    psql \
    --username postgres \
    --dbname tetris \
    --tuples-only \
    --no-align \
    --field-separator='|' \
    --command="
        SELECT
            'events',
            count(*),
            coalesce(max(ingested_at)::text, 'none')
        FROM tetris_analytics.game_events;

        SELECT
            event_type,
            count(*)
        FROM tetris_analytics.game_events
        GROUP BY event_type
        ORDER BY event_type;
    "
```

row count는 계속 증가할 수 있다. 실제 게임이 있었는데 최신 `ingested_at`이
갱신되지 않으면 application storage log를 확인한다.

### 3. memory, swap과 disk

```bash
free -h
swapon --show
df -h /
sudo docker stats --no-stream
sudo docker system df
```

현재 기준:

- VM available memory가 지속적으로 급감하지 않아야 한다.
- container가 각 memory limit을 넘지 않아야 한다.
- `OOMKilled`가 없어야 한다.
- root filesystem 70%부터 원인을 확인하고, 85%에서는 배포를 중단한다.
- swap 사용 자체보다 지속 증가와 latency 악화를 본다.

OOM 확인:

```bash
for service in app postgres caddy; do
    container_id=$(sudo docker compose \
        --env-file /srv/tetris/secrets/production.env \
        -f compose.production.yml \
        ps -q "$service")

    sudo docker inspect "$container_id" \
        --format \
        "$service status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{end}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}"
done
```

### 4. 최근 storage 오류

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    logs --since=24h app \
    | grep -E \
        'write_failed|write_rejected|POSTGRES_EVENT|IDEMPOTENCY_CONFLICT' \
    || echo "NO_STORAGE_ERRORS_IN_MATCHED_LOGS"
```

`NO_STORAGE_ERRORS_IN_MATCHED_LOGS`만으로 정상이라고 판단하지 않는다. service
health, HTTPS와 DB 최신 row를 함께 확인한다.

## 역할과 credential

서로 다른 credential을 `/srv/tetris/secrets`에서 주입한다. URL, password와
CA private key를 image, repository, CI artifact나 log에 넣지 않는다.

- migration role: `tetris_analytics` schema와 migration/event table owner다. release 단계에서만 `MIGRATION_DATABASE_URL`로 사용하고 application HTTP startup과 동시에 migration을 실행하지 않는다.
- runtime role: 제한된 schema `USAGE`, event column `INSERT`, idempotency와 migration version 확인에 필요한 column `SELECT`만 가진다. DDL, `UPDATE`, `DELETE`, `TRUNCATE`는 허용하지 않는다.
- import role: 검증된 JSONL import에서만 제한된 `INSERT`와 `SELECT`를 사용한다.
- maintenance role: retention 대상 조회와 승인된 `DELETE`만 수행한다. application에 이 credential을 주입하지 않는다.

database와 role의 `search_path`는 `tetris_analytics, pg_catalog`로 제한한다. application query와 운영 query는 계속 schema-qualified 이름을 사용한다. `public` schema의 `CREATE`와 불필요한 `PUBLIC` 권한은 제거한다.

## 연결과 활성화 전 점검

1. provider endpoint의 hostname과 CA chain을 독립 경로로 확인한다.
2. non-loopback 연결은 `sslmode=verify-full` 의미의 certificate chain과 hostname 검증을 모두 요구한다. private/provider CA가 필요한 경우 CA certificate만 read-only secret으로 mount한다.
3. migration role로 migration을 두 번 실행해 첫 실행의 적용과 두 번째 실행의 no-op을 확인한다.
4. runtime role로 schema version 조회와 synthetic event `INSERT`는 허용되고 DDL/`UPDATE`/`DELETE`는 거부되는지 확인한다.
5. application은 `GAME_EVENT_STORAGE=postgres`와 runtime credential만 받고 JSONL writable volume은 mount하지 않는다. health가 green이 된 뒤 synthetic PVP/PVE event chain을 확인한다.
6. pool 4, in-flight 16은 현재 검증값이다. provider latency를 측정한 뒤에만 별도 변경을 승인한다.

새 application version을 활성화하기 전에는 배포할 commit의 [CI](../../../.github/workflows/ci.yml)와 현재 OCI의 TLS·backup·restore 경계를 확인한다.
CI 이름 `Migration CI`는 기존 workflow 식별자이며, 마이그레이션 작업 종료 후에도 아래 검증을 계속 담당한다.

| 검증 범위 | 현재 실행 기준 |
| --- | --- |
| type/build/artifact/compiled test | `bash scripts/verify.sh` |
| source 없는 production release | `npm run test:release` |
| Vite lifecycle·production browser | `npm run test:e2e:vite-dev`, `npm run test:e2e` |
| production container | CI의 `Production container smoke` job |
| 실제 PostgreSQL migration·repository·runtime·import·release | `npm run test:db` |
| 외부 DB container·재시작·장애·backup/restore·retention 경계 | `npm run test:docker:postgres` |

명령의 원천은 [package.json](../../../package.json)과 [production boundary script](../../../scripts/verify-postgres-production.sh)다.
DB 검증은 격리된 테스트 환경에서 실행한다. 테스트가 통과해도 실제 OCI의 TLS·backup·restore 확인을 대체하지 않는다.
[배포 workflow](../../../.github/workflows/deploy-production.yml)는 선택한 commit의 성공한 main push CI를 확인한다.
[당시 Goal 9D](../../archive/migration/goals/09d-postgres-ci-release.md)는 도입 범위의 역사적 근거이며 현재 실행 지침이 아니다.

## Backup과 restore rehearsal

### 주간 custom-format backup

OCI에서 실행한다.

```bash
(
    set -euo pipefail
    umask 077

    timestamp=$(date -u +%Y%m%dT%H%M%SZ)
    backup="/srv/tetris/backups/tetris-${timestamp}.dump"
    temporary="${backup}.tmp"

    test ! -e "$backup"
    test ! -e "$temporary"

    cleanupTemporary() {
        test ! -e "$temporary" \
            || rm -f -- "$temporary"
    }

    trap cleanupTemporary EXIT

    sudo docker compose \
        --env-file /srv/tetris/secrets/production.env \
        -f /srv/tetris/repository/compose.production.yml \
        exec -T postgres \
        pg_dump \
        --username postgres \
        --dbname tetris \
        --format=custom \
        > "$temporary"

    test -s "$temporary"
    mv "$temporary" "$backup"
    chmod 400 "$backup"
    trap - EXIT

    sha256sum "$backup"
    stat -c '%a %U:%G %s %n' "$backup"

    sudo docker compose \
        --env-file /srv/tetris/secrets/production.env \
        -f /srv/tetris/repository/compose.production.yml \
        exec -T postgres \
        pg_restore --list \
        < "$backup" \
        >/dev/null
)
```

성공 조건:

- `.dump`가 0 byte가 아님
- mode `400`, owner `ubuntu`
- SHA-256 출력 보존
- `pg_restore --list` 성공

backup 파일이나 hash를 Git에 넣지 않는다. 오래된 backup을 자동 삭제하지 않는다.
현재 backup은 같은 OCI VM disk에 있으므로 logical 복구에는 쓸 수 있지만 VM이나
boot volume 전체 손실에는 대응하지 못한다. 암호화된 off-VM backup과 자동
schedule은 별도 운영 작업으로 남아 있다.

### DB 내용을 CSV 또는 JSONL로 export

복구가 목적이면 위의 custom-format `.dump`를 사용한다. 사람이 내용을 확인하거나
분석 도구에서 읽는 것이 목적이면 `game_events`를 CSV 또는 JSONL로 export한다.
export 파일은 backup을 대체하지 않는다.

먼저 OCI에 export 전용 directory를 만든다.

```bash
sudo install -d \
    -o ubuntu \
    -g ubuntu \
    -m 700 \
    /srv/tetris/exports
```

CSV는 spreadsheet 또는 일반적인 데이터 분석 도구에서 사용할 때 적합하다.

```bash
(
    set -euo pipefail
    umask 077

    timestamp=$(date -u +%Y%m%dT%H%M%SZ)
    csv_file="/srv/tetris/exports/game-events-${timestamp}.csv"
    temporary="${csv_file}.tmp"

    test ! -e "$csv_file"
    test ! -e "$temporary"

    cleanupTemporary() {
        test ! -e "$temporary" \
            || rm -f -- "$temporary"
    }

    trap cleanupTemporary EXIT

    sudo docker compose \
        --env-file /srv/tetris/secrets/production.env \
        -f /srv/tetris/repository/compose.production.yml \
        exec -T postgres \
        psql \
        --username postgres \
        --dbname tetris \
        --set=ON_ERROR_STOP=1 \
        --csv \
        --pset=footer=off \
        --command='
            SELECT *
            FROM tetris_analytics.game_events
            ORDER BY ingested_at, event_id;
        ' \
        > "$temporary"

    test -s "$temporary"
    mv "$temporary" "$csv_file"
    chmod 400 "$csv_file"
    trap - EXIT

    wc -l "$csv_file"
    sha256sum "$csv_file"
    stat -c '%a %U:%G %s %n' "$csv_file"
)
```

CSV의 첫 줄은 column header이므로 `wc -l` 결과는 실제 DB row 수보다 1 크다.

JSONL은 한 줄에 event 하나가 필요한 기존 로그·ML 분석 경로에 적합하다.

```bash
(
    set -euo pipefail
    umask 077

    timestamp=$(date -u +%Y%m%dT%H%M%SZ)
    jsonl_file="/srv/tetris/exports/game-events-${timestamp}.jsonl"
    temporary="${jsonl_file}.tmp"

    test ! -e "$jsonl_file"
    test ! -e "$temporary"

    cleanupTemporary() {
        test ! -e "$temporary" \
            || rm -f -- "$temporary"
    }

    trap cleanupTemporary EXIT

    sudo docker compose \
        --env-file /srv/tetris/secrets/production.env \
        -f /srv/tetris/repository/compose.production.yml \
        exec -T postgres \
        psql \
        --username postgres \
        --dbname tetris \
        --set=ON_ERROR_STOP=1 \
        --tuples-only \
        --no-align \
        --command='
            SELECT row_to_json(event_row)
            FROM (
                SELECT *
                FROM tetris_analytics.game_events
                ORDER BY ingested_at, event_id
            ) AS event_row;
        ' \
        > "$temporary"

    test -s "$temporary"
    mv "$temporary" "$jsonl_file"
    chmod 400 "$jsonl_file"
    trap - EXIT

    db_rows=$(sudo docker compose \
        --env-file /srv/tetris/secrets/production.env \
        -f /srv/tetris/repository/compose.production.yml \
        exec -T postgres \
        psql \
        --username postgres \
        --dbname tetris \
        --tuples-only \
        --no-align \
        --command='
            SELECT count(*)
            FROM tetris_analytics.game_events;
        ')

    file_rows=$(wc -l < "$jsonl_file")
    test "$file_rows" -eq "$db_rows"

    printf 'DB_ROWS=%s JSONL_ROWS=%s\n' \
        "$db_rows" \
        "$file_rows"
    sha256sum "$jsonl_file"
    stat -c '%a %U:%G %s %n' "$jsonl_file"
)
```

Mac으로 가져올 때는 SSH session을 종료하고 Mac terminal에서 정확한 파일명을
지정한다.

```bash
scp \
    -i "<KEY_PATH>/tetris.key" \
    ubuntu@<OCI_PUBLIC_IP>:/srv/tetris/exports/<exact-export-file> \
    ~/Downloads/
```

export에는 event payload와 player 식별 정보가 포함될 수 있다. `.dump`, CSV,
JSONL과 SHA-256 결과를 Git에 commit하거나 공개 저장소에 올리지 않는다.

### 월간 restore rehearsal

먼저 복원할 backup 경로를 직접 확인한다.

```bash
ls -lh /srv/tetris/backups
sha256sum /srv/tetris/backups/<verified-backup>.dump
```

임시 DB 이름과 backup을 지정한다.

```bash
backup=/srv/tetris/backups/<verified-backup>.dump
restore_db="tetris_restore_$(date -u +%Y%m%d%H%M%S)"

test -s "$backup"
printf 'restore_db=%s\nbackup=%s\n' \
    "$restore_db" \
    "$backup"
```

복원:

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f /srv/tetris/repository/compose.production.yml \
    exec -T postgres \
    createdb \
    --username postgres \
    --owner tetris_migration \
    "$restore_db"

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f /srv/tetris/repository/compose.production.yml \
    exec -T postgres \
    pg_restore \
    --username postgres \
    --dbname "$restore_db" \
    --exit-on-error \
    < "$backup"
```

검증:

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f /srv/tetris/repository/compose.production.yml \
    exec -T postgres \
    psql \
    --username postgres \
    --dbname "$restore_db" \
    --tuples-only \
    --no-align \
    --field-separator='|' \
    --command="
        SELECT 'migrations', count(*)
        FROM tetris_analytics.schema_migrations;

        SELECT 'events', count(*)
        FROM tetris_analytics.game_events;

        SELECT 'owner', tablename, tableowner
        FROM pg_tables
        WHERE schemaname = 'tetris_analytics'
        ORDER BY tablename;
    "
```

확인 후 임시 DB만 삭제한다.

```bash
printf 'drop restore database only: %s\n' "$restore_db"

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f /srv/tetris/repository/compose.production.yml \
    exec -T postgres \
    dropdb \
    --username postgres \
    --force \
    "$restore_db"
```

`restore_db`가 `tetris`이면 실행하지 않는다.

Goal 9D local gate는 disposable PostgreSQL 17.10에서 custom-format
backup/restore와 count/hash 불변을 검증한다. 이는 실제 OCI backup이나 off-VM
복구 연습의 대체가 아니다.

## 용량과 보존

- raw event retention 목표: 90일.
- `pg_total_relation_size('tetris_analytics.game_events')`와 VM root filesystem
  사용량을 함께 관찰한다.
- quota 70%에서 warning, 85%에서 emergency로 알리고 신규 용량 계획 또는 수동 retention 승인을 요청한다.
- 자동 삭제는 아직 없다. 실제 사용자 row 삭제 승인 주체는 프로젝트 운영자인 사용자다.

월간 size 확인:

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    psql \
    --username postgres \
    --dbname tetris \
    --tuples-only \
    --no-align \
    --field-separator='|' \
    --command="
        SELECT
            'game_events',
            count(*),
            pg_size_pretty(
                pg_total_relation_size(
                    'tetris_analytics.game_events'
                )
            ),
            min(ingested_at),
            max(ingested_at)
        FROM tetris_analytics.game_events;
    "
```

수동 retention은 다음 순서를 모두 지킨다.

1. maintenance role로 cutoff, `max_rows`, `max_bytes`를 parameter로 전달해 dry-run한다.
2. 대상 수, bytes, 최소/최대 `ingested_at`을 확인하고 한도를 초과하면 중단한다.
3. 운영자가 cutoff와 두 상한을 다시 확인한다.
4. 서로 분리된 두 번의 명시적 확인 뒤 같은 cutoff, row 상한과 byte 상한으로 삭제한다.
5. 반환된 row 수가 승인 수와 같은지 확인하고 relation size와 backup 상태를 기록한다.

runtime role로 같은 `DELETE`가 거부돼야 한다. Goal 9D rehearsal은 91일 전 synthetic row 한 건만 삭제하며 실제 사용자 row에는 이 절차를 실행하지 않는다.

## 장애와 관찰

PostgreSQL event 수집은 승인된 best-effort 경계다. write는 최대 3회·2.7초 안에서 종료하며 실패나 process crash에서는 개별 event가 유실될 수 있지만 gameplay는 계속 진행한다. failure counter와 redacted code를 관찰하고 lifecycle이 불완전한 game은 learning export에서 제외한다. URL, credential과 raw payload는 log에 남기지 않는다.

DB 장애 중 gameplay, retry 시간, in-flight 상한과 ticker cadence를 함께 확인한다. strict lossless가 필요해지면 현재 설정을 확대하지 않고 durable outbox를 별도 Goal로 설계한다.

### app unhealthy

```bash
app_id=$(sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    ps -q app)

sudo docker inspect "$app_id" \
    --format \
    'status={{.State.Status}} health={{.State.Health.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}'

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    logs --tail=200 app
```

원인을 확인하기 전에 container나 volume을 삭제하지 않는다. 일시적인 process
문제로 판단된 경우 app만 restart한다.

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    restart app
```

### PostgreSQL unhealthy

```bash
postgres_id=$(sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    ps -q postgres)

sudo docker inspect "$postgres_id" \
    --format \
    'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{end}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}'

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    logs --tail=200 postgres
```

disk full, permission, TLS와 OOM을 먼저 확인한다. volume은 유지한 채 PostgreSQL만
restart할 수 있다.

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    restart postgres
```

PostgreSQL이 healthy가 된 뒤 app health와 최신 DB row를 다시 확인한다. 장애
동안 best-effort event 일부가 유실될 수 있으므로 incident 시간 범위를 기록한다.

### HTTPS failure

```bash
getent ahostsv4 tetra-arena.duckdns.org
sudo iptables -L INPUT -n --line-numbers

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    logs --tail=200 caddy

curl -I http://tetra-arena.duckdns.org
curl -I https://tetra-arena.duckdns.org
```

정상은 HTTP `308`, HTTPS `200`이다. Caddy certificate volume을 삭제하지 않는다.

## 새 application version 배포

무중단 배포는 아직 없다. 사용자가 적은 시간에 짧은 app 교체가 발생한다.

### 1. Mac에서 검증

```bash
git status --short
source ~/.nvm/nvm.sh
nvm exec 24.18.0 bash scripts/verify.sh

release_commit=$(git rev-parse HEAD)
release_sha=${release_commit:0:7}
printf 'release_commit=%s\nrelease_sha=%s\n' \
    "$release_commit" \
    "$release_sha"
```

배포 source와 commit을 일치시키고 immutable image tag로 `$release_sha`를
사용한다. dirty working tree는 먼저 범위를 확인한다.

### 2. OCI source와 image 준비

검증된 artifact를 OCI에 전송하고 SHA-256을 비교한다. 자세한 archive/SCP 절차는
[배포 실행 기록](../history/oci/oci-production-deployment-session-2026-07-24.md#5-source-artifact-전송)을
따른다.

OCI에서 새 source를 기존 운영 directory와 분리해 푼다.

```bash
release_commit=<full-new-approved-commit-sha>
new_tag=${release_commit:0:7}

(
    set -euo pipefail

    candidate_commit=${release_commit-}

    if [[ ! "$candidate_commit" =~ ^[0-9a-f]{40}$ ]]; then
        printf 'INVALID_RELEASE_COMMIT=%q\n' "$candidate_commit" >&2
        exit 1
    fi

    candidate_tag=${new_tag-}
    if [[ "$candidate_tag" != "${candidate_commit:0:7}" ]]; then
        printf 'RELEASE_TAG_COMMIT_MISMATCH=%q\n' "$candidate_tag" >&2
        exit 1
    fi
    artifact="/tmp/tetris-${candidate_tag}.tar.gz"
    build_directory="/srv/tetris/builds/${candidate_tag}"

    printf 'RELEASE_COMMIT=%s\nNEW_TAG=%s\nARTIFACT=%s\nBUILD_DIRECTORY=%s\n' \
        "$candidate_commit" \
        "$candidate_tag" \
        "$artifact" \
        "$build_directory"

    test -s "$artifact" || {
        printf 'ARTIFACT_MISSING_OR_EMPTY=%s\n' "$artifact" >&2
        exit 1
    }

    artifact_sha256=$(sha256sum "$artifact" | awk '{print $1}')
    test ! -e "$build_directory" || {
        printf 'BUILD_DIRECTORY_EXISTS=%s\n' "$build_directory" >&2
        exit 1
    }

    sha256sum "$artifact"
    tar -tzf "$artifact" >/dev/null

    sudo install -d \
        -o ubuntu \
        -g ubuntu \
        -m 750 \
        "$build_directory"

    tar -xzf "$artifact" \
        -C "$build_directory"

    test -f "$build_directory/compose.production.yml"
    test -f "$build_directory/Dockerfile"
    test -f "$build_directory/package.json"

    cd "$build_directory"

    sudo env APP_IMAGE_TAG="$candidate_tag" \
        docker compose \
        --env-file /srv/tetris/secrets/production.env \
        -f compose.production.yml \
        config --quiet

    sudo env APP_IMAGE_TAG="$candidate_tag" \
        docker compose \
        --env-file /srv/tetris/secrets/production.env \
        -f compose.production.yml \
        build \
        --build-arg "RELEASE_COMMIT=${candidate_commit}" \
        --build-arg "RELEASE_ARTIFACT_SHA256=${artifact_sha256}" \
        app

    sudo docker image inspect "tetris-app:${candidate_tag}" \
        --format \
        'tags={{json .RepoTags}} architecture={{.Architecture}} size={{.Size}}'
)

cd /srv/tetris/repository
```

괄호 안의 준비 단계는 별도 subshell에서 `set -euo pipefail`로 실행한다. 잘못된 commit,
없는 artifact, 이미 존재하는 build directory 또는 누락된 필수 파일을 발견하면
image build 전에 즉시 중단한다. 이미 존재하는 후보 image는 전체 commit SHA와
artifact SHA-256 label이 실제 source와 일치할 때만 workflow가 재사용한다. 이전
workflow에서 provenance label 없이 만든 image는 자동 재사용하지 않는다.

application source만 바뀌고 Compose/Caddyfile이 그대로라면 실행 중 stack의
`/srv/tetris/repository`를 덮어쓰지 않는다. production app은 build directory가
아니라 새 image에서 실행된다.

`compose.production.yml` 또는 `Caddyfile`도 바뀌었다면 자동으로 덮어쓰지 않는다.
local release test, `docker compose config`, 기존 파일 backup과 별도 maintenance
승인 후 `/srv/tetris/repository`의 해당 파일만 교체한다.

이전 image는 rollback 확인이 끝날 때까지 삭제하지 않는다.

### 3. 배포 전 backup

위의 주간 backup 절차를 한 번 실행한다. backup과 `pg_restore --list`가
성공하기 전 migration으로 넘어가지 않는다.

### 4. migration

새 image로 migration을 두 번 실행한다.

```bash
sudo docker run --rm \
    --network tetris_database \
    --mount \
        type=bind,src=/srv/tetris/certs/ca.crt,dst=/run/secrets/postgres-ca.crt,readonly \
    --env-file /srv/tetris/secrets/migration.env \
    --env NODE_EXTRA_CA_CERTS=/run/secrets/postgres-ca.crt \
    "tetris-app:${new_tag}" \
    node dist/server/server/db/migrateCli.js
```

첫 실행은 pending migration을 적용하고 두 번째 실행은 전부 `skipped`여야 한다.
migration 실패 시 기존 app을 유지하고 배포를 중단한다.

### 5. active image tag 갱신

현재 tag를 먼저 기록한다.

```bash
current_tag=$(sed -n \
    's/^APP_IMAGE_TAG=//p' \
    /srv/tetris/secrets/production.env)

printf 'current=%s new=%s\n' \
    "$current_tag" \
    "$new_tag"
```

env 파일을 atomic하게 교체한다.

```bash
(
    set -euo pipefail
    umask 077

    env_file=/srv/tetris/secrets/production.env
    temporary=$(mktemp /srv/tetris/secrets/production.env.XXXXXX)

    cleanupTemporary() {
        test ! -e "$temporary" \
            || rm -f -- "$temporary"
    }

    trap cleanupTemporary EXIT

    sed \
        "s/^APP_IMAGE_TAG=.*/APP_IMAGE_TAG=${new_tag}/" \
        "$env_file" \
        > "$temporary"

    test "$(grep -c '^APP_IMAGE_TAG=' "$temporary")" -eq 1
    chmod 600 "$temporary"
    mv "$temporary" "$env_file"
    trap - EXIT
)
```

### 6. app만 교체

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    up -d \
    --no-deps \
    --no-build \
    --force-recreate \
    --wait \
    app
```

Caddy와 PostgreSQL은 재생성하지 않는다.

### 7. 배포 검증

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    ps

curl -fsS \
    --retry 10 \
    --retry-delay 2 \
    --retry-all-errors \
    -o /dev/null \
    -w 'HTTPS_STATUS=%{http_code}\n' \
    https://tetra-arena.duckdns.org

app_id=$(sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    ps -q app)

sudo docker inspect "$app_id" \
    --format \
    'image={{.Config.Image}} status={{.State.Status}} health={{.State.Health.Status}} oom={{.State.OOMKilled}}'

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    logs --tail=100 app
```

브라우저에서 한 게임을 완료하고 DB row가 증가하는지 확인한다.

## Rollback

새 application version만 실패했다면 이전 PostgreSQL application image로 되돌린다.
migration down이나 row 삭제는 하지 않는다.

```bash
rollback_tag=<previous-verified-tag>
printf 'rollback_tag=%s\n' "$rollback_tag"

sudo docker image inspect "tetris-app:${rollback_tag}" \
    >/dev/null
```

위의 “active image tag 갱신” 절차에서 `new_tag` 대신 `rollback_tag`를 넣어
`production.env`를 교체한 뒤 app만 다시 만든다.

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    up -d \
    --no-deps \
    --no-build \
    --force-recreate \
    --wait \
    app
```

health, HTTPS와 DB write를 다시 검증한다. 새 migration이 이전 image와 호환되지
않는다면 application rollback으로 해결되지 않으므로 배포 전 migration
호환성을 확인해야 한다.

PostgreSQL 전체를 사용할 수 없어 JSONL mode로 긴급 복구할 때만
[배포 실행 기록의 rollback 명령](../history/oci/oci-production-deployment-session-2026-07-24.md#rollback-명령)을
사용한다. PostgreSQL row와 volume, 기존 JSONL과 snapshots는 삭제하지 않는다.

## Ubuntu update와 reboot

maintenance 시간을 잡고 최신 backup을 확인한 뒤 실행한다.

```bash
sudo apt update
apt list --upgradable
sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y
```

reboot 필요 여부:

```bash
test -f /var/run/reboot-required \
    && echo "REBOOT_REQUIRED" \
    || echo "NO_REBOOT_REQUIRED"
```

필요하면:

```bash
sudo reboot
```

SSH가 일시적으로 끊기는 것은 정상이다. 재접속 후 다음을 확인한다.

```bash
uname -r
sudo systemctl is-active docker

cd /srv/tetris/repository
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    ps

curl -I https://tetra-arena.duckdns.org
free -h
swapon --show
```

자동 `apt autoremove`, Docker volume prune와 old image 삭제는 운영 확인과
rollback 보존 기간이 끝난 뒤 별도 검토한다.

## TLS와 credential 운영

- Caddy public certificate는 `caddy_data` volume에 보존되고 자동 갱신된다.
- private PostgreSQL CA와 server certificate는 자동 갱신되지 않는다.
- certificate 만료 30일 전 별도 maintenance에서 교체한다.
- password rotation은 PostgreSQL role password와 해당 env 파일을 같은
  maintenance 작업에서 교체한다.
- private key나 password 원문을 terminal, Git, issue와 문서에 붙이지 않는다.

public HTTPS certificate 확인:

```bash
openssl s_client \
    -connect tetra-arena.duckdns.org:443 \
    -servername tetra-arena.duckdns.org \
    </dev/null 2>/dev/null \
    | openssl x509 \
        -noout \
        -subject \
        -issuer \
        -dates
```

private PostgreSQL certificate 확인:

```bash
openssl verify \
    -CAfile /srv/tetris/certs/ca.crt \
    /srv/tetris/certs/postgres.crt

openssl x509 \
    -in /srv/tetris/certs/postgres.crt \
    -noout \
    -checkhost postgres \
    -dates
```

## 운영 기록에 남길 값

점검이나 배포마다 다음만 기록한다.

- UTC 시각
- application image tag와 image ID
- app/PostgreSQL/Caddy health
- HTTPS status
- DB total rows와 latest `ingested_at`
- backup 파일명, bytes와 SHA-256
- restore rehearsal DB 이름과 결과
- RAM available, swap과 disk 사용량
- storage error code와 발생 시간
- rollback 여부와 잠재 event loss 구간

기록하지 않는 값:

- password
- full database URL
- private key
- DuckDNS token
- raw user payload
