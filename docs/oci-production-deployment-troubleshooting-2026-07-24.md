# OCI 운영 배포 트러블슈팅 기록

## 1. 문서 목적

이 문서는 2026-07-23~24 OCI 운영 배포 중 실제로 만난 오류와 경고를
트러블슈팅 관점에서 정리한다.

- [전체 실행 순서](oci-production-deployment-session-2026-07-24.md)
- [명령과 옵션 해설](oci-production-deployment-command-guide-2026-07-24.md)
- [재배포 런북](oci-single-vm-deployment.md)

각 사례는 다음 순서를 따른다.

1. 재현 또는 관찰된 증상
2. 기대 동작
3. 원인 가설
4. 확인 명령과 증거
5. 근본 원인
6. 해결
7. 수정 후 검증
8. 재발 방지

password, database URL 원문, private key와 token 값은 기록하지 않는다.

## 2. 전체 진단 순서

문제가 생겼을 때 바로 설정을 바꾸지 않고 다음 순서로 경계를 좁혔다.

```text
1. 지금 shell은 어디인가?
   Mac / OCI host / container / psql
               |
2. 입력 파일과 대상 process가 실제로 존재하는가?
   pwd / hostname / ls / test / docker compose ps
               |
3. process가 무엇을 실행했는가?
   exit code / log / docker inspect Path·Args
               |
4. 접근 경계가 맞는가?
   numeric UID:GID / mode / mount / network / published port
               |
5. 데이터 불변식이 유지됐는가?
   SHA-256 / row count / duplicate·conflict / backup restore
               |
6. 외부 동작이 정상인가?
   health / HTTPS 200 / 실제 game write / restart persistence
```

빠른 기본 진단:

```bash
pwd
whoami
hostname
id
ls -la

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    ps

free -h
swapon --show
df -h /
```

이 정보 없이 “password 문제”, “Docker 문제”처럼 넓게 추측하면 정상인 계층까지
수정하게 된다.

## 3. 발생 사례 요약

| 번호 | 증상 | 근본 원인 | 영향 | 해결 |
|---:|---|---|---|---|
| 1 | directory 경로 입력 후 `permission denied` | 경로를 이동 명령이 아니라 executable로 실행 | 없음 | `cd "<path>"` 사용 |
| 2 | `ssh -i ssh -i ...` | SSH option 중복 입력 | 접속 실패 | `ssh -i <key> user@host` |
| 3 | reboot 직후 SSH reset | VM/sshd가 아직 기동 중 | 일시적 접속 불가 | 기다린 뒤 재접속 |
| 4 | Mac `sudo` password 요구 | SSH 밖에서 Mac Docker 명령 실행 | 원격 server와 무관 | prompt로 실행 위치 확인 |
| 5 | `ufw: command not found` | UFW 미설치, 기존 방화벽은 iptables | 80/443 미개방 상태 유지 | iptables rule 추가·저장 |
| 6 | GitHub username/password 인증 실패 | private repository와 GitHub password 인증 폐지 | clone/push 실패 | 검증 artifact SCP, push는 별도 |
| 7 | archive `No such file` | Mac source를 OCI shell에서 찾음 | 배포 파일 추출 불가 | Mac에서 SCP 후 hash 확인 |
| 8 | Compose·Dockerfile 모두 없음 | archive가 없는데 다음 단계 계속 진행 | 빈 repository directory | 선행 파일 존재 검증 |
| 9 | 출력이 command로 실행되거나 `/tmp/tetris-.tar.gz`를 조회 | prompt·출력·새 명령을 함께 paste해 변수 할당 실패 | 빈 tag를 사용한 연쇄 오류, 상태 변경 가능성 | `Ctrl-C`, prompt 확인, tag·artifact preflight부터 재시작 |
| 10 | PostgreSQL `Restarting (0)`, `PS2='> '` | Compose가 shell script를 여러 argument로 분리 | PostgreSQL 기동 실패 | command를 one-element list로 수정 |
| 11 | CA `Permission denied` | 공개 `ca.crt`까지 mode `600` | migration TLS 연결 실패 | certificate `644`, key `600` |
| 12 | importer `EACCES` | host UID 1001, image UID 1000 | source/report 접근 실패 | one-off container를 host UID로 실행 |
| 13 | password와 hash 혼동 | SHA-256의 역할 오해 | 접속 방법 혼란 | secret 원문은 파일, hash는 무결성 전용 |
| 14 | `initdb ... trust` warning | PostgreSQL 초기 local socket 기본 설정 | 직접 장애 아님 | port·role·TLS를 별도 검증 |
| 15 | build/Caddy warning | optional 최적화 또는 protocol별 정상 안내 | 서비스 영향 없음 | 성공 조건으로 판별 |

## 4. 사례 1 — directory 경로를 실행함

### 재현과 실제 동작

Mac shell에서 directory 경로만 입력했다.

