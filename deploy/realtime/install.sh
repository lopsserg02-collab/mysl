#!/usr/bin/env bash
# Installs or updates the Mysl realtime server on an Ubuntu machine. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/lopsserg02-collab/mysl/main/deploy/realtime/install.sh | bash
# The first run asks for the database address and the realtime secret (typed, never shown) and keeps them
# in /opt/mysl/deploy/realtime/.env. Later runs only update the code and restart.
set -euo pipefail
DIR=/opt/mysl
REPO=https://github.com/lopsserg02-collab/mysl.git

[ "$(id -u)" = 0 ] || { echo "Запустите от root (или через sudo)."; exit 1; }

if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
  apt-get update -qq && apt-get install -y -qq git curl
fi
if ! command -v docker >/dev/null; then
  echo "Ставлю Docker…"
  curl -fsSL https://get.docker.com | sh
fi

if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q --ff-only; else git clone -q --depth 1 "$REPO" "$DIR"; fi
cd "$DIR/deploy/realtime"

if [ ! -f .env ]; then
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
  host="${ip//./-}.sslip.io"
  echo
  echo "Скопируйте значения из Render (mysl-realtime → Environment). Набранное не отображается — это нормально."
  read -rsp "DATABASE_URL: " db </dev/tty; echo
  read -rsp "REALTIME_SECRET: " secret </dev/tty; echo
  [ -n "$db" ] && [ -n "$secret" ] || { echo "Оба значения нужны. Запустите команду ещё раз."; exit 1; }
  umask 077
  printf 'MYSL_HOST=%s\nDATABASE_URL=%s\nREALTIME_SECRET=%s\n' "$host" "$db" "$secret" > .env
fi

# LC_ALL=C: ufw prints its status in the system language.
if command -v ufw >/dev/null && LC_ALL=C ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

docker compose up -d --build
host=$(grep '^MYSL_HOST=' .env | cut -d= -f2)
echo
echo "Готово. Адрес сервера досок: wss://$host"
echo "Скопируйте эту строку в чат."
