# OCI 운영 배포 명령어 해설

## 1. 문서 목적

이 문서는 [OCI 단일 VM 운영 배포 실행 기록](oci-production-deployment-session-2026-07-24.md)에
사용된 명령을 나중에 다시 공부할 수 있도록 해설한다.
실제 오류별 원인 추적은
[OCI 운영 배포 트러블슈팅 기록](oci-production-deployment-troubleshooting-2026-07-24.md)을
참고한다.

실행 기록은 당시의 순서·출력·장애를 보존하고, 이 문서는 다음 질문에 답한다.

1. 왜 이 명령이 필요한가?
2. 각 옵션은 무엇을 바꾸는가?
3. 성공 여부를 어떻게 확인하는가?
4. 다시 실행해도 되는가?

`<OCI_PUBLIC_IP>`, `<KEY_PATH>`, `<approved-main-sha>` 같은 표시는 실제 환경에
맞게 바꾸는 자리다. password, token, private key 원문은 문서에 넣지 않는다.

## 2. 명령을 실행할 위치

### Mac과 OCI VM 구분

```text
parkseongho@... %              # Mac
ubuntu@primary-vnic:...$       # OCI VM
```

명령은 현재 shell이 열린 컴퓨터에서 실행된다.

```text
Mac /tmp  !=  OCI /tmp  !=  Docker container /tmp
```

예를 들어 Mac의 `/tmp/tetris-2411cd3.tar.gz`를 OCI로 보낼 때 `scp`는 Mac에서
실행해야 한다. OCI SSH session 안에서 실행하면 OCI의 `/tmp`에서 source를
찾으므로 `No such file or directory`가 발생한다.

### 기본 위치 확인

```bash
pwd
whoami
hostname
ls -la
```

| 명령 | 의미 |
|---|---|
| `pwd` | 현재 작업 directory의 절대 경로를 출력한다. |
| `whoami` | 현재 shell 사용자 이름을 출력한다. |
| `hostname` | 명령을 실행 중인 컴퓨터 이름을 출력한다. |
| `ls -la` | 숨김 파일을 포함한 directory 내용을 자세히 출력한다. |

`sudo` password가 Mac에서 요구되면 Mac의 관리자 password다. OCI에 SSH로
접속한 뒤 요구되면 OCI 사용자 권한과 관련된 동작이다.

## 3. shell 문법

배포 명령을 이해하려면 개별 프로그램보다 shell이 명령을 조합하는 방식을 먼저
알아야 한다.

### 줄 연결 `\`

```bash
sudo docker compose \
    -f compose.jsonl.yml \
    ps
```

줄 끝의 `\`는 다음 줄을 같은 명령으로 연결한다. `\` 뒤에 공백이 있으면 연결되지
않을 수 있다.

위 명령은 다음 한 줄과 같다.

```bash
sudo docker compose -f compose.jsonl.yml ps
```

### 작은따옴표와 큰따옴표

```bash
echo '$HOME'
echo "$HOME"
```

- 작은따옴표 `'...'`: 내부의 `$`, `*`, 공백을 문자 그대로 취급한다.
- 큰따옴표 `"..."`: 공백은 보존하지만 `$variable`, `$(command)`는 확장한다.

password가 들어간 URL이나 경로는 shell 분리를 막기 위해 큰따옴표 안에서
조립한다. 값을 화면에 출력하는 `echo`는 사용하지 않는다.

### command substitution `$()`

```bash
runtime_password=$(cat /srv/tetris/secrets/runtime-password)
```

괄호 안의 명령 출력을 변수에 저장한다. 위 명령은 파일 내용을
`runtime_password` 변수에 넣는다.

이 변수는 현재 shell process에만 존재한다. 사용 후 다음처럼 제거한다.

```bash
unset runtime_password
```

### pipe `|`

```bash
sha256sum file.tar.gz | awk '{print $1}'
```

왼쪽 명령의 표준 출력을 오른쪽 명령의 표준 입력으로 전달한다.

- `sha256sum`: hash와 파일명을 출력한다.
- `awk '{print $1}'`: 첫 번째 field인 hash만 선택한다.

pipeline 중간의 명령이 실패해도 마지막 명령이 성공할 수 있다. 중요한 script라면
다음 설정을 사용한다.

```bash
set -o pipefail
```

### redirect

```bash
command > output.txt
command >> output.txt
command 2>/dev/null
command < input.dump
```

| 문법 | 의미 |
|---|---|
| `>` | 표준 출력을 새 파일로 저장한다. 기존 파일은 덮어쓴다. |
| `>>` | 표준 출력을 기존 파일 끝에 추가한다. |
| `2>` | 오류 출력을 redirect한다. |
| `/dev/null` | 전달된 출력을 버린다. |
| `<` | 파일을 명령의 표준 입력으로 전달한다. |

backup에서 `pg_dump > "$backup"`을 사용하면 dump bytes가 host 파일에
저장된다. 반대로 `pg_restore < "$backup"`은 host 파일을 container 안의
`pg_restore` 표준 입력으로 전달한다.

### 성공할 때만 실행 `&&`

```bash
test -s file.jsonl \
    && echo "FILE_OK"
```

왼쪽 명령의 종료 code가 `0`일 때만 오른쪽 명령을 실행한다.

### 실패할 때 실행 `||`

```bash
grep -E 'write_failed|error' app.log \
    || echo "NO_STORAGE_ERRORS"
```

왼쪽 명령이 일치 항목을 찾지 못해 non-zero로 끝날 때 오른쪽 명령을 실행한다.

주의할 점은 `grep` 자체가 파일을 읽지 못한 경우도 non-zero라는 것이다. 중요한
검증에서는 원본 명령이 정상 실행됐는지도 별도로 확인한다.

### subshell `( ... )`

```bash
(
    set -eu
    temporary=/tmp/example
    touch "$temporary"
)
```

괄호 안은 별도 shell에서 실행된다. 내부 변수와 `cd` 결과가 바깥 shell에 남지
않는다. 여러 명령을 하나의 실패 단위로 묶을 때 사용했다.

### `set -eu`

```bash
set -eu
```

- `-e`: 명령이 실패하면 script를 중단한다.
- `-u`: 정의되지 않은 변수를 사용하면 중단한다.

배포 script가 중간 실패 후 다음 destructive 단계로 넘어가는 것을 막는다.

더 강한 pipeline 검사가 필요하면 다음 형태를 사용한다.

```bash
set -euo pipefail
```

### `umask 077`

```bash
umask 077
```

새 파일에서 group과 other 권한을 기본적으로 제거한다. secret과 private key를
생성할 때 사용한다.

certificate인 `.crt`는 비밀값이 아니며 application이 읽어야 하므로 생성 후
`644`로 별도 조정한다. private key인 `.key`는 `600`을 유지한다.

### `test`

```bash
test -f file
test -s file
test -n "$value"
test ! -e file
```

| 검사 | 의미 |
|---|---|
| `-f` | 일반 파일인지 확인한다. |
| `-s` | 파일이 존재하고 크기가 0보다 큰지 확인한다. |
| `-n` | 문자열이 비어 있지 않은지 확인한다. |
| `! -e` | 파일이나 directory가 아직 존재하지 않는지 확인한다. |

`test ! -e`는 기존 backup이나 snapshot을 실수로 덮어쓰지 않게 한다.

### `trap`

```bash
resumeApp() {
    sudo docker compose -f compose.jsonl.yml unpause app \
        >/dev/null 2>&1 || true
}