```text
/Users/parkseongho/Downloads/테트리스 서버키
zsh: permission denied: /Users/.../테트리스 서버키
```

### 기대 동작

해당 directory로 이동하려고 했다.

### 원인 가설과 확인

shell은 첫 token을 command 이름으로 해석한다. directory는 executable이 아니므로
실행할 수 없다.

```bash
pwd
ls -ld "/Users/parkseongho/Downloads/테트리스 서버키"
```

### 근본 원인

경로와 `cd` 명령을 구분하지 않았다. 공백과 한글이 있는 경로는 quoting도
필요하다.

### 해결

```bash
cd "/Users/parkseongho/Downloads/테트리스 서버키"
pwd
```

상위 directory 이동:

```bash
cd ..
```

`cd..`은 하나의 command 이름이므로 다음 오류가 발생한다.

```text
cd..: command not found
```

### 검증과 재발 방지

`pwd`가 원하는 절대 경로인지 확인한다. prompt에 보이는 경로만 믿지 않고 파일을
사용하기 전에 `ls -lh <file>`까지 확인한다.

## 5. 사례 2 — SSH 명령 option 중복

### 재현

```text
ssh -i ssh -i tetris.key ubuntu@<OCI_PUBLIC_IP>
```

### 기대 동작

`tetris.key`를 이용해 OCI VM에 접속한다.

### 근본 원인

첫 번째 `-i` 바로 뒤의 `ssh`가 private key 경로로 해석된다. 나머지 token도
원하는 option 구조에서 벗어난다.

### 해결

Mac에서 다음 한 번만 입력한다.

```bash
ssh \
    -i "/Users/parkseongho/Downloads/테트리스 서버키/tetris.key" \
    ubuntu@<OCI_PUBLIC_IP>
```

### 검증

접속 후:

```bash
whoami
hostname
uname -r
```

기대:

```text
ubuntu
primary-vnic
6.17.0-...-oracle
```

### 재발 방지

긴 SSH 경로는 shell history에서 올바른 명령을 재사용한다. prompt 문자열과
명령을 함께 복사하지 않는다.

## 6. 사례 3 — reboot 직후 SSH connection reset

### 재현

kernel upgrade 후:

```bash
sudo reboot
```

즉시 재접속:

```text
kex_exchange_identification: read: Connection reset by peer
Connection reset by <OCI_PUBLIC_IP> port 22
```

다른 시도에서는 연결이 오래 기다리다가 `Ctrl-C`로 중단됐다.

### 기대 동작

새 kernel로 VM이 재부팅되고 SSH가 다시 열려야 한다.

### 원인 가설

1. SSH 방화벽이 잘못됐다.
2. VM 자체가 아직 boot 중이다.
3. sshd가 systemd에서 아직 준비되지 않았다.

### 확인과 증거

조금 기다린 뒤 같은 명령으로 재접속했고 성공했다.

```text
Welcome to Ubuntu 24.04.4 LTS
GNU/Linux 6.17.0-1019-oracle
```

### 근본 원인

reboot 직후의 정상적인 service 준비 시간이었다. 영구 방화벽 장애가 아니었다.

### 해결

일정 시간 뒤 재접속한다.

```bash
ssh -o ConnectTimeout=10 \
    -i "<KEY_PATH>/tetris.key" \
    ubuntu@<OCI_PUBLIC_IP>
```

### 검증

```bash
uname -r
test -f /var/run/reboot-required \
    && echo "REBOOT_STILL_REQUIRED" \
    || echo "REBOOT_COMPLETE"
```

### 재발 방지

재부팅 전 다른 terminal에 OCI console 접근 경로를 준비하고, SSH rule을 변경하는
작업과 kernel reboot를 동시에 하지 않는다.

## 7. 사례 4 — Mac과 OCI의 `sudo docker` 혼동

### 증상

SSH가 종료된 뒤 Mac prompt에서 다음을 실행했다.

```bash
sudo docker version
```

Mac 관리자 password가 요구됐고 Docker Desktop 정보가 출력됐다.

```text
OS/Arch: darwin/arm64
Context: desktop-linux
```

### 기대 동작

OCI의 Docker daemon을 확인하려고 했다.

### 근본 원인

SSH session 밖의 명령은 Mac에서 실행된다. `sudo`는 명령 대상 host를 바꾸지
않는다.

### 해결

먼저 prompt를 구분한다.

```text
parkseongho@... %         Mac
ubuntu@primary-vnic:...$  OCI
```

OCI에 접속한 후:

```bash
sudo docker version
```

### 검증

OCI 결과:

```text
OS/Arch: linux/amd64
Context: default
```

### 재발 방지

위험한 명령 전 다음을 함께 확인한다.

```bash
printf 'user=%s host=%s cwd=%s\n' \
    "$(whoami)" \
    "$(hostname)" \
    "$PWD"
```

## 8. 사례 5 — `ufw: command not found`

