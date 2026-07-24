# OCI 단일 VM 운영 배포 실행 기록

## 1. 문서 목적

이 문서는 2026-07-23~24에 실제 OCI 단일 VM에서 수행한 배포를 학습용으로
재구성한 기록이다. 단순한 최종 명령 모음이 아니라 다음 내용을 함께 남긴다.

- 왜 각 단계가 필요했는가
- Mac과 OCI VM 중 어디에서 실행했는가
- 실제로 무엇이 변경됐는가
- 어떤 실패가 있었고 원인이 무엇이었는가
- 무엇으로 성공을 확인했는가
- 재실행하면 안 되는 최초 provisioning 명령은 무엇인가

규범적인 재배포 순서는 [OCI 단일 VM 배포 Runbook](oci-single-vm-deployment.md)을
따른다. 이 문서는 당시의 시행착오와 관찰값을 보존하는 실행 기록이다.
각 명령과 옵션의 학습용 설명은
[OCI 운영 배포 명령어 해설](oci-production-deployment-command-guide-2026-07-24.md)을
참고한다.
중간 장애의 재현·원인·해결 과정은
[OCI 운영 배포 트러블슈팅 기록](oci-production-deployment-troubleshooting-2026-07-24.md)에
정리되어 있다.

> 보안: 이 문서에는 password, private key, database URL 원문 또는 token 값을
> 기록하지 않는다. `<...>` 표시는 실행 환경에 맞게 채워야 하는 값이다.

## 2. 최종 결과

| 항목 | 결과 |
|---|---|
| 공개 주소 | `https://tetra-arena.duckdns.org` |
| application image | `tetris-app:2411cd3` |
| application sink | PostgreSQL 단일 sink |
| PostgreSQL | 17.10, TLS `verify-full`, internal Docker network only |
| Caddy | HTTP→HTTPS redirect, HTTPS `200` |
| 최초 JSONL import | inserted `131`, duplicate `0` |
| 같은 파일 재실행 | inserted `0`, duplicate `131` |
| 실제 게임 후 DB | `131 → 195` rows |
| app 재시작 후 DB | `195 → 195` rows |
| 컨테이너 상태 | app/PostgreSQL healthy, OOM 없음 |
| 최종 VM 메모리 | 954 MiB 중 520 MiB used, 434 MiB available |
| 최종 swap | 2 GiB 중 83 MiB used |

전체 전환:

```text
Mac의 검증된 source artifact
        |
        v
OCI VM + Docker + swap + firewall
        |
        v
JSONL app + Caddy + HTTPS 기준선
        |
        v
PostgreSQL + TLS + 역할 분리 + migration
        |
        v
immutable JSONL snapshot
        |
        v
dry-run -> backup/restore -> import x2
        |
        v
JSONL app 정지 -> final import -> PostgreSQL app
        |
        v
실제 게임 write -> app restart -> row 보존
```

## 3. Mac과 OCI VM 구분

프롬프트가 다음과 같으면 Mac이다.

```text
parkseongho@... %
```

프롬프트가 다음과 같으면 OCI VM이다.

```text
ubuntu@primary-vnic:...$
```

`scp`의 local source는 명령을 실행하는 컴퓨터에서 찾는다. Mac의
`/tmp/tetris-2411cd3.tar.gz`를 OCI로 보낼 때는 Mac 터미널에서 실행해야 한다.

잘못 실행한 예:

```bash
# OCI VM에서 실행했으므로 /tmp는 OCI VM의 /tmp다.
scp -i "/Users/<mac-user>/.../tetris.key" \
    /tmp/tetris-2411cd3.tar.gz \
    ubuntu@<OCI_PUBLIC_IP>:/tmp/
```

결과:

```text
scp: stat local "/tmp/tetris-2411cd3.tar.gz": No such file or directory
```

디렉터리 경로만 입력하면 이동이 아니라 실행을 시도하므로 `permission denied`가
발생한다. 이동에는 `cd`를 쓴다.

```bash
cd "/Users/<mac-user>/Downloads/<server-key-directory>"
```

SSH 옵션도 한 번만 사용한다.

```bash
# 잘못된 예
ssh -i ssh -i tetris.key ubuntu@<OCI_PUBLIC_IP>

# 올바른 예
ssh -i tetris.key ubuntu@<OCI_PUBLIC_IP>
```

## 4. OCI VM 준비

### Docker 설치

OCI VM:

```bash
sudo apt install -y docker.io git
sudo systemctl enable --now docker
sudo docker version
```

확인된 서버 Docker:

```text
Docker Engine 29.1.3
linux/amd64
```

Mac에서 `sudo docker version`을 실행하면 OCI가 아니라 Mac Docker Desktop을
확인한다. 당시 Mac은 `darwin/arm64`, OCI는 `linux/amd64`였다.

### 시스템 업데이트와 Compose

```bash
sudo apt update
sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y
sudo apt install -y docker-compose-v2
sudo systemctl enable --now docker

docker --version
sudo docker compose version
```

