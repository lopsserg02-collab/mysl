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
# локально: пустая база + заглушка того, что есть в Supabase (роли, auth.users, auth.uid())
DATABASE_URL=postgres://... npm run db:migrate:dev
# Supabase: заглушка не нужна
DATABASE_URL=postgres://... npm run db:migrate
DATA_LAYER=postgres DATABASE_URL=postgres://... npm run dev
```

Права доступа проверяет сама база (row level security): каждый запрос пользователя идёт от роли `authenticated` с его id.

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
- `lib/data/` слой данных: локальный JSON для разработки, Supabase на следующем этапе
- `server/realtime.ts` сервер Hocuspocus: доступ по токену, только чтение для зрителей
- `design/` дизайн-токены; цвета только из них

Планы и исследование лежат в папке проекта `replica/` (recon, architecture, schema.sql).