trap resumeApp EXIT
```

현재 shell이 성공하거나 실패해 종료될 때 `resumeApp`을 실행한다. snapshot 복사
중 오류가 나더라도 app이 계속 pause된 상태로 남는 것을 방지한다.

정상적으로 직접 unpause한 뒤에는 trap을 제거한다.

```bash
trap - EXIT
```

### heredoc

```bash
psql <<'SQL'
SELECT current_database();
SQL
```

`SQL` 사이의 여러 줄을 `psql` 표준 입력으로 전달한다.

- `<<'SQL'`: shell variable을 확장하지 않는다.
- `<<SQL`: `$variable`을 먼저 확장한다.

role password를 shell 변수에서 SQL로 전달했던 최초 provisioning에서는
`<<SQL`을 사용했다. 일반 권한 SQL은 실수로 `$`가 확장되지 않도록
`<<'SQL'`을 사용했다.

## 4. SSH와 파일 전송

### SSH 접속

Mac에서 실행한다.

```bash
ssh -i "<KEY_PATH>/tetris.key" ubuntu@<OCI_PUBLIC_IP>
```

| 부분 | 의미 |
|---|---|
| `ssh` | 암호화된 remote shell을 연다. |
| `-i` | 사용할 private key 파일을 지정한다. |
| `ubuntu@...` | remote 사용자와 server 주소다. |

`ssh -i ssh -i ...`처럼 `ssh -i`를 중복 입력하면 첫 번째 `-i`의 key 경로로
문자열 `ssh`를 해석하게 된다.

접속 전 key 권한은 Mac에서 제한한다.

```bash
chmod 600 "<KEY_PATH>/tetris.key"
```

private key는 소유자만 읽고 쓸 수 있게 한다.

### SCP 전송

Mac에서 실행한다.

```bash
scp \
    -i "<KEY_PATH>/tetris.key" \
    /tmp/tetris-2411cd3.tar.gz \
    ubuntu@<OCI_PUBLIC_IP>:/tmp/
```

`scp`는 SSH를 이용해 파일을 복사한다.

- 첫 번째 경로: Mac의 source 파일
- 마지막 경로: OCI의 destination
- `:/tmp/`: colon 앞은 remote host, 뒤는 remote 경로

전송 전후 hash를 비교한다.

```bash
sha256sum /tmp/tetris-2411cd3.tar.gz
```

Mac과 OCI에서 같은 SHA-256이 나오면 전송 중 bytes가 바뀌지 않았다는 뜻이다.
SHA-256은 password가 아니라 파일 무결성 확인값이다.

### archive 풀기

OCI에서 실행한다.

```bash
tar -xzf /tmp/tetris-2411cd3.tar.gz \
    -C /srv/tetris/repository
```

| 옵션 | 의미 |
|---|---|
| `-x` | archive에서 파일을 추출한다. |
| `-z` | gzip 압축을 해제한다. |
| `-f` | 다음 argument를 archive 파일명으로 사용한다. |
| `-C` | 추출 전에 destination directory로 이동한다. |

기존 repository에 다시 풀면 같은 이름의 파일을 덮어쓸 수 있다. 새 배포 artifact는
빈 release directory에 풀거나 backup을 확보한 뒤 사용한다.

### directory와 파일 설치

```bash
sudo install -d \
    -o ubuntu \
    -g ubuntu \
    -m 750 \
    /srv/tetris/repository
```

`install -d`는 directory를 만들면서 owner, group과 mode를 한 번에 설정한다.

- `-o ubuntu`: owner
- `-g ubuntu`: group
- `-m 750`: owner는 모든 권한, group은 읽기·진입, other는 접근 불가

파일 교체에는 다음 형태를 사용했다.

```bash
install -m 644 source.yml destination.yml
```

`cp`와 달리 destination mode를 명시할 수 있다.

## 5. Git과 hotfix

### GitHub clone 실패의 의미

```bash
git clone \
    https://github.com/Sleepingco/Tetris_multi \
    tetris-multi
```

- `git clone`: remote repository의 commit과 working tree를 새 directory로 받는다.
- 마지막 `tetris-multi`: local destination directory 이름이다.

private repository이거나 인증이 필요한 경우 GitHub account password를 입력해도
동작하지 않는다. GitHub HTTPS Git 작업은 PAT 또는 Git credential을 사용하고,
SSH URL은 GitHub에 등록한 SSH key를 사용한다.

배포 당시에는 remote clone 대신 Mac에서 검증된 source archive를 전송했다.
application 실행 자체에는 GitHub 인증이 필요하지 않다.

### hotfix branch

Mac repository에서 실행한다.

```bash
git switch -c codex/fix-postgres-command-args
```

| 부분 | 의미 |
|---|---|
| `git switch` | working tree가 가리키는 branch를 변경한다. |
| `-c` | 새 branch를 만들면서 그 branch로 이동한다. |
| `codex/...` | 이 작업에서 사용할 branch 이름이다. |

현재 branch와 변경 상태:

```bash
git branch --show-current
git status --short
```

- `--show-current`: 현재 branch 이름만 출력한다.
- `status --short`: 변경 파일을 간단한 두 글자 상태로 출력한다.

### 변경 검증

```bash
source ~/.nvm/nvm.sh
nvm exec 24.18.0 bash scripts/verify.sh
git diff --check
```

| 명령 | 의미 |
|---|---|
| `source ~/.nvm/nvm.sh` | 현재 shell에 NVM 함수와 환경변수를 불러온다. |
| `nvm exec 24.18.0` | 지정 Node.js version으로 뒤 명령을 실행한다. |
| `bash scripts/verify.sh` | project의 공백 검사, test와 build 검증을 실행한다. |
| `git diff --check` | trailing whitespace와 conflict marker 같은 diff 오류를 찾는다. |

`source`는 새 process가 아니라 현재 shell을 변경한다. 그래서 다음 `nvm`
명령에서 바로 사용할 수 있다.

### stage와 commit

```bash
git add \
    compose.production.yml \
    scripts/verify-postgres-production.sh