### 증상

```bash
sudo ufw status verbose
```

```text
sudo: ufw: command not found
```

### 기대 동작

VM firewall에서 22, 80, 443 port 상태를 확인한다.

### 원인 가설

1. UFW package가 설치되지 않았다.
2. 방화벽이 전혀 없다.
3. 다른 도구가 rule을 관리한다.

### 확인

```bash
command -v ufw || echo "UFW_NOT_INSTALLED"
sudo iptables -L INPUT -n --line-numbers
```

실제 INPUT chain에는 SSH 허용과 마지막 REJECT rule이 있었다.

### 근본 원인

UFW는 설치되지 않았지만 iptables rule은 존재했다. `ufw` 부재가 곧 방화벽
부재를 뜻하지 않았다.

### 해결

기존 iptables 체계에 80/443 rule을 중복 없이 추가했다.

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
```

### 검증

```bash
sudo iptables -L INPUT -n --line-numbers
```

관찰:

```text
5 ACCEPT tcp ... multiport dports 80,443 ctstate NEW
6 REJECT ...
```

### 재발 방지

새 firewall frontend를 설치하기 전에 현재 rule owner와 persistence 방식을
확인한다. OCI Security List와 host iptables도 둘 다 확인한다.

## 9. 사례 6 — GitHub username/password 인증 실패

### 재현

```bash
git clone \
    https://github.com/Sleepingco/Tetris_multi \
    tetris-multi
```

```text
Username for 'https://github.com': Sleepingco
Password for 'https://Sleepingco@github.com':
remote: Invalid username or token.
Password authentication is not supported for Git operations.
```

### 기대 동작

OCI에서 repository를 clone해 application source를 받는다.

### 원인 가설

1. username 오타
2. account password 오류
3. private repository 인증 필요

### 확인

같은 명령이 credential prompt를 다시 표시했고 password 인증 불가를 명시했다.
후속 local hotfix에서 `gh auth status`도 만료된 credential을 보고했다.

### 근본 원인

- repository 접근에 인증이 필요했다.
- GitHub는 account password 기반 Git HTTPS 인증을 지원하지 않는다.
- GitHub CLI credential도 당시 유효하지 않았다.

### 해결

배포를 GitHub 인증 복구와 분리했다.

```text
Mac의 검증된 source
    -> tar.gz artifact
    -> SCP
    -> OCI에서 SHA-256 확인
```

hotfix도 전체 repository clone 대신 검증된 `compose.production.yml` 한 파일만
SCP로 전달했다.

### 검증

```bash
sha256sum /tmp/tetris-2411cd3.tar.gz
sha256sum /tmp/compose.production.c292cc6.yml
```

source host와 OCI의 hash가 같음을 확인했다.

### 재발 방지

운영 배포 방법을 다음 중 하나로 명시한다.

- CI가 만든 immutable artifact
- deploy key를 사용하는 read-only SSH clone
- 최소 scope PAT를 사용하는 HTTPS clone

account password 입력은 해결책이 아니다. GitHub push/PR 인증과 이미 만들어진
artifact의 OCI 실행도 서로 다른 문제다.

## 10. 사례 7 — SCP source file이 없음

### 재현

OCI SSH session 안에서:

```bash
scp \
    -i "/Users/parkseongho/Downloads/테트리스 서버키/tetris.key" \
    /tmp/tetris-2411cd3.tar.gz \
    ubuntu@<OCI_PUBLIC_IP>:/tmp/
```

```text
scp: stat local "/tmp/tetris-2411cd3.tar.gz": No such file or directory
```

### 기대 동작

Mac의 archive를 OCI `/tmp`로 보낸다.

### 원인 가설

1. archive 생성 실패
2. 경로 오타
3. 명령을 잘못된 host에서 실행

### 확인

OCI에서:

```bash
hostname
ls -lh /tmp/tetris-2411cd3.tar.gz
```

파일이 없었다. SSH에서 `exit`한 뒤 Mac에서 SCP를 실행하자 전송됐고 OCI에서
다음 결과를 확인했다.

```text
-rw-r--r-- 1 ubuntu ubuntu 5.1M ... /tmp/tetris-2411cd3.tar.gz
```

### 근본 원인

`scp`의 “local”은 현재 shell이 있는 컴퓨터다. OCI shell에서 실행했기 때문에
Mac의 `/tmp`가 아니라 OCI의 `/tmp`를 source로 찾았다.

### 해결

```bash
exit
```

Mac prompt에서:

```bash
test -s /tmp/tetris-2411cd3.tar.gz

scp \
    -i "<KEY_PATH>/tetris.key" \
    /tmp/tetris-2411cd3.tar.gz \
    ubuntu@<OCI_PUBLIC_IP>:/tmp/
