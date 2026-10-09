# Мысль (Mysl)

Онлайн-доска для совместной работы: стикеры на бесконечном холсте, правка в реальном времени, работа без сети.

## Запуск

```bash
npm install
cp .env.example .env.local   # для разработки значения можно не заполнять
npm run dev                  # веб на :3000 и сервер совместной работы на :1234
```

Откройте http://localhost:3000, войдите с любой почтой (тестовый вход), создайте доску.
Откройте ту же доску во второй вкладке, чтобы увидеть совместную работу.

## База данных

По умолчанию данные лежат в `.data/` (JSON и файлы досок). Для Postgres:

```bash
# обычный Postgres: пустая база + роли, auth.users и auth.uid() из db/dev/supabase-stub.sql
DATABASE_URL=postgres://... npm run db:migrate:dev
# Supabase: заглушка не нужна
DATABASE_URL=postgres://... npm run db:migrate
DATA_LAYER=postgres DATABASE_URL=postgres://... npm run dev
```

Права доступа проверяет сама база (row level security): каждый запрос пользователя идёт от роли `authenticated` с его id.

## Вход

Локально работает тестовый вход: имя и почта, без пароля. В продакшене он выключен (включается только `DEV_SIGN_IN=1`, для стенда).

Все остальные входят по одноразовой ссылке на почту: Мысль сама создаёт ссылку (таблица `login_links`, хранится только хеш секрета), отправляет её через SMTP (`SMTP_URL`) или Resend и ставит подписанную cookie сессии. Ссылка работает 30 минут и один раз; на один адрес не больше 5 писем в час. Без настроенной почты в разработке ссылка показывается прямо на странице. В продакшене нужен `NEXT_PUBLIC_SITE_URL`: из него собирается адрес в письме.

## Проверки

```bash
npm run typecheck
npm run test:unit             # TEST_DATABASE_URL=postgres://... чтобы прогнать слой данных и на Postgres
npm run test:e2e             # Playwright; PW_CHROMIUM=/path/to/chrome чтобы взять свой браузер
npm run build
```

## Устройство

- `app/` страницы Next.js: вход, список досок, доска
- `components/board/` холст на Konva, панели, курсоры
- `lib/board/` модель доски на Yjs (одна CRDT-документ на доску)
- `lib/data/` слой данных: локальный JSON для разработки и Postgres с row level security
- `db/migrations/` схема, права доступа, приглашения, комментарии
- `server/realtime.ts` сервер Hocuspocus: доступ по токену, только чтение для зрителей
- `design/` дизайн-токены; цвета только из них

Планы и исследование лежат в папке проекта `replica/` (recon, architecture, schema.sql).