git commit -m "fix: preserve PostgreSQL startup command"
```

- `git add`: 선택한 working tree 변경을 staging area에 올린다.
- `git commit`: staged snapshot을 local Git history에 기록한다.
- `-m`: commit message를 argument로 지정한다.

commit은 GitHub에 자동 게시되지 않는다. 다음 명령으로 local commit을 확인한다.

```bash
git show --stat --oneline HEAD
git rev-parse HEAD
```

- `HEAD`: 현재 branch의 마지막 commit을 가리킨다.
- `show --stat`: commit 요약과 파일별 변경량을 출력한다.
- `rev-parse HEAD`: 완전한 commit SHA를 출력한다.

당시 생성된 local commit은 `c292cc6`이었다.

### GitHub CLI 인증

```bash
gh auth status
```

현재 GitHub CLI credential이 유효한지 확인한다. 만료된 경우 push나 PR 생성은
실패하지만 local branch, test, commit과 OCI 배포에는 영향을 주지 않는다.

```text
local commit --X--> GitHub push/PR
       |
       +-------> SCP로 검증된 hotfix 파일 전달
```

GitHub 인증을 고치지 않고 배포를 진행했던 이유는 application source 전체를
새로 가져온 것이 아니라 검증된 Compose hotfix 파일 하나만 OCI에 전달했기
때문이다.

### hotfix 파일만 전달

Mac:

```bash
scp \
    -i "<KEY_PATH>/tetris.key" \
    compose.production.yml \
    ubuntu@<OCI_PUBLIC_IP>:/tmp/compose.production.c292cc6.yml
```

OCI:

```bash
sha256sum /tmp/compose.production.c292cc6.yml

cd /srv/tetris/repository

cp compose.production.yml \
    compose.production.yml.before-c292cc6

install -m 644 \
    /tmp/compose.production.c292cc6.yml \
    compose.production.yml
```

- `cp ...before-c292cc6`: 교체 전 파일을 rollback 근거로 남긴다.
- `install -m 644`: 검증된 새 파일을 정해진 mode로 설치한다.

설치 후 Compose render를 다시 검사하고 PostgreSQL만 재생성했다.

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    config --quiet

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    up -d \
    --force-recreate \
    postgres
```

`--force-recreate`는 기존 container 설정 cache에 의존하지 않고 수정된
entrypoint/command로 새 container를 만든다. PostgreSQL named volume은 제거하지
않으므로 database storage는 유지된다.

## 6. Ubuntu와 systemd

### package index와 upgrade

```bash
sudo apt update
sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y
sudo apt install -y docker.io git docker-compose-v2
```

| 명령 | 의미 |
|---|---|
| `apt update` | 설치 가능한 package 목록을 갱신한다. |
| `apt upgrade` | 설치된 package를 새 version으로 올린다. |
| `DEBIAN_FRONTEND=noninteractive` | 대화형 질문 없이 기본 선택으로 진행한다. |
| `-y` | 확인 질문에 yes로 답한다. |
| `apt install` | 지정한 package를 설치한다. |

`apt update`는 package 자체를 upgrade하지 않는다. 목록만 갱신한다.

kernel이 upgrade되면 실행 중 kernel은 자동 교체되지 않는다.

```bash
test -f /var/run/reboot-required \
    && echo "REBOOT_REQUIRED" \
    || echo "NO_REBOOT_REQUIRED"
```

`REBOOT_REQUIRED`이면 재부팅한다.

```bash
sudo reboot
```

SSH 연결이 끊기는 것은 정상이다. VM이 다시 올라올 때까지 기다린 뒤 재접속한다.

### Docker service

```bash
sudo systemctl enable --now docker
```

- `systemctl`: systemd service를 제어한다.
- `enable`: 다음 boot부터 자동 시작하게 한다.
- `--now`: enable과 동시에 지금도 시작한다.

확인:

```bash
sudo systemctl is-enabled docker
sudo systemctl is-active docker
sudo docker version
sudo docker compose version
```

`docker version`은 client와 server가 모두 출력돼야 Docker daemon까지
정상이라는 뜻이다.

## 7. swap과 resource 확인

### 2 GiB swap 생성

최초 한 번만 실행한다.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

| 명령 | 의미 |
|---|---|
| `fallocate -l 2G` | disk에 2 GiB 파일 공간을 할당한다. |
| `chmod 600` | root만 swap 파일을 읽고 쓰게 한다. |
| `mkswap` | 일반 파일을 swap 형식으로 초기화한다. |
| `swapon` | 현재 kernel에서 swap 사용을 시작한다. |

boot 후에도 유지하려면 `/etc/fstab`에 한 번만 추가한다.

```bash
grep -q '^/swapfile ' /etc/fstab \
    || printf '/swapfile none swap sw 0 0\n' \
        | sudo tee -a /etc/fstab
```

- `grep -q`: 출력 없이 일치 여부만 종료 code로 알린다.
- 기존 설정이 없을 때만 `||` 오른쪽을 실행한다.
- `tee -a`: root 권한으로 파일 끝에 추가한다.

`sudo printf ... > /etc/fstab`은 redirect가 `sudo`보다 먼저 현재 shell에서
처리되므로 권한 오류가 날 수 있다. 그래서 `sudo tee`를 사용한다.

확인:

```bash
swapon --show
free -h
df -h /
```

| 명령 | 확인 대상 |
|---|---|
| `swapon --show` | 활성 swap 목록과 사용량 |
| `free -h` | RAM과 swap 사용량 |
| `df -h /` | root filesystem의 disk 사용량 |
| `-h` | 사람이 읽기 쉬운 MiB/GiB 단위 |

`free`가 작아도 `available`이 충분할 수 있다. Linux는 남는 RAM을 cache로
사용하므로 운영 판단에는 `available`을 함께 본다.

## 8. network와 방화벽

### DNS 확인

```bash
getent ahostsv4 tetra-arena.duckdns.org
```

system resolver를 통해 domain의 IPv4 주소를 확인한다. 출력 주소가 OCI public
IP와 같아야 Caddy certificate 발급 요청이 올바른 VM으로 도착한다.