```

### 검증

OCI:

```bash
ls -lh /tmp/tetris-2411cd3.tar.gz
sha256sum /tmp/tetris-2411cd3.tar.gz
```

관찰된 SHA-256:

```text
9aa909cdf0e4a78bfa78ed7f1d233c4ed456e0bfd8ea643154fb31c074cbe8dc
```

### 재발 방지

SCP 전에 source host에서 항상 다음을 실행한다.

```bash
hostname
test -s <source>
sha256sum <source>
```

## 11. 사례 8 — archive 없이 다음 단계 진행

### 증상

archive가 없는 상태에서:

```bash
sha256sum /tmp/tetris-2411cd3.tar.gz
tar -xzf /tmp/tetris-2411cd3.tar.gz \
    -C /srv/tetris/repository
```

```text
No such file or directory
tar: Child returned status 2
```

그 뒤:

```bash
cd /srv/tetris/repository
ls compose.jsonl.yml Caddyfile Dockerfile package.json
```

모든 파일이 없었다.

### 기대 동작

archive가 추출되고 Compose, Caddy, Dockerfile과 package metadata가 존재한다.

### 원인 가설

파일명이 틀렸거나 archive 내부 경로가 한 단계 더 중첩됐을 수 있었다.

### 확인

선행 `sha256sum`부터 파일 없음으로 실패했으므로 archive 구조 문제가 아니었다.

### 근본 원인

선행 단계가 실패했는데 다음 명령을 계속 실행했다. 생성한 빈 destination
directory 때문에 `cd` 자체는 성공해 오류 경계를 놓치기 쉬웠다.

### 해결

archive 전송 후 단계별 guard를 둔다.

```bash
set -eu

archive=/tmp/tetris-2411cd3.tar.gz
destination=/srv/tetris/repository

test -s "$archive"
tar -tzf "$archive" >/dev/null
tar -xzf "$archive" -C "$destination"

test -f "$destination/compose.jsonl.yml"
test -f "$destination/Caddyfile"
test -f "$destination/Dockerfile"
test -f "$destination/package.json"
```

### 검증

```bash
cd /srv/tetris/repository
ls \
    compose.jsonl.yml \
    compose.production.yml \
    Caddyfile \
    Dockerfile \
    package.json
```

다섯 파일이 모두 출력됐다.

### 재발 방지

오류가 발생하면 해당 단계의 성공 조건을 확인하기 전 다음 단계로 넘어가지 않는다.
긴 명령 묶음은 `set -eu`로 실패 즉시 중단한다.

## 12. 사례 9 — prompt와 출력까지 shell에 paste

### 증상

명령뿐 아니라 이전 prompt와 출력 전체가 shell에 들어갔다.

```text
-bash: ubuntu@primary-vnic:/srv/tetris/repository$: No such file or directory
NAME: command not found
-bash: syntax error near unexpected token `('
accept-ranges:: command not found
content-security-policy:: command not found
```

### 기대 동작

`docker compose ps`, `curl`, `free`, `docker stats` 명령만 다시 실행하려고 했다.

### 근본 원인

terminal 출력의 각 줄을 shell이 새 command로 해석했다.

- prompt 문자열 `ubuntu@...$`도 command로 해석
- HTTP header의 `accept-ranges:`도 command로 해석
- container 표의 `NAME`도 command로 해석

새 배포 명령 앞에 이전 command 조각이 남아 있으면 첫 변수 할당도 실패할 수 있다.

```text
)new_tag=87d6e29
-bash: syntax error near unexpected token `)'
sha256sum: /tmp/tetris-.tar.gz: No such file or directory
open /srv/tetris/builds/compose.production.yml: no such file or directory
Error response from daemon: invalid reference format
```

이 경우 `new_tag`가 설정되지 않았지만 interactive shell은 다음 줄을 계속
실행한다. 그 결과 `${new_tag}`가 빈 문자열로 확장되어 잘못된 artifact, build
directory와 Docker image reference가 연쇄적으로 만들어진다.

### 해결

즉시:

```text
Ctrl-C
```

현재 prompt가 돌아온 것을 확인하고 명령 block만 다시 paste한다.

```bash
sudo docker compose -f compose.jsonl.yml ps
curl -I https://tetra-arena.duckdns.org
```

새 version 준비 중이었다면 먼저 현재 production이 바뀌지 않았는지 확인한다.

```bash
cd /srv/tetris/repository