확인:

```text
Docker version 29.1.3
Docker Compose version 2.40.3
```

kernel 갱신으로 재부팅이 필요했다.

```bash
test -f /var/run/reboot-required \
    && echo "REBOOT_REQUIRED" \
    || echo "NO_REBOOT_REQUIRED"

sudo reboot
```

재접속 뒤:

```bash
uname -r
```

결과:

```text
6.17.0-1019-oracle
```

### 2 GiB swap

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

grep -q '^/swapfile ' /etc/fstab \
    || printf '/swapfile none swap sw 0 0\n' \
    | sudo tee -a /etc/fstab

swapon --show
free -h
```

swap은 RAM을 늘리지 않는다. 순간적인 memory pressure에서 process가 OOM으로
종료될 가능성을 낮추는 안전망이다.

### 방화벽

`ufw`는 설치돼 있지 않았다.

```text
sudo: ufw: command not found
```

기존 iptables의 SSH 허용 뒤, 최종 REJECT 앞에 80/443을 추가했다.

```bash
sudo iptables -C INPUT \
    -p tcp \
    -m multiport --dports 80,443 \
    -m conntrack --ctstate NEW \
    -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 5 \
        -p tcp \
        -m multiport --dports 80,443 \
        -m conntrack --ctstate NEW \
        -j ACCEPT

sudo netfilter-persistent save
sudo iptables -L INPUT -n --line-numbers
```

핵심 결과:

```text
4 ACCEPT tcp dpt:22
5 ACCEPT tcp multiport dports 80,443
6 REJECT
```

OCI Security List/NSG에서도 80/443 ingress가 허용돼 있어야 한다.

## 5. source artifact 전송

### GitHub clone 실패

```bash
git clone https://github.com/Sleepingco/Tetris_multi tetris-multi
```

결과:

```text
Password authentication is not supported for Git operations.
fatal: Authentication failed
```

private repository 인증이 없었고 GitHub가 계정 password 기반 Git 작업을 지원하지
않기 때문이다. GitHub 인증은 OCI 배포 자체의 필수조건이 아니다. 검증된 local
artifact를 `scp`로 전송해 배포를 계속했다.

### 당시 artifact

| 항목 | 값 |
|---|---|
| source commit | `2411cd3` |
| archive | `tetris-2411cd3.tar.gz` |
| archive bytes | 약 5.1 MiB |
| archive SHA-256 | `9aa909cdf0e4a78bfa78ed7f1d233c4ed456e0bfd8ea643154fb31c074cbe8dc` |

당시 archive 생성 명령은 터미널 기록에 남지 않았다. 같은 commit을 재현할 때
사용할 수 있는 표준 명령은 다음과 같다. 압축 메타데이터에 따라 새 archive의
checksum은 당시 값과 다를 수 있다.

Mac:

```bash
git archive \
    --format=tar.gz \
    --output=/tmp/tetris-2411cd3.tar.gz \
    2411cd3

shasum -a 256 /tmp/tetris-2411cd3.tar.gz

scp \
    -i "<KEY_PATH>/tetris.key" \
    /tmp/tetris-2411cd3.tar.gz \
    ubuntu@<OCI_PUBLIC_IP>:/tmp/
```

OCI VM:

```bash
ls -lh /tmp/tetris-2411cd3.tar.gz
sha256sum /tmp/tetris-2411cd3.tar.gz

sudo install -d \
    -o ubuntu \
    -g ubuntu \
    -m 750 \
    /srv/tetris/repository

tar -xzf /tmp/tetris-2411cd3.tar.gz \
    -C /srv/tetris/repository

cd /srv/tetris/repository
ls compose.jsonl.yml compose.production.yml Caddyfile Dockerfile package.json
```

## 6. JSONL 기준선 배포

### Compose와 image

```bash
cd /srv/tetris/repository

sudo env APP_IMAGE_TAG=2411cd3 \
    docker compose \
    -f compose.jsonl.yml \
    config --quiet

sudo env APP_IMAGE_TAG=2411cd3 \
    docker compose \
    -f compose.jsonl.yml \
    build app

sudo docker image inspect tetris-app:2411cd3 \
    --format 'image={{.RepoTags}} architecture={{.Architecture}} size={{.Size}}'
```

`buildx`가 없다는 Bake warning이 있었지만 기본 builder가 build를 완료했다.

```text
image=[tetris-app:2411cd3] architecture=amd64 size=88354445
```

기록된 image ID:

```text
sha256:e498b434f471ff9015eafa67af19e0d8659613263016e4754d77e48c6d63c8ad
```

### app과 Caddy

```bash
sudo env APP_IMAGE_TAG=2411cd3 \
    docker compose \
    -f compose.jsonl.yml \
    up -d