### iptables 확인 후 추가

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
```

| 옵션 | 의미 |
|---|---|
| `-C INPUT` | INPUT chain에 같은 rule이 이미 있는지 확인한다. |
| `-p tcp` | TCP packet만 대상으로 한다. |
| `-m multiport` | 여러 port를 한 rule에서 사용한다. |
| `--dports 80,443` | HTTP와 HTTPS destination port다. |
| `-m conntrack --ctstate NEW` | 새 연결만 대상으로 한다. |
| `-j ACCEPT` | 일치하는 packet을 허용한다. |
| `-I INPUT 5` | INPUT chain의 5번째 위치에 rule을 삽입한다. |

`-C`가 실패할 때만 `-I`를 실행하므로 같은 rule의 중복 추가를 피한다.

현재 rule:

```bash
sudo iptables -L INPUT -n --line-numbers
```

- `-L INPUT`: INPUT chain을 나열한다.
- `-n`: DNS 역조회 없이 숫자로 빠르게 출력한다.
- `--line-numbers`: rule 순서를 표시한다.

REJECT rule보다 80/443 ACCEPT rule이 앞에 있어야 한다.

재부팅 후에도 유지:

```bash
sudo netfilter-persistent save
```

OCI Security List와 VM iptables는 서로 다른 경계다. 둘 다 port를 허용해야 외부에서
접속할 수 있다.

### HTTP와 HTTPS 확인

```bash
curl -I http://tetra-arena.duckdns.org
curl -I https://tetra-arena.duckdns.org
```

`-I`는 response body 없이 header만 요청한다.

기대 결과:

```text
HTTP  -> 308 Permanent Redirect
HTTPS -> 200
```

실제 body까지 실패 code로 검사하려면 다음을 사용한다.

```bash
curl -fsS \
    --retry 10 \
    --retry-delay 2 \
    --retry-all-errors \
    -o /dev/null \
    -w 'HTTPS_STATUS=%{http_code}\n' \
    https://tetra-arena.duckdns.org
```

| 옵션 | 의미 |
|---|---|
| `-f` | HTTP 400 이상이면 command를 실패시킨다. |
| `-sS` | progress는 숨기고 오류는 출력한다. |
| `--retry 10` | 최대 10회 재시도한다. |
| `--retry-delay 2` | 재시도 사이에 2초 기다린다. |
| `--retry-all-errors` | connection 오류도 재시도한다. |
| `-o /dev/null` | body는 버린다. |
| `-w` | 마지막에 HTTP status를 지정 형식으로 출력한다. |

## 9. Docker와 Compose

### Compose 파일 선택

```bash
sudo docker compose -f compose.jsonl.yml ps
```

- `docker compose`: 여러 service를 하나의 project로 관리한다.
- `-f`: 기본 `compose.yml` 대신 사용할 파일을 지정한다.
- `ps`: 이 Compose project의 container 상태를 출력한다.

production env와 Compose:

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    ps
```

`--env-file`은 Compose의 `${VARIABLE}` 치환에 사용할 값을 읽는다. container
내부 환경변수로 전달되는지는 Compose 파일의 `environment` 설정에 달려 있다.

### 최종 Compose render 확인

```bash
sudo env APP_IMAGE_TAG=2411cd3 \
    docker compose \
    -f compose.jsonl.yml \
    config --quiet
```

- `env APP_IMAGE_TAG=...`: `sudo`로 실행할 process에 변수를 명시적으로 전달한다.
- `config`: 여러 Compose 설정과 변수를 합쳐 최종 설정을 render한다.
- `--quiet`: 출력 대신 유효성 여부만 종료 code로 알린다.

YAML이 눈으로 올바르게 보여도 Compose 변환 결과가 달라질 수 있다. PostgreSQL
restart loop는 이 경계에서 `command`가 여러 argument로 분리돼 발생했다.

최종 JSON까지 확인:

```bash
docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    config --format json
```

### image build

```bash
sudo env APP_IMAGE_TAG=2411cd3 \
    docker compose \
    -f compose.jsonl.yml \
    build app
```

`build app`은 `Dockerfile`을 이용해 app service image만 build한다.

확인:

```bash
sudo docker image inspect tetris-app:2411cd3 \
    --format \
    'image={{.RepoTags}} architecture={{.Architecture}} size={{.Size}}'
```

`docker image inspect`는 image metadata를 읽는다. `--format`의 `{{...}}`는
Docker Go template이며 필요한 field만 출력한다.

### service 시작

```bash
sudo env APP_IMAGE_TAG=2411cd3 \
    docker compose \
    -f compose.jsonl.yml \
    up -d
```

- `up`: network, volume과 container를 원하는 상태로 만든다.
- `-d`: foreground log를 붙잡지 않고 background에서 실행한다.

상태와 log:

```bash
sudo docker compose -f compose.jsonl.yml ps
sudo docker compose -f compose.jsonl.yml logs --tail=100 app caddy
```

- `logs`: container stdout/stderr를 모아서 보여 준다.
- `--tail=100`: 마지막 100줄만 읽는다.

### container 상태 inspect

```bash
app_id=$(sudo docker compose \
    -f compose.jsonl.yml \
    ps -q app)

sudo docker inspect "$app_id" \
    --format \
    'status={{.State.Status}} health={{.State.Health.Status}} oom={{.State.OOMKilled}}'
```

- `ps -q app`: app container ID만 출력한다.
- `docker inspect`: 실제 container runtime 상태를 읽는다.
- `OOMKilled=true`: memory limit 또는 host memory pressure로 kernel이 종료했다는 뜻이다.

`running`만으로는 application이 요청을 처리할 준비가 됐는지 알 수 없다.
`health=healthy`와 HTTPS 응답을 함께 확인한다.

### restart와 stop

```bash
sudo docker compose -f compose.jsonl.yml restart app
sudo docker compose -f compose.jsonl.yml stop app
```

- `restart`: 같은 container를 정지 후 다시 시작한다.
- `stop`: container를 제거하지 않고 정상 종료 signal을 보낸다.

`stop`된 container는 `docker cp`로 파일을 꺼낼 수 있고 다시 시작할 수도 있다.

### pause와 unpause

```bash
sudo docker compose -f compose.jsonl.yml pause app
sudo docker compose -f compose.jsonl.yml unpause app
```

`pause`는 container process를 제거하지 않고 일시 정지한다. JSONL snapshot 복사
중 새로운 write가 들어오지 않게 사용했다.

긴 시간 pause하면 사용자 요청도 멈춘다. snapshot 복사가 끝나면 즉시
`unpause`한다.

### container에서 파일 복사