sed -n \
    's/^APP_IMAGE_TAG=/ACTIVE_IMAGE_TAG=/p' \
    /srv/tetris/secrets/production.env

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    ps
```

그다음 [PostgreSQL 운영 Runbook의 OCI source와 image 준비
단계](postgres-production-runbook.md#2-oci-source와-image-준비)를 처음부터 다시
실행한다. 새 preflight는 다음 조건에서 build 전에 중단한다.

- `new_tag`가 7~40자리 lowercase hexadecimal Git SHA가 아님
- `/tmp/tetris-${new_tag}.tar.gz`가 없거나 비어 있음
- `/srv/tetris/builds/${new_tag}`가 이미 존재함
- archive 또는 필수 build 파일 검증 실패

실패한 build directory가 존재한다면 자동 삭제하지 않는다. tag와 directory
내용을 확인해 이미 검증된 결과인지, 격리할지, 새 commit tag로 다시 시작할지를
운영자가 결정한다.

### 검증

`Ctrl-C` 후 app/Caddy 상태와 HTTPS를 다시 확인했고 둘 다 정상이었다.

### 재발 방지

- prompt의 `$`, `%` 뒤에 있는 명령만 복사한다.
- 출력은 다시 terminal에 paste하지 않는다.
- 여러 줄 command는 code block의 시작과 끝을 확인한다.
- 변수와 경로를 사용하기 전에 `printf`로 실제 값을 출력한다.
- 여러 단계가 연결된 준비 작업은 `set -euo pipefail` subshell 안에서 실행한다.
- command 실행 중 예상하지 못한 continuation prompt가 나오면 무작정 Enter를
  누르지 말고 `Ctrl-C`로 취소한다.

## 13. 사례 10 — PostgreSQL restart loop

### 재현과 실제 동작

PostgreSQL service 시작:

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    up -d postgres
```

상태:

```text
tetris-postgres-1  Restarting (0)
postgres-1 | PS2='> '
```

### 기대 동작

PostgreSQL process가 실행되고 health check가 `healthy`가 되어야 한다.

### 초기 가설

1. PostgreSQL password 또는 초기 database 설정 오류
2. TLS key/certificate 오류
3. memory 부족과 OOM
4. Compose entrypoint/command 변환 오류

### 확인 명령

```bash
sudo docker inspect tetris-postgres-1 \
    --format \
    'path={{json .Path}} args={{json .Args}} exit={{.State.ExitCode}} restarts={{.RestartCount}} error={{json .State.Error}}'

sudo docker inspect tetris-postgres-1 \
    --format \
    'entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}}'
```

증거:

```text
path="/bin/sh"
args=["-c","set","-eu","mkdir",...]
exit=0
restarts=15
error=""
```

### 가설 배제

- `exit=0`: PostgreSQL crash나 TLS fatal error 형태가 아니었다.
- `OOMKilled=false`: memory 강제 종료가 아니었다.
- `.State.Error=""`: Docker runtime 오류가 아니었다.
- `.Args`: shell에 전체 script 한 개가 아니라 `set`, `-eu`, `mkdir` 등이
  각각 분리돼 전달됐다.

### 근본 원인

Compose 2.40.3 render에서 다음 YAML의 block command가 shell script 하나로
보존되지 않았다.

```yaml
entrypoint:
  - /bin/sh
  - -c
command: |
  set -eu
  mkdir -p ...
  exec docker-entrypoint.sh postgres ...
```

`sh -c`는 바로 다음 argument인 `set`만 command string으로 실행했다.
`set`은 shell 변수를 출력하고 정상 종료하므로 `exit=0`과 `PS2='> '`가 나왔다.
restart policy가 정상 종료한 container를 계속 다시 시작했다.

### 안전 조치

원인 수정 전에 PostgreSQL만 멈췄다.

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    stop postgres
```

JSONL app과 Caddy는 유지했다.

```bash
sudo docker compose -f compose.jsonl.yml ps
curl -I https://tetra-arena.duckdns.org
```

HTTPS는 계속 `200`이었다.

### 해결

`command`를 one-element list로 명시했다.

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

regression check도 최종 Compose JSON에서 command argument 수와 내용을
검사하도록 추가했다. local hotfix commit:

```text
c292cc6 fix: preserve PostgreSQL startup command
```

### 수정 후 검증

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

### 재발 방지

- YAML source만 보지 않고 `docker compose config --format json`을 검사한다.
- `sh -c`에는 script가 정확히 한 argument로 전달되는지 test한다.
- `running`뿐 아니라 health, restart count, OOM 상태를 확인한다.
- `exit=0`도 원하는 server가 실행됐다는 뜻은 아니다.

## 14. 사례 11 — CA certificate permission 실패

### 재현

migration container:

```text
Warning: Ignoring extra certs from
`/run/secrets/postgres-ca.crt`, load failed:
Permission denied
MIGRATION_CONNECTION_FAILED
```

### 기대 동작

Node가 private CA를 신뢰해 `sslmode=verify-full` PostgreSQL 연결을 만들고
migration을 적용해야 한다.

### 초기 가설

1. certificate 내용 또는 signature가 잘못됨
2. hostname `postgres`가 SAN과 다름
3. bind mount 경로가 틀림
4. container process가 파일을 읽을 수 없음

### 확인

host certificate 자체:

```bash
openssl verify \
    -CAfile /srv/tetris/certs/ca.crt \
    /srv/tetris/certs/postgres.crt

openssl x509 \
    -in /srv/tetris/certs/postgres.crt \
    -noout \
    -checkhost postgres
