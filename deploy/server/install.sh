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
  ip=$(curl -4 -fsS https://api.ipify.org)
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

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi
mkdir -p /opt/mysl-backups && chmod 700 /opt/mysl-backups

echo "Собираю и запускаю. Первый раз это занимает 5–10 минут…"
BUILD_VERSION=$(git -C "$DIR" rev-parse --short=12 HEAD) docker compose up -d --build
host=$(grep '^MYSL_HOST=' .env | cut -d= -f2)
echo
echo "Готово. Сайт: https://$host"
grep -q '^SMTP_URL=.' .env || echo "Почта не настроена: вход по ссылке заработает, когда добавим SMTP_URL."