```bash
sudo docker cp \
    "${app_id}:/app/data/logs/game-events.jsonl" \
    /srv/tetris/import/source/game-events.jsonl
```

colon 왼쪽은 container ID, 오른쪽은 container 내부 경로다. 마지막 argument는
OCI host 경로다.

`docker cp`는 host와 container 사이에서 복사하며 volume을 삭제하거나 변경하지
않는다.

### one-off container

다음은 옵션 구조를 설명하기 위한 축약 예시다. importer argument가 생략됐으므로
그대로 실행하지 않고 15장의 완전한 dry-run/import 명령을 사용한다.

```bash
sudo docker run --rm \
    --user "$(id -u):$(id -g)" \
    --network tetris_database \
    --mount \
        type=bind,src=/srv/tetris/certs/ca.crt,dst=/run/secrets/postgres-ca.crt,readonly \
    --env-file /srv/tetris/secrets/import.env \
    --env NODE_EXTRA_CA_CERTS=/run/secrets/postgres-ca.crt \
    tetris-app:2411cd3 \
    node dist/server/server/db/importJsonl.js
```

| 옵션 | 의미 |
|---|---|
| `docker run` | Compose service와 별개인 일회성 container를 실행한다. |
| `--rm` | process 종료 후 container를 자동 제거한다. |
| `--user UID:GID` | container process를 host 사용자의 numeric ID로 실행한다. |
| `--network tetris_database` | PostgreSQL이 있는 internal network에 연결한다. |
| `--mount type=bind` | host 파일을 container의 지정 경로에 연결한다. |
| `readonly` | container에서 mount 원본을 수정하지 못하게 한다. |
| `--env-file` | 환경변수 파일을 container에 전달한다. |
| `--env` | 환경변수 하나를 명시적으로 추가한다. |
| `tetris-app:2411cd3` | 실행할 image다. |
| 마지막 `node ...` | image 기본 command 대신 실행할 process다. |

host `ubuntu`가 UID 1001이고 image의 `node`가 UID 1000이었기 때문에
`--user "$(id -u):$(id -g)"`가 없으면 mode `400` source와 mode `700` report
directory에 접근할 수 없었다.

### resource 확인

```bash
sudo docker stats --no-stream
```

현재 CPU, memory, network와 block I/O를 한 번 출력하고 종료한다.
`--no-stream`이 없으면 계속 갱신된다.

## 10. secret과 TLS

### secret directory

```bash
sudo install -d \
    -o ubuntu \
    -g ubuntu \
    -m 700 \
    /srv/tetris/secrets \
    /srv/tetris/certs \
    /srv/tetris/backups \
    /srv/tetris/import/source \
    /srv/tetris/import/reports
```

mode `700`은 owner만 읽기·쓰기·directory 진입을 허용한다.

### password 생성

```bash
openssl rand -hex 24 \
    > /srv/tetris/secrets/runtime-password
```

- `openssl rand`: cryptographically secure random bytes를 생성한다.
- `-hex 24`: 24 bytes를 48개의 hexadecimal 문자로 출력한다.
- `>`: password를 파일에 저장한다.

파일의 SHA-256은 password를 대신할 수 없다. 인증할 때 필요한 값은 파일 원문이다.
hash는 원문이 동일한지 확인하는 fingerprint일 뿐이다.

생성 확인은 원문을 출력하지 않고 metadata만 본다.

```bash
stat -c '%a %U:%G %s %n' \
    /srv/tetris/secrets/runtime-password
```

- `%a`: permission mode
- `%U:%G`: owner와 group
- `%s`: bytes
- `%n`: 경로

### private CA 생성

```bash
openssl req \
    -x509 \
    -newkey rsa:3072 \
    -sha256 \
    -nodes \
    -days 3650 \
    -subj '/CN=Tetris PostgreSQL Private CA' \
    -keyout /srv/tetris/certs/ca.key \
    -out /srv/tetris/certs/ca.crt
```

| 옵션 | 의미 |
|---|---|
| `req` | certificate request 관련 기능을 사용한다. |
| `-x509` | CSR 대신 self-signed CA certificate를 만든다. |
| `-newkey rsa:3072` | 새 RSA private key를 생성한다. |
| `-sha256` | signature hash algorithm으로 SHA-256을 사용한다. |
| `-nodes` | private key 자체에 passphrase를 걸지 않는다. |
| `-days 3650` | CA certificate 유효기간이다. |
| `-subj` | 대화형 질문 대신 subject를 지정한다. |
| `-keyout` | private key 출력 경로다. |
| `-out` | certificate 출력 경로다. |

`-nodes`를 사용했으므로 filesystem mode와 host 접근 통제가 중요하다.

### PostgreSQL server certificate

```bash
openssl req \
    -newkey rsa:2048 \
    -sha256 \
    -nodes \
    -subj '/CN=postgres' \
    -keyout /srv/tetris/certs/postgres.key \
    -out /srv/tetris/certs/postgres.csr
```

이 명령은 server private key와 CA가 서명할 CSR을 만든다.

SAN과 용도:

```bash
printf 'subjectAltName=DNS:postgres\nextendedKeyUsage=serverAuth\n' \
    > /srv/tetris/certs/postgres.ext
```

- `subjectAltName=DNS:postgres`: Docker DNS 이름 `postgres`와 certificate를 맞춘다.
- `extendedKeyUsage=serverAuth`: server certificate 용도임을 표시한다.

CA 서명:

```bash
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
```

`-CAcreateserial`은 certificate serial 관리 파일을 처음 생성한다.

권한:

```bash
chmod 600 \
    /srv/tetris/certs/ca.key \
    /srv/tetris/certs/postgres.key

chmod 644 \
    /srv/tetris/certs/ca.crt \
    /srv/tetris/certs/postgres.crt
```

| 파일 | 권한 | 이유 |
|---|---:|---|
| `ca.key` | `600` | 다른 certificate를 발급할 수 있는 비밀키 |
| `postgres.key` | `600` | PostgreSQL server 비밀키 |
| `ca.crt` | `644` | client가 읽어야 하는 공개 CA certificate |
| `postgres.crt` | `644` | server가 제공하는 공개 certificate |

검증:

```bash
openssl verify \
    -CAfile /srv/tetris/certs/ca.crt \
    /srv/tetris/certs/postgres.crt

openssl x509 \
    -in /srv/tetris/certs/postgres.crt \
    -noout \
    -checkhost postgres
```

첫 명령은 CA signature chain, 두 번째는 hostname `postgres`가 SAN/CN과 맞는지
검사한다.

### env 파일 생성