```

결과:

```text
/srv/tetris/certs/postgres.crt: OK
Hostname postgres does match certificate
```

파일 mode:

```bash
stat -c '%a %U:%G %n' \
    /srv/tetris/certs/ca.crt \
    /srv/tetris/certs/ca.key \
    /srv/tetris/certs/postgres.crt \
    /srv/tetris/certs/postgres.key
```

CA certificate까지 `600 ubuntu:ubuntu`였다. application image는
`uid=1000(node)`로 실행됐다.

### 근본 원인

secret 생성 전 사용한 `umask 077`이 `.key`뿐 아니라 공개 `.crt`에도 적용됐다.
bind mount는 host permission을 유지하므로 container의 `node`가 `ca.crt`를
읽지 못했다.

### 해결

```bash
chmod 644 \
    /srv/tetris/certs/ca.crt \
    /srv/tetris/certs/postgres.crt

chmod 600 \
    /srv/tetris/certs/ca.key \
    /srv/tetris/certs/postgres.key
```

certificate는 공개 정보지만 private key는 비밀이다.

### 수정 후 검증

첫 migration:

```text
PostgreSQL migrations applied=2 skipped=0
```

재실행:

```text
PostgreSQL migrations applied=0 skipped=2
```

### 재발 방지

TLS 파일을 “전부 secret”으로 같은 mode를 주지 않는다.

| 파일 | mode |
|---|---:|
| CA/server private key `.key` | `600` |
| CA/server certificate `.crt` | `644` |

certificate signature, hostname, permission과 mount를 서로 다른 검사로 확인한다.

## 15. 사례 12 — importer `EACCES`

### 재현

report directory owner를 `ubuntu`로 맞추고 mode `700`으로 설정했지만
dry-run이 계속 실패했다.

```text
EACCES
```

container 내부 진단:

```text
uid=1000(node) gid=1000(node)
400 1001:1001 /run/game-events.jsonl
700 1001:1001 /run/reports
SOURCE_DENIED
REPORT_DIRECTORY_DENIED
```

host:

```text
uid=1001(ubuntu) gid=1001(ubuntu)
```

### 기대 동작

importer가 immutable source를 읽고 report directory에 JSON report를 써야 한다.

### 초기 가설

1. source file이 잘못됨
2. report file이 이미 root owner로 존재
3. directory execute bit가 없음
4. host와 container 사용자가 다름

### 확인 명령

host:

```bash
id
stat -c '%a %u:%g %n' \
    /srv/tetris/import/source \
    /srv/tetris/import/source/game-events.jsonl \
    /srv/tetris/import/reports
```

container:

```bash
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

### 근본 원인

Linux filesystem은 사용자 이름이 아니라 numeric UID/GID를 비교한다.

```text
host ubuntu = UID 1001
image node  = UID 1000
```

두 사용자 이름의 의미와 관계없이 서로 다른 owner다. `chown ubuntu:ubuntu`만으로
container `node` 접근은 해결되지 않는다.

### 고려했지만 사용하지 않은 해결

```bash
chmod 777 /srv/tetris/import/reports
chmod 444 /srv/tetris/import/source/game-events.jsonl
```

이 방법은 불필요하게 모든 local 사용자에게 접근을 넓히므로 사용하지 않았다.

### 해결

one-off importer만 host UID/GID로 실행했다.

```bash
sudo docker run --rm \
    --user "$(id -u):$(id -g)" \
    ...
```

host directory mode `700`, source mode `400`을 유지하면서 importer process의
numeric identity만 owner와 맞췄다.

### 수정 후 검증

dry-run:

```text
ok=true
lineCount=131
failures=0
completeGameCount=2
```

첫 import:

```text
attempted=131 inserted=131 duplicate=0 conflict=0 failed=0
```

### 재발 방지

bind mount permission 문제에서는 이름보다 다음 세 가지를 같이 본다.

```bash
id
stat -c '%a %u:%g %n' <host-path>
docker run --rm <image> id
```

named volume과 bind mount의 owner model도 구분한다.

## 16. 사례 13 — password와 SHA-256 혼동

### 질문

PostgreSQL 접속 password가 전에 만든 hash 파일인지 혼동이 있었다.

### 구분

```text
password file 원문
    -> PostgreSQL LOGIN 인증에 사용

SHA-256
    -> 파일 bytes가 같은지 확인
    -> password 대신 인증에 사용할 수 없음
```

예:

```bash
openssl rand -hex 24 \
    > /srv/tetris/secrets/runtime-password

sha256sum /srv/tetris/import/source/game-events.jsonl
```

첫 명령은 실제 random password를 생성한다. 두 번째 명령은 JSONL 파일의
fingerprint를 계산한다.

### 안전한 확인

secret 원문을 출력하지 않는다.

```bash
test -s /srv/tetris/secrets/runtime-password
stat -c '%a %U:%G %s %n' \
    /srv/tetris/secrets/runtime-password
```

