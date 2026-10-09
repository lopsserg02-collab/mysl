#!/usr/bin/env bash
# Installs or updates all of Mysl on an Ubuntu machine (database, site, live boards, HTTPS). Run as root:
#   curl -fsSL https://raw.githubusercontent.com/lopsserg02-collab/mysl/main/deploy/server/install.sh | bash
# The first run asks for the site's domain and the mail settings, makes up the passwords itself, and keeps
# everything in /opt/mysl/deploy/server/.env. Later runs only update the code and restart.
set -euo pipefail
DIR=/opt/mysl
REPO=https://github.com/lopsserg02-collab/mysl.git
BRANCH=${MYSL_BRANCH:-main}

[ "$(id -u)" = 0 ] || { echo "Запустите от root (или через sudo)."; exit 1; }

if ! command -v git >/dev/null || ! command -v curl >/dev/null || ! command -v openssl >/dev/null; then
  apt-get update -qq && apt-get install -y -qq git curl openssl
fi
if ! command -v docker >/dev/null; then
  echo "Ставлю Docker…"
  curl -fsSL https://get.docker.com | sh
fi

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q --depth 1 origin "$BRANCH" && git -C "$DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR/deploy/server"

if [ ! -f .env ]; then
  # The old setup (live boards only) holds ports 80 and 443: this one replaces it.
  if [ -f ../realtime/compose.yaml ] && [ -f ../realtime/.env ]; then
    echo "Останавливаю прежний сервер досок: его заменит полная установка."
    (cd ../realtime && docker compose down) || true
  fi
  for p in 80 443; do
    if ss -ltnH "sport = :$p" | grep -q .; then
      echo "Порт $p уже занят другой программой. Напишите об этом в чат — подберу другой вариант."; exit 1
    fi
  done
  # The machine's own public address. Asking a website is wrong when outgoing traffic leaves through a VPN,
  # so read it from the network interfaces; MYSL_IP overrides it.
  ip=${MYSL_IP:-$(ip -4 -o addr show scope global | awk '{split($4,a,"/"); print a[1]}' \
    | grep -Ev '^(10\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)' | head -1)}
  [ -n "$ip" ] || { echo "Не нашёл внешний адрес сервера. Напишите об этом в чат."; exit 1; }
  echo
  read -rp "Домен сайта (например, mysl.ru): " host </dev/tty
  host=${host#http*://}; host=${host%%/*}
  [ -n "$host" ] || { echo "Нужен домен. Запустите команду ещё раз."; exit 1; }
  resolved=$(getent ahostsv4 "$host" | awk 'NR==1{print $1}')
  if [ "$resolved" != "$ip" ]; then
    echo "Домен $host пока указывает на «${resolved:-никуда}», а адрес этого сервера $ip."
    echo "В панели регистратора добавьте запись A: $host → $ip, подождите 10–30 минут и запустите команду снова."
    exit 1
  fi
  echo
  echo "Почта для писем со ссылкой входа. Если её ещё нет, просто нажмите Enter: добавим позже."
  read -rsp "SMTP_URL (набранное не отображается): " smtp </dev/tty; echo
  from=""
  [ -n "$smtp" ] && read -rp "Отправитель, например: Мысль <hello@$host>: " from </dev/tty
  umask 077
  {
    echo "MYSL_HOST=$host"
    echo "NEXT_PUBLIC_SITE_URL=https://$host"
    echo "DB_PASSWORD=$(openssl rand -hex 24)"
    echo "REALTIME_SECRET=$(openssl rand -hex 32)"
    echo "CRON_SECRET=$(openssl rand -hex 32)"
    echo "SMTP_URL=$smtp"
    echo "EMAIL_FROM=$from"
  } > .env
fi

# LC_ALL=C: ufw prints its status in the system language.
if command -v ufw >/dev/null && LC_ALL=C ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

# A VPN on the host (wg-quick style policy rules) can steal replies from Docker containers, so certificates
# never arrive. Send Docker traffic (172.16.0.0/12) via the main routing table, now and after every reboot.
# Same unit as deploy/realtime installs.
cat > /etc/systemd/system/mysl-route.service <<'UNIT'
[Unit]
Description=Mysl: Docker traffic bypasses VPN
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'ip rule show | grep -q "from 172.16.0.0/12 lookup main" || ip rule add from 172.16.0.0/12 lookup main priority 8999'
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now mysl-route >/dev/null 2>&1 || true
mkdir -p /opt/mysl-backups && chmod 700 /opt/mysl-backups

echo "Собираю и запускаю. Первый раз это занимает 5–10 минут…"
BUILD_VERSION=$(git -C "$DIR" rev-parse --short=12 HEAD) docker compose up -d --build
host=$(grep '^MYSL_HOST=' .env | cut -d= -f2)
echo
echo "Готово. Сайт: https://$host"
grep -q '^SMTP_URL=.' .env || echo "Почта не настроена: вход по ссылке заработает, когда добавим SMTP_URL."