```bash
printf \
    'APP_IMAGE_TAG=%s\nDATABASE_URL=postgresql://tetris_runtime:%s@postgres:5432/tetris?sslmode=verify-full\n' \
    "2411cd3" \
    "$(cat /srv/tetris/secrets/runtime-password)" \
    > /srv/tetris/secrets/production.env

chmod 600 /srv/tetris/secrets/production.env
```

`printf` format의 첫 `%s`에는 image tag, 두 번째 `%s`에는 password가 들어간다.
명령은 URL을 terminal에 출력하지 않고 파일로 redirect한다.

`sslmode=verify-full`은 다음을 모두 검사한다.

1. TLS로 연결한다.
2. certificate가 지정 CA로 서명됐는지 확인한다.
3. 접속 hostname `postgres`와 certificate 이름을 비교한다.

key 이름만 확인하고 값은 출력하지 않는다.

```bash
cut -d= -f1 \
    /srv/tetris/secrets/production.env \
    /srv/tetris/secrets/migration.env \
    /srv/tetris/secrets/import.env
```

- `-d=`: `=`를 field 구분자로 사용한다.
- `-f1`: 첫 field인 환경변수 이름만 출력한다.

## 11. PostgreSQL 시작과 장애 진단

### PostgreSQL만 시작

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    up -d postgres
```

마지막 `postgres`는 전체 stack이 아니라 PostgreSQL service만 대상으로 한다.

상태와 log:

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    ps postgres

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    logs --tail=50 postgres
```

### restart loop inspect

```bash
sudo docker inspect tetris-postgres-1 \
    --format \
    'path={{json .Path}} args={{json .Args}} exit={{.State.ExitCode}} restarts={{.RestartCount}} error={{json .State.Error}}'
```

| field | 의미 |
|---|---|
| `.Path` | container가 실제 실행한 executable |
| `.Args` | executable에 전달된 argument 배열 |
| `.State.ExitCode` | 마지막 process 종료 code |
| `.RestartCount` | Docker가 재시작한 횟수 |
| `.State.Error` | container runtime 자체 오류 |

당시 `Path=/bin/sh`, `Args=["-c","set",...]`, `exit=0`이었다. PostgreSQL이
실패한 것이 아니라 shell builtin `set`만 실행하고 정상 종료한 것이다.

Compose가 만든 설정도 확인한다.

```bash
sudo docker inspect tetris-postgres-1 \
    --format \
    'entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}}'
```

수정 후 성공 기준:

```text
args=2
running=true
health=healthy
restarts=0
oom=false
```

### internal port 확인

```bash
sudo docker inspect tetris-postgres-1 \
    --format \
    'ports={{json .NetworkSettings.Ports}} networks={{json .NetworkSettings.Networks}}'
```

`"5432/tcp":null`은 container port가 host public port로 publish되지 않았다는
뜻이다. application은 `tetris_database` network 내부 DNS 이름 `postgres`로
접속한다.

## 12. PostgreSQL role과 database

### `psql` 공통 실행 형태

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    psql \
    --username postgres \
    --dbname tetris \
    --set=ON_ERROR_STOP=1
```

| 부분 | 의미 |
|---|---|
| `exec` | 실행 중인 service container 안에서 명령을 실행한다. |
| `-T` | pseudo-TTY를 만들지 않는다. redirect/heredoc 자동화에 필요하다. |
| `--username postgres` | database 관리자 role로 연결한다. |
| `--dbname tetris` | 대상 database를 지정한다. |
| `ON_ERROR_STOP=1` | SQL 하나가 실패하면 나머지를 계속 실행하지 않는다. |

### role 생성

```sql
CREATE ROLE tetris_runtime LOGIN PASSWORD '<runtime-password>'
    NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
```

| 절 | 의미 |
|---|---|
| `CREATE ROLE` | PostgreSQL role을 생성한다. |
| `LOGIN` | 이 role로 접속할 수 있게 한다. |
| `PASSWORD` | 접속 인증값을 지정한다. |
| `NOINHERIT` | 다른 role membership 권한을 자동 상속하지 않는다. |
| `NOSUPERUSER` | 관리자 우회 권한을 주지 않는다. |
| `NOCREATEDB` | database 생성 권한을 주지 않는다. |
| `NOCREATEROLE` | 다른 role 생성 권한을 주지 않는다. |
| `NOREPLICATION` | replication 권한을 주지 않는다. |

`CREATE ROLE`은 같은 이름이 이미 있으면 실패한다. 최초 provisioning에서만
실행한다.

### database 생성

```sql
CREATE DATABASE tetris OWNER tetris_migration;
REVOKE ALL ON DATABASE tetris FROM PUBLIC;
GRANT CONNECT ON DATABASE tetris
    TO tetris_runtime, tetris_import, tetris_maintenance;
```

- schema 변경을 담당하는 `tetris_migration`을 owner로 지정한다.
- 모든 role을 뜻하는 `PUBLIC`의 기본 권한을 제거한다.
- 필요한 application role에 접속 권한만 다시 준다.

### search path

```sql
ALTER ROLE tetris_runtime IN DATABASE tetris
    SET search_path TO tetris_analytics, pg_catalog;
```

이 role이 `tetris` database에 접속했을 때 schema 이름을 생략하면
`tetris_analytics`를 먼저 찾게 한다.

### 최소 권한

```sql
GRANT USAGE ON SCHEMA tetris_analytics
    TO tetris_runtime, tetris_import, tetris_maintenance;
```

`USAGE`는 schema 안의 object 이름을 참조할 수 있게 한다. table 자체 권한은
별도로 필요하다.

```sql
GRANT INSERT (event_id, event_type, ...)
    ON tetris_analytics.game_events
    TO tetris_runtime, tetris_import;
```

table 전체가 아니라 importer와 runtime이 기록하는 column만 허용한다.

```sql
GRANT SELECT (event_id, event_type, ...)
    ON tetris_analytics.game_events
    TO tetris_runtime, tetris_import;
```

중복 판정과 제한된 조회에 필요한 column만 허용한다.

```sql
GRANT SELECT, DELETE
    ON tetris_analytics.game_events
    TO tetris_maintenance;
```

retention 작업용 role은 읽기와 삭제만 허용한다. `TRUNCATE`는 table 전체를
빠르게 비우므로 주지 않았다.

### 권한 검사

```sql
SELECT
    has_schema_privilege(
        'tetris_runtime',
        'tetris_analytics',
        'USAGE'
    ),
    has_table_privilege(
        'tetris_runtime',
        'tetris_analytics.game_events',
        'DELETE'
    );