sudo docker compose -f compose.jsonl.yml ps
sudo docker compose -f compose.jsonl.yml logs --tail=100 app caddy
```

Caddy가 Let's Encrypt 인증서를 자동 발급했다.

```bash
getent ahostsv4 tetra-arena.duckdns.org
curl -I http://tetra-arena.duckdns.org
curl -I https://tetra-arena.duckdns.org
```

결과:

```text
HTTP/1.1 308 Permanent Redirect
Location: https://tetra-arena.duckdns.org/

HTTP/2 200
```

### resource 기준선

```bash
free -h
swapon --show
df -h /
sudo docker stats --no-stream
```

관찰:

- app 약 87~91 MiB
- Caddy 약 13~21 MiB
- root disk 약 14%
- swap 약 67 MiB

### JSONL persistence

```bash
sudo docker compose \
    -f compose.jsonl.yml \
    exec -T app \
    sh -c '
        test -s /app/data/logs/game-events.jsonl
        wc -l /app/data/logs/game-events.jsonl
        sha256sum /app/data/logs/game-events.jsonl
    '
```

결과:

```text
131 /app/data/logs/game-events.jsonl
ea49517f401361fc81f473d18664ddad2185fc7cc26d830fdd7c921d631a333f
```

재시작 persistence:

```bash
before=$(sudo docker compose \
    -f compose.jsonl.yml \
    exec -T app \
    sha256sum /app/data/logs/game-events.jsonl \
    | awk '{print $1}')

sudo docker compose -f compose.jsonl.yml restart app
sleep 10

after=$(sudo docker compose \
    -f compose.jsonl.yml \
    exec -T app \
    sha256sum /app/data/logs/game-events.jsonl \
    | awk '{print $1}')

test "$before" = "$after" \
    && echo "JSONL_PERSISTENCE_OK" \
    || echo "JSONL_HASH_CHANGED"
```

결과:

```text
JSONL_PERSISTENCE_OK
```

이 시점까지 JSONL이 유일한 sink였다.

## 7. PostgreSQL secret과 private CA

### 디렉터리와 password

```bash
sudo install -d -o ubuntu -g ubuntu -m 700 \
    /srv/tetris/secrets \
    /srv/tetris/certs \
    /srv/tetris/backups \
    /srv/tetris/import/source \
    /srv/tetris/import/reports

(
    set -eu
    umask 077

    openssl rand -hex 24 > /srv/tetris/secrets/postgres-admin-password
    openssl rand -hex 24 > /srv/tetris/secrets/migration-password
    openssl rand -hex 24 > /srv/tetris/secrets/runtime-password
    openssl rand -hex 24 > /srv/tetris/secrets/import-password
    openssl rand -hex 24 > /srv/tetris/secrets/maintenance-password
)
```

| 파일 | DB role | 사용 위치 |
|---|---|---|
| `postgres-admin-password` | `postgres` | 최초 초기화 |
| `migration-password` | `tetris_migration` | migration |
| `runtime-password` | `tetris_runtime` | production app |
| `import-password` | `tetris_import` | importer |
| `maintenance-password` | `tetris_maintenance` | retention/운영 |

파일에는 random hex 원문이 있다. PostgreSQL 내부에는 SCRAM verifier가 저장되지만
application 접속에는 원문 password가 필요하다.

### private CA

```bash
(
    set -eu
    umask 077

    openssl req \
        -x509 \
        -newkey rsa:3072 \
        -sha256 \
        -nodes \
        -days 3650 \
        -subj '/CN=Tetris PostgreSQL Private CA' \
        -keyout /srv/tetris/certs/ca.key \
        -out /srv/tetris/certs/ca.crt

    openssl req \
        -newkey rsa:2048 \
        -sha256 \
        -nodes \
        -subj '/CN=postgres' \
        -keyout /srv/tetris/certs/postgres.key \
        -out /srv/tetris/certs/postgres.csr

    printf 'subjectAltName=DNS:postgres\nextendedKeyUsage=serverAuth\n' \
        > /srv/tetris/certs/postgres.ext

    openssl x509 \
        -req \
        -sha256 \
        -days 825 \
        -in /srv/tetris/certs/postgres.csr \
        -CA /srv/tetris/certs/ca.crt \
        -CAkey /srv/tetris/certs/ca.key \
        -CAcreateserial \
        -extfile /srv/tetris/certs/postgres.ext \
        -out /srv/tetris/certs/postgres.crt
)

chmod 600 \
    /srv/tetris/certs/ca.key \
    /srv/tetris/certs/postgres.key

chmod 644 \
    /srv/tetris/certs/ca.crt \
    /srv/tetris/certs/postgres.crt

openssl verify \
    -CAfile /srv/tetris/certs/ca.crt \
    /srv/tetris/certs/postgres.crt

openssl x509 \
    -in /srv/tetris/certs/postgres.crt \
    -noout -checkhost postgres