env 파일도 key 이름만 확인한다.

```bash
cut -d= -f1 \
    /srv/tetris/secrets/production.env \
    /srv/tetris/secrets/migration.env \
    /srv/tetris/secrets/import.env
```

### 재발 방지

- password: 인증을 위한 비밀 원문
- hash: 무결성을 비교하는 공개 가능한 fingerprint
- private key: 서명·복호화 권한을 가진 비밀
- certificate: public key와 identity를 담은 공개 자료

역할을 섞지 않는다.

## 17. 사례 14 — PostgreSQL `trust` warning

### 관찰

최초 database 초기화 log:

```text
initdb: warning: enabling "trust" authentication for local connections
```

### 오해 가능성

“외부 누구나 password 없이 PostgreSQL 5432에 접속할 수 있다”로 해석할 수 있다.

### 실제 확인

host port:

```bash
sudo docker inspect tetris-postgres-1 \
    --format 'ports={{json .NetworkSettings.Ports}}'
```

```text
{"5432/tcp":null}
```

network:

```text
tetris_database
```

role:

```text
tetris_runtime, tetris_import, tetris_migration, tetris_maintenance
LOGIN password 사용
NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION
```

application 연결은 `sslmode=verify-full`을 사용했다.

### 판단

이 warning은 초기화 과정의 local connection 설정 안내였다. PostgreSQL port가
host에 publish됐다는 증거가 아니며 application role의 password/TLS 검증 실패도
아니었다.

### 검증

- host published port 없음
- internal Docker network만 연결
- runtime/migration/import credential 분리
- CA와 hostname 검증
- role privilege 검사

### 재발 방지

warning 한 줄만으로 security 경계를 판단하지 않는다. `pg_hba.conf`, published
port, Docker network, role과 실제 connection string을 함께 본다.

## 18. 사례 15 — 장애가 아니었던 Docker/Caddy 경고

### buildx/Bake warning

```text
Docker Compose is configured to build using Bake,
but buildx isn't installed
```

판단 근거:

```text
[+] Building ... FINISHED
[+] Building 1/1
app Built
```

기본 builder가 image build를 완료했으므로 deployment blocker가 아니었다.

검증:

```bash
sudo docker image inspect tetris-app:2411cd3 \
    --format \
    'image={{.RepoTags}} architecture={{.Architecture}} size={{.Size}}'
```

### Caddy UDP receive buffer warning

```text
failed to sufficiently increase receive buffer size
```

HTTP/3/QUIC 성능 관련 kernel buffer warning이다. 다음 성공 증거가 있었다.

```text
server running protocols=["h1","h2","h3"]
certificate obtained successfully
HTTPS HTTP/2 200
```

현재 traffic에서 기능 장애가 없으므로 kernel tuning을 즉시 추가하지 않았다.

### port 80의 HTTP/2/HTTP/3 skipped warning

```text
HTTP/2 skipped because it requires TLS
HTTP/3 skipped because it requires TLS
addr=:80
```

port 80은 HTTPS redirect용 plain HTTP listener다. TLS protocol을 port 80에서
사용하지 않는다는 정상 안내다.

검증:

```text
HTTP  308 -> HTTPS
HTTPS 200
```

### 교훈

warning은 다음 세 종류로 나눈다.

| 종류 | 예 | 행동 |
|---|---|---|
| 기능 실패 | CA permission 때문에 migration 실패 | 즉시 원인 해결 |
| degraded optimization | QUIC receive buffer | 관측 후 필요할 때 tuning |
| 정상 안내 | port 80에서 HTTP/2 skip | 변경하지 않음 |

## 19. 예방 조치 — 1 GiB VM의 memory

### 관찰

초기 VM:

```text
RAM 954 MiB
swap 0
available 약 550 MiB
```

PostgreSQL과 app을 함께 운영하면 순간 memory pressure에 취약할 수 있었다.

### 조치

2 GiB swap을 만들고 container limit을 사용했다.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

최종 관찰:

```text
app        30.94 MiB / 320 MiB
postgres   55.64 MiB / 256 MiB
caddy      15.77 MiB / 96 MiB
available  434 MiB
swap used  83 MiB / 2 GiB
OOM        false
```

### 판단

swap 사용 자체는 장애가 아니다. swap이 지속적으로 증가하고 latency가 악화되거나
OOM이 발생하는지가 중요하다.

### 재발 방지

```bash
free -h
swapon --show
sudo docker stats --no-stream
sudo docker inspect <container-id> \
    --format 'oom={{.State.OOMKilled}}'
```

`free` column만 보지 않고 `available`, swap 추세와 container limit을 함께 본다.

## 20. import·backup 단계에서 사용한 방어선

이 단계에서는 실제 장애보다 데이터 손실을 막는 사전 검증이 중요했다.

### dry-run

DB write 없이 source를 검증했다.