```

`has_*_privilege` 함수는 실제 PostgreSQL ACL을 boolean으로 반환한다.
기대값은 필요한 권한 `t`, 금지한 권한 `f`다.

## 13. migration

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

명령 흐름:

```text
host CA certificate
    -> container /run/secrets/postgres-ca.crt
    -> Node NODE_EXTRA_CA_CERTS
    -> verify-full TLS
    -> tetris_migration role
    -> pending migration만 적용
```

첫 실행:

```text
applied=2 skipped=0
```

재실행:

```text
applied=0 skipped=2
```

두 번째 결과는 migration이 version/checksum을 기록하고 이미 적용된 항목을
중복 실행하지 않는다는 뜻이다.

`Permission denied`가 발생하면 certificate mode를 확인한다.

```bash
stat -c '%a %U:%G %n' /srv/tetris/certs/ca.crt
```

CA certificate는 container의 non-root Node process가 읽을 수 있도록 `644`여야
한다.

## 14. JSONL snapshot

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
)
```

핵심 이유:

1. `test ! -e`: 기존 snapshot을 덮어쓰지 않는다.
2. `pause`: 복사 중 JSONL append를 멈춘다.
3. `trap`: 중간 실패에도 app을 다시 움직인다.
4. `docker cp`: container volume의 파일을 host로 복사한다.
5. `chown`: host `ubuntu`가 파일 metadata를 관리하게 한다.
6. `chmod 400`: 이후 원본을 실수로 수정하지 못하게 한다.
7. `wc -l`, `sha256sum`: line 수와 bytes 무결성 기준을 남긴다.

`chmod 400`은 immutable filesystem 기능이 아니라 일반 permission이다. owner가
다시 `chmod`하면 바꿀 수 있으므로 운영 절차상 immutable snapshot이라는 뜻이다.

## 15. JSONL dry-run과 import

### dry-run

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
    /run/game-events.jsonl
```

| argument | 의미 |
|---|---|
| `--dry-run` | parsing과 검증만 하고 DB write는 하지 않는다. |
| `--report` | machine-readable 결과 파일을 기록한다. |
| 마지막 JSONL 경로 | import source다. |

dry-run에서 확인할 값:

- `ok=true`
- source line 수와 SHA-256
- `failures.count=0`
- `duplicateIdentityCount=0`
- `conflictIdentityCount=0`
- complete/ambiguous/incomplete game 수
- `writes.attempted=0`

### 실제 import

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
    /run/game-events.jsonl
```

dry-run과 다른 점:

- `--network`: PostgreSQL에 연결한다.
- CA mount와 `NODE_EXTRA_CA_CERTS`: TLS server를 검증한다.
- `import.env`: 제한된 `tetris_import` credential을 사용한다.
- `--dry-run`이 없으므로 DB transaction을 실행한다.

첫 실행 성공:

```text
attempted=131 inserted=131 duplicate=0 conflict=0 failed=0
```

같은 source 재실행:

```text
attempted=131 inserted=0 duplicate=131 conflict=0 failed=0
```

두 번째 실행은 importer의 identity constraint와 중복 처리가 실제로 멱등함을
검증한다. `conflict`나 `failed`가 하나라도 있으면 cutover하지 않는다.

## 16. backup과 restore

### custom-format backup

```bash
backup=/srv/tetris/backups/pre-import-2411cd3.dump

sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    pg_dump \
    --username postgres \
    --dbname tetris \
    --format=custom \
    > "$backup"
```

`pg_dump`는 logical backup을 만든다.

- `--format=custom`: `pg_restore`로 선택적·검증 가능한 복원이 가능한 형식이다.
- dump는 container stdout으로 나오고 host redirect가 파일에 저장한다.
- production database를 정지하지 않고 일관된 snapshot을 읽는다.

목록 확인:

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    pg_restore --list \
    < "$backup"
```

`--list`는 실제 복원 없이 dump 내부 object 목록을 출력한다.

### 임시 database

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    createdb \
    --username postgres \
    --owner tetris_migration \
    tetris_restore_check
```

- `createdb`: `CREATE DATABASE`의 command-line wrapper다.
- `--owner`: restored table의 설계 owner와 맞는 database owner를 지정한다.

복원:

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    exec -T postgres \
    pg_restore \
    --username postgres \
    --dbname tetris_restore_check \
    --exit-on-error \
    < "$backup"
```

`--exit-on-error`가 없으면 일부 object 실패 후에도 계속 진행할 수 있다. rehearsal은
부분 성공을 성공으로 오해하면 안 되므로 첫 오류에서 실패시킨다.

복원 검증 후 임시 DB를 제거한다.

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

- `dropdb`: `DROP DATABASE` wrapper다.
- `--force`: 남아 있는 test connection을 종료하고 임시 DB를 삭제한다.

`dropdb`는 destructive 명령이다. production database 이름 `tetris`가 아닌
`tetris_restore_check`인지 실행 직전에 확인한다.

## 17. runtime preflight

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
    node -e '<preflight-script>'
```