```

핵심:

- `*.key`: private key이므로 `600`
- `*.crt`: 공개 certificate이고 non-root container가 읽어야 하므로 `644`

### env 파일

값은 파일에만 기록하고 `cat`으로 출력하지 않는다.

```bash
(
    set -eu
    umask 077

    printf \
        'APP_IMAGE_TAG=2411cd3\nDATABASE_URL=postgresql://tetris_runtime:%s@postgres:5432/tetris?sslmode=verify-full\n' \
        "$(cat /srv/tetris/secrets/runtime-password)" \
        > /srv/tetris/secrets/production.env

    printf \
        'MIGRATION_DATABASE_URL=postgresql://tetris_migration:%s@postgres:5432/tetris?sslmode=verify-full\n' \
        "$(cat /srv/tetris/secrets/migration-password)" \
        > /srv/tetris/secrets/migration.env

    printf \
        'IMPORT_DATABASE_URL=postgresql://tetris_import:%s@postgres:5432/tetris?sslmode=verify-full\n' \
        "$(cat /srv/tetris/secrets/import-password)" \
        > /srv/tetris/secrets/import.env
)

chmod 600 /srv/tetris/secrets/*.env
```

key 이름만 확인:

```bash
cut -d= -f1 \
    /srv/tetris/secrets/production.env \
    /srv/tetris/secrets/migration.env \
    /srv/tetris/secrets/import.env
```

## 8. PostgreSQL restart loop와 hotfix

### 증상과 진단

첫 시작 상태:

```text
Restarting (0)
postgres-1 | PS2='> '
```

```bash
sudo docker inspect tetris-postgres-1 \
    --format \
    'path={{json .Path}} args={{json .Args}} exit={{.State.ExitCode}} restarts={{.RestartCount}} error={{json .State.Error}}'

sudo docker inspect tetris-postgres-1 \
    --format \
    'entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}}'
```

관찰:

```text
path="/bin/sh"
args=["-c","set","-eu","mkdir",...]
exit=0
```

원래 Compose:

```yaml
entrypoint:
  - /bin/sh
  - -c
command: |
  set -eu
  mkdir -p ...
  exec docker-entrypoint.sh postgres ...
```

Compose 2.40.3에서 command가 script 하나가 아니라 여러 단어로 분리됐다.
`sh -c`가 실행한 것은 `set` 하나뿐이었고 `set`은 shell 변수를 출력한 뒤
정상 종료했다. 그래서 `exit=0`, `PS2='> '`, restart loop가 함께 나타났다.

PostgreSQL data나 password 오류가 아니었다.

### 안전 정지

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    stop postgres

sudo docker compose -f compose.jsonl.yml ps
curl -I https://tetra-arena.duckdns.org
```

JSONL app과 HTTPS는 계속 정상 동작했다.

### local hotfix commit

Mac repository:

```bash
git switch -c codex/fix-postgres-command-args
```

수정:

```yaml
entrypoint:
  - /bin/sh
  - -c
command:
  - |
    set -eu
    mkdir -p ...
    exec docker-entrypoint.sh postgres ...
```

`scripts/verify-postgres-production.sh`에는 Compose render 결과가 one-element
command인지 확인하는 regression check를 추가했다.

```bash
source ~/.nvm/nvm.sh
nvm exec 24.18.0 bash scripts/verify.sh
git diff --check

git add compose.production.yml scripts/verify-postgres-production.sh
git commit -m "fix: preserve PostgreSQL startup command"
```

| 항목 | 값 |
|---|---|
| branch | `codex/fix-postgres-command-args` |
| commit | `c292cc64f42e44f65ea08aeec84d081a10f5f8c4` |
| short SHA | `c292cc6` |
| verify | 643 pass, 1 conditional skip, 0 fail |

당시 `gh auth status`는 만료된 인증을 보고했다. GitHub push/PR은 배포와 분리하고
patch file만 OCI VM에 전달했다. GitHub 인증은 PostgreSQL 수정 자체가 아니라
commit을 원격 저장소에 게시할 때 필요하다.

Mac:

```bash
scp \
    -i "<KEY_PATH>/tetris.key" \
    compose.production.yml \
    ubuntu@<OCI_PUBLIC_IP>:/tmp/compose.production.c292cc6.yml
```

OCI VM:

```bash
sha256sum /tmp/compose.production.c292cc6.yml
```

결과:

```text
4705d9cfd9e8b04fcf45249e44f07782c870b1722260e6658d6bb34f213bdf97
```

기존 파일을 보존한 뒤 설치했다.

```bash
cd /srv/tetris/repository

cp compose.production.yml \
    compose.production.yml.before-c292cc6

install -m 644 \
    /tmp/compose.production.c292cc6.yml \
    compose.production.yml

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    up -d \
    --force-recreate \
    postgres
```

확인:

```bash
sleep 20

sudo docker inspect tetris-postgres-1 \
    --format \
    'args={{len .Args}} running={{.State.Running}} health={{.State.Health.Status}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}'
```

결과:

```text
args=2 running=true health=healthy restarts=0 oom=false
```

PostgreSQL port/network:

```bash
sudo docker inspect tetris-postgres-1 \
    --format \
    'ports={{json .NetworkSettings.Ports}} networks={{json .NetworkSettings.Networks}}'
```

핵심:

```text
"5432/tcp": null
network: tetris_database
```

## 9. role과 database provisioning

> 최초 provisioning에서 한 번만 실행한다. 기존 role/database가 있으면 그대로
> 재실행하지 않는다.

```bash
migration_password=$(cat /srv/tetris/secrets/migration-password)
runtime_password=$(cat /srv/tetris/secrets/runtime-password)
import_password=$(cat /srv/tetris/secrets/import-password)
maintenance_password=$(cat /srv/tetris/secrets/maintenance-password)

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    psql \
    --set ON_ERROR_STOP=1 \
    --username postgres \
    --dbname postgres <<SQL
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

unset \
    migration_password \
    runtime_password \
    import_password \
    maintenance_password
```

검증 결과:

```text
tetris_import|f|f|f|f
tetris_maintenance|f|f|f|f
tetris_migration|f|f|f|f
tetris_runtime|f|f|f|f
tetris|tetris_migration
```

네 application role 모두 superuser/createdb/createrole/replication 권한이 없다.

## 10. migration과 certificate 권한 오류

최초 migration:

```text
Warning: Ignoring extra certs from
`/run/secrets/postgres-ca.crt`, load failed:
Permission denied
MIGRATION_CONNECTION_FAILED
```

원인은 `umask 077`로 공개 CA certificate도 `600`이 된 것이다. application image는
UID 1000의 `node`로 실행되므로 읽을 수 없었다.

```bash
chmod 644 \
    /srv/tetris/certs/ca.crt \
    /srv/tetris/certs/postgres.crt

chmod 600 \
    /srv/tetris/certs/ca.key \
    /srv/tetris/certs/postgres.key
```

migration:

```bash
sudo docker run --rm \
    --network tetris_database \
    --mount \
        type=bind,src=/srv/tetris/certs/ca.crt,dst=/run/secrets/postgres-ca.crt,readonly \
    --env-file /srv/tetris/secrets/migration.env \
    --env NODE_EXTRA_CA_CERTS=/run/secrets/postgres-ca.crt \
    tetris-app:2411cd3 \
    node dist/server/server/db/migrateCli.js
```

첫 실행:

```text
PostgreSQL migrations applied=2 skipped=0
```

재실행:

```text
PostgreSQL migrations applied=0 skipped=2
```

## 11. 최소 권한과 ACL

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    psql \
    --username postgres \
    --dbname tetris \
    --set=ON_ERROR_STOP=1 <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA tetris_analytics FROM PUBLIC;

GRANT USAGE ON SCHEMA tetris_analytics
    TO tetris_runtime, tetris_import, tetris_maintenance;

GRANT INSERT (
    identity_version,
    event_id,
    event_type,
    schema_version,
    game_id,
    player_id,
    piece_index,
    trust_level,
    occurred_at,
    payload,
    event_sha256
) ON tetris_analytics.game_events
    TO tetris_runtime, tetris_import;

GRANT SELECT (
    event_id,
    event_type,
    game_id,
    player_id,
    piece_index,
    event_sha256
) ON tetris_analytics.game_events
    TO tetris_runtime, tetris_import;

GRANT SELECT (version, name, checksum)
    ON tetris_analytics.schema_migrations
    TO tetris_runtime;

GRANT SELECT, DELETE
    ON tetris_analytics.game_events
    TO tetris_maintenance;
SQL
```

PostgreSQL privilege function 검증 결과:

```text
runtime|t|t|t|f|f|f
import|t|t|t|f|f|f
maintenance|t|f|t|f|t|f
```

의미:

- runtime/import: 필요한 column INSERT/SELECT만 허용
- maintenance: SELECT/DELETE만 허용
- runtime/import에는 UPDATE/DELETE/TRUNCATE 권한이 없음

## 12. immutable JSONL snapshot

복사 중 마지막 line이 바뀌지 않도록 app만 잠깐 pause했다.

```bash
(
    set -eu

    snapshot=/srv/tetris/import/source/game-events.jsonl
    test ! -e "$snapshot"

    app_id=$(sudo docker compose \
        -f compose.jsonl.yml \
        ps -q app)

    test -n "$app_id"

    resumeApp() {
        sudo docker compose \
            -f compose.jsonl.yml \
            unpause app >/dev/null 2>&1 || true
    }

    trap resumeApp EXIT

    sudo docker compose -f compose.jsonl.yml pause app

    sudo docker cp \
        "${app_id}:/app/data/logs/game-events.jsonl" \
        "$snapshot"

    sudo chown ubuntu:ubuntu "$snapshot"
    sudo chmod 400 "$snapshot"

    sudo docker compose -f compose.jsonl.yml unpause app
    trap - EXIT

    wc -l "$snapshot"
    sha256sum "$snapshot"
    stat -c '%a %U:%G %s %n' "$snapshot"
)
```

결과:

```text
131 lines
649074 bytes
SHA-256 ea49517f401361fc81f473d18664ddad2185fc7cc26d830fdd7c921d631a333f
400 ubuntu:ubuntu
```

## 13. UID 불일치와 importer `EACCES`

dry-run에서 `EACCES`가 반복돼 numeric UID를 확인했다.

```bash
id

stat -c '%a %u:%g %n' \
    /srv/tetris/import/source \
    /srv/tetris/import/source/game-events.jsonl \
    /srv/tetris/import/reports

sudo docker run --rm \
    --mount \
        type=bind,src=/srv/tetris/import/source/game-events.jsonl,dst=/run/game-events.jsonl,readonly \
    --mount \
        type=bind,src=/srv/tetris/import/reports,dst=/run/reports \
    tetris-app:2411cd3 \
    sh -c '
        id
        test -r /run/game-events.jsonl \
            && echo SOURCE_READABLE \
            || echo SOURCE_DENIED
        test -w /run/reports \
            && echo REPORT_DIRECTORY_WRITABLE \
            || echo REPORT_DIRECTORY_DENIED
    '
```

결과:

```text
host ubuntu: uid=1001 gid=1001
image node:  uid=1000 gid=1000
SOURCE_DENIED
REPORT_DIRECTORY_DENIED
```

Linux permission은 이름이 아니라 numeric UID/GID로 판단한다. 권한을 넓히지 않고
one-off importer만 host UID로 실행했다.

```bash
--user "$(id -u):$(id -g)"
```

## 14. JSONL dry-run

```bash
sudo docker run --rm \
    --user "$(id -u):$(id -g)" \
    --mount \
        type=bind,src=/srv/tetris/import/source/game-events.jsonl,dst=/run/game-events.jsonl,readonly \
    --mount \
        type=bind,src=/srv/tetris/import/reports,dst=/run/reports \
    tetris-app:2411cd3 \
    node dist/server/server/db/importJsonl.js \
    --dry-run \
    --report /run/reports/dry-run.json \
    /run/game-events.jsonl \
    >/dev/null

chmod 400 /srv/tetris/import/reports/dry-run.json
```

결과:

| 항목 | 값 |
|---|---:|
| `ok` | `true` |
| source lines | 131 |
| source bytes | 649074 |
| game start | 2 |
| placement decision | 127 |
| game over | 2 |
| canonical events | 131 |
| unique identities | 131 |
| failures | 0 |
| games | 2 |
| complete games | 2 |
| ambiguous/incomplete | 0/0 |

canonical ordered hash:

```text
8968ee792fce510e27c57bf2f300ff96f1760d562cfca05b519688d290884d43
```

dry-run의 writes는 전부 `0`이었다.

## 15. backup/restore rehearsal

### custom-format backup

```bash
(
    set -eu
    umask 077

    backup=/srv/tetris/backups/pre-import-2411cd3.dump
    temporary="${backup}.tmp"

    test ! -e "$backup"
    test ! -e "$temporary"

    sudo docker compose \
        --env-file /srv/tetris/secrets/production.env \
        -f compose.production.yml \
        exec -T postgres \
        pg_dump \
        --username postgres \
        --dbname tetris \
        --format=custom \
        > "$temporary"

    mv "$temporary" "$backup"
    chmod 400 "$backup"

    sha256sum "$backup"
    stat -c '%a %U:%G %s %n' "$backup"

    sudo docker compose \
        --env-file /srv/tetris/secrets/production.env \
        -f compose.production.yml \
        exec -T postgres \
        pg_restore --list \
        < "$backup" \
        | grep -E 'tetris_analytics|game_events|schema_migrations'
)
```

결과:

```text
SHA-256 dca647e76de8965e1db64d628606a3cebcf738f30ea7ff64b3006df5bb1d9e4e
400 ubuntu:ubuntu
14055 bytes
```

dump에는 schema, tables, data, ACL, constraints와 indexes가 있었다.

### 임시 DB 복원

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    createdb \
    --username postgres \
    --owner tetris_migration \
    tetris_restore_check

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    pg_restore \
    --username postgres \
    --dbname tetris_restore_check \
    --exit-on-error \
    < /srv/tetris/backups/pre-import-2411cd3.dump
```

복원 결과:

```text
migrations|2
events|0
owner|game_events|tetris_migration
owner|schema_migrations|tetris_migration
runtime_acl|t|t|f
```

임시 DB 제거:

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    dropdb \
    --username postgres \
    --force \
    tetris_restore_check
```

`pg_database` 재조회 결과는 `0`이었다.

## 16. 실제 import와 멱등성

### 첫 import

```bash
sudo docker run --rm \
    --user "$(id -u):$(id -g)" \
    --network tetris_database \
    --mount \
        type=bind,src=/srv/tetris/certs/ca.crt,dst=/run/secrets/postgres-ca.crt,readonly \
    --mount \
        type=bind,src=/srv/tetris/import/source/game-events.jsonl,dst=/run/game-events.jsonl,readonly \
    --mount \
        type=bind,src=/srv/tetris/import/reports,dst=/run/reports \
    --env-file /srv/tetris/secrets/import.env \
    --env NODE_EXTRA_CA_CERTS=/run/secrets/postgres-ca.crt \
    tetris-app:2411cd3 \
    node dist/server/server/db/importJsonl.js \
    --report /run/reports/import-first.json \
    /run/game-events.jsonl \
    >/dev/null

chmod 400 /srv/tetris/import/reports/import-first.json
```

결과:

```json
{
  "attempted": 131,
  "inserted": 131,
  "duplicate": 0,
  "conflict": 0,
  "failed": 0
}
```

DB:

```text
total|131
game_over|2
game_start|2
placement_decision|127
privacy_violations|0
```

### 같은 source 재실행

같은 명령에서 report 이름만 `import-second.json`으로 변경했다.

```json
{
  "attempted": 131,
  "inserted": 0,
  "duplicate": 131,
  "conflict": 0,
  "failed": 0
}
```

두 실행의 source/canonical hash는 같았고 DB row는 `131`이었다.

## 17. runtime credential preflight

```bash
sudo docker run --rm \
    --network tetris_database \
    --mount \
        type=bind,src=/srv/tetris/certs/ca.crt,dst=/run/secrets/postgres-ca.crt,readonly \
    --env-file /srv/tetris/secrets/production.env \
    --env NODE_ENV=production \
    --env GAME_EVENT_STORAGE=postgres \
    --env NODE_EXTRA_CA_CERTS=/run/secrets/postgres-ca.crt \
    tetris-app:2411cd3 \
    node -e '
        const {
            createRuntimeEventStorage
        } = require(
            "./dist/server/server/services/runtimeEventStorage.js"
        );

        (async () => {
            const storage = await createRuntimeEventStorage();
            console.log(JSON.stringify({
                mode: storage.mode,
                metrics: storage.getMetrics()
            }, null, 2));
            await storage.close();
        })().catch(() => {
            console.error("RUNTIME_PREFLIGHT_FAILED");
            process.exit(1);
        });
    '
```

결과:

```text
mode=postgres
failed=0
poolMax=4
```

event write 없이 runtime password, TLS와 migration version을 확인했다.

## 18. final snapshot과 single-sink cutover

처음 snapshot 이후 새 JSONL event가 생길 수 있으므로 다음 순서를 지켰다.

1. JSONL app 정상 종료
2. stopped container에서 final JSONL 복사
3. idempotent final import
4. PostgreSQL mode app 시작
5. 실패 시 JSONL app 복구

### final source

```bash
sudo docker compose -f compose.jsonl.yml stop app

app_id=$(sudo docker compose \
    -f compose.jsonl.yml \
    ps -a -q app)

sudo docker cp \
    "${app_id}:/app/data/logs/game-events.jsonl" \
    /srv/tetris/import/source/game-events-final.jsonl

sudo chown ubuntu:ubuntu \
    /srv/tetris/import/source/game-events-final.jsonl

sudo chmod 400 \
    /srv/tetris/import/source/game-events-final.jsonl
```

final source도 동일 importer로 실행했다. 기존 row는 duplicate가 되고 snapshot 이후
event만 inserted된다. conflict/failure가 있으면 cutover를 중단하도록 검사했다.

### app 교체

PostgreSQL과 Caddy는 유지하고 app만 교체했다.

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

확인:

```bash
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
    'status={{.State.Status}} health={{.State.Health.Status}} oom={{.State.OOMKilled}}'

sudo docker inspect "$app_id" \
    --format='{{range .Config.Env}}{{println .}}{{end}}' \
    | grep '^GAME_EVENT_STORAGE='
```

결과:

```text
HTTPS_STATUS=200
status=running health=healthy oom=false
GAME_EVENT_STORAGE=postgres
FINAL_DB_ROWS=131
CUTOVER_OK
```

application mount에는 CA만 있고 `/app/data/logs`는 없었다.

```text
/run/secrets/postgres-ca.crt
```

따라서 dual-write가 아닌 PostgreSQL single-sink다.

### rollback 명령

production app이 healthy가 되기 전에 실패하면 보존된 JSONL volume으로 app만
복구하도록 준비했다.

```bash
sudo env APP_IMAGE_TAG=2411cd3 \
    docker compose \
    -f compose.jsonl.yml \
    up -d \
    --no-deps \
    --no-build \
    --force-recreate \
    app
```

PostgreSQL row/volume은 rollback에서 삭제하지 않는다.

## 19. 실제 gameplay write

브라우저에서 게임 한 판을 완료한 뒤 조회했다.

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
        SELECT 'total', count(*)
        FROM tetris_analytics.game_events;

        SELECT event_type, count(*)
        FROM tetris_analytics.game_events
        GROUP BY event_type
        ORDER BY event_type;
    "
```

결과:

```text
total|195
game_over|3
game_start|3
placement_decision|189
```

storage error:

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    logs --since=10m app \
    | grep -E 'write_failed|POSTGRES_EVENT|error' \
    || echo "NO_STORAGE_ERRORS"
```

결과:

```text
NO_STORAGE_ERRORS
```

## 20. app 재시작과 persistence

```bash
before=$(sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    psql \
    --username postgres \
    --dbname tetris \
    --tuples-only \
    --no-align \
    --command='SELECT count(*) FROM tetris_analytics.game_events;')

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    restart app

sleep 10

after=$(sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    psql \
    --username postgres \
    --dbname tetris \
    --tuples-only \
    --no-align \
    --command='SELECT count(*) FROM tetris_analytics.game_events;')

test "$after" -ge "$before"
printf 'DB_ROWS_BEFORE=%s\nDB_ROWS_AFTER=%s\n' "$before" "$after"
```

결과:

```text
status=running health=healthy oom=false
HTTPS_STATUS=200
DB_ROWS_BEFORE=195
DB_ROWS_AFTER=195
NO_STORAGE_ERRORS
```

최종 resource:

```text
app        30.94 MiB / 320 MiB
postgres   55.64 MiB / 256 MiB
caddy      15.77 MiB / 96 MiB

VM available memory 434 MiB
swap used 83 MiB / 2 GiB
```

## 21. 보존한 rollback 근거

| 경로/대상 | 역할 |
|---|---|
| `tetris-app:2411cd3` | 승인된 application image |
| `tetris_game_events` volume | cutover 전 JSONL 원본 |
| `/srv/tetris/import/source/game-events.jsonl` | 최초 immutable snapshot |
| `/srv/tetris/import/source/game-events-final.jsonl` | cutover 직전 snapshot |
| `/srv/tetris/import/reports/*.json` | dry-run/import 결과 |
| `/srv/tetris/backups/pre-import-2411cd3.dump` | import 전 DB backup |
| `compose.production.yml.before-c292cc6` | hotfix 전 Compose |

source, report와 backup은 `400`으로 보존했다.

## 22. 현재 상태 확인

```bash
cd /srv/tetris/repository

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    ps

curl -I https://tetra-arena.duckdns.org

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    psql \
    --username postgres \
    --dbname tetris \
    --tuples-only \
    --no-align \
    --command='SELECT count(*) FROM tetris_analytics.game_events;'

free -h
swapon --show
df -h /
sudo docker stats --no-stream
```

## 23. 학습 포인트

### 현재 shell 위치를 먼저 본다

`sudo`, `/tmp`, `docker`, `scp`는 현재 shell이 있는 컴퓨터 기준이다.

### exit code 0도 application 성공을 뜻하지 않을 수 있다

restart loop에서 process는 `set`을 정상 실행해 `exit=0`이었다. 실제 `.Path`,
`.Args`, health와 log를 함께 봐야 한다.

### Compose 최종 render를 검사한다

YAML 모양보다 `docker compose config --format json` 결과가 중요하다.

### certificate와 private key 권한은 다르다

CA certificate는 공개 정보이며 non-root application이 읽어야 한다.

### Linux 권한은 numeric UID/GID다

host `ubuntu` UID 1001과 image `node` UID 1000은 다른 사용자다.

### import 전 세 단계가 필요하다

```text
dry-run -> backup/restore rehearsal -> 실제 import
```

### 멱등성은 실제 재실행으로 증명한다

첫 inserted `131`, 두 번째 duplicate `131`, final rows `131`을 함께 확인했다.

### sink 전환 전에 생산자를 멈춘다

JSONL application을 멈추지 않으면 snapshot과 PostgreSQL app 시작 사이에 event
gap이 생길 수 있다.

## 24. 남은 후속 작업

1. local hotfix commit `c292cc6` push/PR
   - 당시 GitHub CLI 인증이 만료돼 게시하지 않았다.
   - 운영 서버에는 같은 Compose hotfix가 직접 적용돼 있다.
2. OCI SSH ingress 제한
   - 22번 포트가 넓게 열려 있다면 두 번째 SSH session을 확인한 뒤 운영자 공인
     IPv4 `/32`로 제한한다.
3. 자동 backup/retention
   - 이번 작업은 최초 backup/restore만 증명했다.
   - 주기적인 backup과 90일 retention은 별도 승인 범위다.
4. 무중단 배포
   - 이번 전환은 maintenance window를 사용했다.
   - blue-green/drain은 구현하지 않기로 결정했다.

DuckDNS token 값은 이번 대화나 제공된 terminal 화면에서 확인되지 않았다.
따라서 이번 실행 기록만을 이유로 token이 노출됐다고 판단하거나 교체하지 않는다.
실제로 command history, repository 또는 공개 log에 값이 기록된 경우에만 별도
incident로 처리한다.