```text
source lines=131
canonical events=131
duplicates=0
conflicts=0
failures=0
complete games=2
writes=0
```

### backup

```bash
pg_dump --format=custom
sha256sum /srv/tetris/backups/pre-import-2411cd3.dump
pg_restore --list
```

backup 파일이 존재하는 것만으로 복구 가능성을 증명하지 않는다.

### restore rehearsal

production이 아닌 임시 DB에 복원했다.

```text
tetris_restore_check
migrations=2
events=0
owner=tetris_migration
runtime ACL 정상
```

검증 뒤 임시 DB만 삭제했다.

### idempotent import

```text
첫 실행: inserted=131 duplicate=0
둘째 실행: inserted=0 duplicate=131
conflict=0 failed=0
```

duplicate 131은 실패가 아니라 같은 source를 안전하게 재실행할 수 있다는 성공
증거다.

## 21. cutover 중 확인한 장애 격리

### JSONL app 유지

PostgreSQL restart loop를 고치는 동안 기존 JSONL app과 Caddy를 정지하지 않았다.

```bash
sudo docker compose -f compose.jsonl.yml ps
curl -I https://tetra-arena.duckdns.org
```

HTTPS `200`을 유지했다.

### single-sink 전환

event gap을 막기 위해 다음 순서를 사용했다.

```text
JSONL app stop
    -> final snapshot
    -> idempotent final import
    -> PostgreSQL app start
```

이 과정은 짧은 maintenance window이며 무중단 배포는 아니다.

### 성공 조건

```text
app healthy
PostgreSQL healthy
Caddy running
HTTPS 200
GAME_EVENT_STORAGE=postgres
final DB rows=131
storage error 없음
```

### 실제 game write

cutover 뒤 한 게임을 완료했다.

```text
DB rows 131 -> 195
game_start 2 -> 3
game_over 2 -> 3
storage error 없음
```

app restart 후:

```text
DB rows 195 -> 195
app healthy
HTTPS 200
OOM false
```

### rollback 원칙

production app이 healthy가 되기 전에 실패하면 JSONL app만 복구하도록 준비했다.
다음은 삭제하지 않는다.

- PostgreSQL volume
- 이미 import한 rows
- JSONL volume
- immutable snapshots
- import reports
- pre-import backup

## 22. DuckDNS token 노출 오판 정정

### 이전 문서 문제

기존 런북에 “화면에 노출됐던 DuckDNS token”이라는 문장이 있었지만 제공된
terminal 화면과 대화에는 token 값이 없었다.

### 근본 원인

실제 증거 없이 일반적인 security 권고를 이번 incident의 사실처럼 적었다.

### 수정

런북을 조건문으로 바꿨다.

```text
token이 terminal, log 또는 repository에 실제 노출됐다면 재발급한다.
```

### 교훈

credential rotation은 안전한 조치지만 “노출 사고가 있었다”는 사실 판단과는
분리해야 한다.

확인할 곳:

```bash
history
git grep -n 'DUCKDNS\\|token'
```

history 출력에는 다른 secret이 포함될 수 있으므로 공개 channel에 그대로 붙이지
않는다.

## 23. 다음 장애에서 사용할 체크리스트

### file/path

```bash
pwd
hostname
test -s <file>
ls -lh <file>
sha256sum <file>
```

### process

```bash
sudo docker compose -f <compose-file> ps
sudo docker compose -f <compose-file> logs --tail=100 <service>
sudo docker inspect <container> \
    --format \
    'path={{json .Path}} args={{json .Args}} exit={{.State.ExitCode}} health={{if .State.Health}}{{.State.Health.Status}}{{end}} oom={{.State.OOMKilled}}'
```

### permission

```bash
id
stat -c '%a %u:%g %n' <path>
sudo docker run --rm <image> id
```

### network

```bash
getent ahostsv4 tetra-arena.duckdns.org
sudo iptables -L INPUT -n --line-numbers
curl -I http://tetra-arena.duckdns.org
curl -I https://tetra-arena.duckdns.org
sudo docker inspect <container> \
    --format \
    'ports={{json .NetworkSettings.Ports}} networks={{json .NetworkSettings.Networks}}'
```

### data

```bash
sha256sum <snapshot>
wc -l <snapshot>
pg_restore --list < <backup>
```

PostgreSQL에서는 source count, event type count, conflict/failure와 migration
version을 함께 확인한다.

### 중단 기준

다음 중 하나면 다음 단계로 진행하지 않는다.

- 선행 파일 또는 container가 없음
- health가 `healthy`가 아님
- OOM 발생
- HTTPS가 `200`이 아님
- migration failure
- dry-run failure/conflict
- backup restore rehearsal 실패
- import conflict/failure
- final source hash 또는 row count 불일치
- runtime preflight 실패

오류를 숨기기 위해 permission을 넓히거나 data volume을 삭제하지 않는다.