`<preflight-script>`는 설명을 위한 자리표시자다. 실제 실행한 JavaScript는
[실행 기록의 runtime credential preflight](oci-production-deployment-session-2026-07-24.md#17-runtime-credential-preflight)에
있다.

`node -e`는 argument 문자열을 JavaScript로 바로 실행한다. 이 preflight는 실제
game event를 쓰지 않고 다음을 확인했다.

- runtime credential로 DB 접속 가능
- CA/hostname TLS 검증 성공
- migration version 호환
- storage mode가 `postgres`
- pool 초기화 실패 없음

성공 기준:

```text
mode=postgres
failed=0
poolMax=4
```

## 18. single-sink cutover

이 단계는 무중단 배포가 아니라 짧은 maintenance window다.

```text
JSONL app stop
    -> final JSONL copy
    -> final idempotent import
    -> PostgreSQL app start
```

### JSONL 생산자 정지

```bash
sudo docker compose -f compose.jsonl.yml stop app
```

`pause`가 아니라 `stop`을 사용해 새로운 event가 더 이상 기록되지 않는 최종
경계를 만든다.

stopped container ID:

```bash
app_id=$(sudo docker compose \
    -f compose.jsonl.yml \
    ps -a -q app)
```

- `-a`: stopped container도 포함한다.
- `-q`: ID만 출력한다.

최종 파일을 `docker cp`한 뒤 첫 snapshot과 같은 importer로 실행한다. importer가
멱등하므로 이미 저장한 131건은 duplicate가 되고 추가 event만 inserted된다.

### production app 시작

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

| 옵션 | 의미 |
|---|---|
| `--no-deps` | PostgreSQL과 Caddy를 재생성하지 않는다. |
| `--no-build` | 서버에서 image를 다시 build하지 않는다. |
| `--force-recreate` | 설정이 비슷해 보여도 app container를 새로 만든다. |
| `--wait` | service가 running/healthy가 될 때까지 기다린다. |
| `app` | app service만 대상으로 한다. |

Caddy와 PostgreSQL을 유지해 영향 범위를 app 하나로 제한했다.

storage mode 확인:

```bash
sudo docker inspect "$app_id" \
    --format='{{range .Config.Env}}{{println .}}{{end}}' \
    | grep '^GAME_EVENT_STORAGE='
```

Go template로 container 환경변수를 한 줄씩 출력하고
`GAME_EVENT_STORAGE=postgres`만 선택한다.

### rollback

production app이 healthy가 되기 전에 실패했을 때:

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

보존된 JSONL volume과 승인 image로 app만 복구한다. PostgreSQL volume과 이미
import한 row는 삭제하지 않는다.

## 19. DB 검증과 운영 확인

### row count

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
        SELECT event_type, count(*)
        FROM tetris_analytics.game_events
        GROUP BY event_type
        ORDER BY event_type;
    "
```

| 옵션 | 의미 |
|---|---|
| `--tuples-only` | column header와 row count 문구를 숨긴다. |
| `--no-align` | 사람이 보는 표 대신 parse하기 쉬운 raw field를 출력한다. |
| `--field-separator='|'` | field 사이에 `|`를 넣는다. |
| `--command` | SQL을 argument로 실행하고 종료한다. |

### app 재시작 전후 비교

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
printf 'DB_ROWS_BEFORE=%s\nDB_ROWS_AFTER=%s\n' \
    "$before" \
    "$after"
```

- `sleep 10`: health check와 DB pool 초기화 시간을 준다.
- `-ge`: 숫자 기준으로 after가 before 이상인지 검사한다.

게임 입력이 없는 재시작 검증에서는 두 값이 같아야 한다. 운영 중 event가 들어올
수 있는 환경에서는 row가 늘어날 수 있으므로 `-ge`를 사용한다.

### storage error log

```bash
sudo docker compose \
    --env-file /srv/tetris/secrets/production.env \
    -f compose.production.yml \
    logs --since=10m app \
    | grep -E 'write_failed|POSTGRES_EVENT|error' \
    || echo "NO_STORAGE_ERRORS"
```

- `--since=10m`: 최근 10분 log만 읽는다.
- `grep -E`: `|`를 OR로 사용하는 extended regular expression이다.

`NO_STORAGE_ERRORS`만 믿지 말고 app이 healthy이고 HTTPS가 `200`이며 DB row가
기대대로 증가하는지도 함께 확인한다.

## 20. 오류 메시지 해석

| 메시지 | 실제 원인 | 확인할 명령 |
|---|---|---|
| `scp: stat local ... No such file` | `scp`를 OCI에서 실행했거나 Mac source가 없음 | `pwd`, `hostname`, `ls -lh <source>` |
| GitHub password 인증 실패 | GitHub가 account password 기반 Git HTTPS 인증을 지원하지 않음 | repository 공개 여부, PAT/SSH/배포 artifact |
| `Restarting (0)`과 `PS2='> '` | `sh -c`에 script가 한 argument로 전달되지 않음 | `docker inspect ... .Path .Args` |
| `MIGRATION_CONNECTION_FAILED`와 CA permission 경고 | `ca.crt`가 mode `600`이라 UID 1000 Node가 읽지 못함 | `stat`, container `id` |
| importer `EACCES` | host UID 1001과 container UID 1000 불일치 | host/container `id`, `stat -c '%u:%g'` |
| `ufw: command not found` | UFW가 설치되지 않음 | 기존 iptables와 OCI Security List 확인 |
| SSH `Connection reset` 직후 | reboot 중 sshd가 아직 준비되지 않음 | 잠시 뒤 재접속 |

오류 문구만 보고 password나 database를 다시 만들지 않는다. 실제 executable,
argument, numeric UID, file mode와 network를 좁혀 가며 확인한다.

## 21. 재실행 안전성

| 작업 | 재실행 | 이유/조건 |
|---|---|---|
| `apt update` | 안전 | package index만 갱신한다. |
| `systemctl enable --now docker` | 안전 | 원하는 service 상태를 다시 보장한다. |
| iptables `-C ... || -I ...` | 안전 | 같은 rule 존재 여부를 먼저 검사한다. |
| `docker compose up -d` | 조건부 안전 | 현재 Compose와 env가 정확한지 먼저 확인한다. |
| migration CLI | 안전하게 설계됨 | 두 번째 실행이 `applied=0 skipped=N`인지 확인한다. |
| 같은 JSONL import | 안전하게 설계됨 | duplicate만 발생하고 conflict/failure가 없어야 한다. |
| `CREATE ROLE`, `CREATE DATABASE` | 최초 한 번 | 같은 이름이 있으면 실패한다. |
| CA/private key 생성 | 재실행 금지 | 기존 trust chain과 key를 교체한다. |
| `/swapfile` 생성·`mkswap` | 최초 한 번 | 활성 swap 파일을 다시 초기화하면 안 된다. |
| archive를 기존 directory에 `tar -xzf` | 주의 | 기존 파일을 덮어쓸 수 있다. |
| `pg_dump` | 안전 | destination 파일 덮어쓰기만 주의한다. |
| `dropdb` | 매우 주의 | 임시 DB 이름을 확인해야 한다. |
| `docker compose down -v` | 실행 금지 | named volume까지 삭제할 수 있다. |

## 22. 공부할 때의 권장 순서

1. `pwd`, `hostname`, `id`, `stat`으로 실행 경계를 확인한다.
2. shell의 redirect, pipe, 종료 code를 작은 임시 파일로 연습한다.
3. `docker compose config`와 `docker inspect` 결과를 비교한다.
4. bind mount에서 host/container numeric UID 차이를 재현한다.
5. `openssl verify`와 `-checkhost`가 각각 무엇을 검사하는지 비교한다.
6. 임시 PostgreSQL DB에서 role과 ACL을 만들어 `has_*_privilege`로 확인한다.
7. 작은 JSONL fixture로 dry-run → import → 같은 import 재실행을 비교한다.
8. backup을 임시 DB에 복원하고 production DB를 건드리지 않은 채 검증한다.

운영 server에서는 연습용 destructive 명령을 실행하지 않는다. UID, shell,
Compose render와 SQL privilege 실험은 local Docker 환경에서 먼저 재현한다.
