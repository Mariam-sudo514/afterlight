# AFTERLIGHT: облачный Supabase и Vercel

## Подготовленное окружение и фактическое состояние

Целевой проект: `npadcumzuahkqulhpimi`, URL `https://npadcumzuahkqulhpimi.supabase.co`. Регион Франкфурт указан владельцем; через Management API регион пока не проверен, поскольку Supabase CLI ещё не авторизован.

Проверка 18 сентября 2026:

- Предоставленный Publishable key принят Auth по указанному URL (HTTP 200).
- Email provider включён, Anonymous Sign-Ins отключены.
- Публичная регистрация отключена; Email provider включён, Anonymous Sign-Ins отключены.
- `posts`/`post_summaries` ещё не доступны через Data API; первоначальный запрос к `posts` вернул `404 / PGRST205`. Полный аудит облачной схемы требует Management API.
- Серверный Secret key принят read-only проверкой; приватный bucket `covers` ещё не создан.
- После авторизации CLI и `cloud:link` команда `pnpm cloud:plan` успешно выполнила preflight и dry-run миграций. Облачные миграции, создание аккаунта и перенос содержимого пока не выполнялись.
- Адрес Vercel/домен ещё не задан; `SITE_ORIGIN` намеренно оставлен пустым.

## 1. Раздельные настройки

| Окружение | Конфигурация | Команды |
| --- | --- | --- |
| Локальное | `.env.local`, `supabase/config.toml`, Docker `afterlight-local` | `pnpm local:start`, `pnpm dev` |
| Тестовое | `work/test-services`, Docker `afterlight-test` | `pnpm test:sql`, `pnpm test:integration` |
| Облачное | `.env.cloud.local`, `work/cloud-deployment` | `pnpm cloud:*` |

`.env.cloud.local` уже создан с предоставленными URL, Publishable key и введённым Secret key, с правами `0600`. Адрес сайта пока пустой. Файл исключён из Git и загрузки через Vercel CLI. Next.js не читает его автоматически. `.env.local` и существующие Docker volumes не менялись.

В новой копии проекта создайте `.env.cloud.local` по `.env.cloud.example` и вставьте Publishable key в редакторе. Здесь делать копирование повторно не нужно.

Сопоставление данных из Supabase Connect:

| Предоставленное имя | Имя, которое использует AFTERLIGHT |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_PUBLISHABLE_KEY` |

Publishable key работает с RLS; он не даёт права выполнять миграции или создавать владельца. Серверный SDK поддерживает новые `sb_publishable_` и `sb_secret_` ключи. Локальные legacy `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` продолжают поддерживаться. Не задавайте разные ключи одновременно под совместимыми именами.

## 2. Настройки Auth в Supabase

Откройте [Authentication → Sign In / Providers](https://supabase.com/dashboard/project/npadcumzuahkqulhpimi/auth/providers):

1. Выключите **Allow new users to sign up**.
2. Оставьте **Email provider** включённым.
3. Оставьте **Anonymous Sign-Ins** выключенным.

В URL Configuration задайте **Site URL** равным выбранному HTTPS-адресу сайта. Для текущего входа по email/password OAuth callback не нужен; дополнительные redirect URL разрешайте только для конкретных используемых адресов. Локальный `supabase/config.toml` не изменяет настройки облачного Auth автоматически.

Скопируйте **Secret key** из Settings → API Keys → Secret keys только в скрытый запрос следующей команды:

```bash
cd /Users/maria/Desktop/afterlight
pnpm cloud:setup
pnpm cloud:check
```

`cloud:setup` скрывает ввод ключа, сохраняет только облачный файл и не печатает значения. Команда также спрашивает будущий адрес сайта. Если адрес ещё не выбран, оставьте его пустым и повторите setup позже. Пароль БД и пароль владельца в этом файле не хранятся.

`cloud:check` выполняет только чтение: проверяет пару URL/key, Auth, публичный список и (если ключ уже задан) серверный доступ и приватность bucket. До завершения настройки код выхода `1` ожидаем.

## 3. Авторизация CLI и миграции

В обычном терминале:

```bash
cd /Users/maria/Desktop/afterlight
pnpm exec supabase login
pnpm cloud:prepare
pnpm cloud:link
pnpm cloud:plan
```

`supabase login` выполняется штатным способом CLI; не вставляйте access token в чат или аргумент команды. `cloud:link` проверяет наличие именно утверждённого project ref в аккаунте CLI, затем передаёт управление штатному интерактивному запросу Supabase CLI: пароль PostgreSQL вводится без отображения. Если CLI уже умеет подключаться, пароль можно пропустить Enter. Файл проекта с паролем не создаётся. Привязка создаётся только в `work/cloud-deployment`, а не в локальном `supabase/.temp`.

`cloud:plan`:

- снова проверяет ожидаемый project ref и существующую привязку;
- выполняет read-only SQL из `supabase/snippets/cloud-preflight.sql` через Management API связанного проекта (`db query --linked --project-ref …` для Supabase CLI 2.117+);
- проверяет историю миграций, наличие/совместимость таблиц, RLS, политик, private bucket и Auth sessions;
- отказывается продолжать при неизвестной истории или конфликтующих объектах;
- сохраняет только метаданные схемы в `work/cloud-deployment/preflight.json`;
- выполняет `db push --dry-run --skip-vault` без seed.

После успешного плана примените миграции:

```bash
pnpm cloud:migrate
```

Команда повторяет проверку и dry-run, затем применяет только ожидающие миграции. Она не вызывает `db reset`, `migration repair`, seed, импорт или конфигурацию Vault.

Миграции:

1. `20260916000100_afterlight.sql`: `app_owner`, `posts`, `media`, `auth_rate_limits`, компактное представление `post_summaries`, атомарное сохранение и private bucket `covers`.
2. `20260917000100_cloud_privileges.sql`: явный `USAGE` на схему для рабочих ролей и закрытие служебных SQL-функций от публичных RPC. Данные не меняет.

У таблиц включён RLS и заданы явные GRANT. Гость читает только опубликованные статьи. Клиенты не имеют прямых INSERT/UPDATE/DELETE; `save_post` проверяет подтверждённую живую сессию назначенного владельца. Таблица назначения владельца и лимиты входа доступны серверной роли. Storage закрыт для прямых клиентских запросов; обложки выдаются через защищённый `/media/[key]` без долговечных signed URL.

Если существующая облачная схема отличается, команда остановится. Не обходите это `db reset` или переписыванием истории: сначала изучите отчёт и согласуйте отдельную миграцию.

## 4. Облачный владелец

После отключения регистрации, ввода Secret key и миграций:

```bash
pnpm cloud:owner
```

Введите email, имя и пароль дважды. Пароль скрыт, не передаётся аргументом, не записывается в проект. Создаётся новый подтверждённый аккаунт именно в облачном проекте, затем его UUID явно записывается в `app_owner`. Существующий владелец не заменяется. Команда проверяет настройки Auth и действительность серверного ключа до создания аккаунта.

Восстановление пароля назначенного владельца:

```bash
pnpm cloud:owner --reset-password
```

Локальный аккаунт владельца не переносится. Его пароль, сессии и технические тестовые аккаунты никогда не входят в перенос содержимого.

## 5. Отдельный перенос статей и обложек

Сначала сохраните текущие изменения в редакторе. При работающем основном локальном Supabase:

```bash
pnpm content:export work/content-export
```

Экспорт требует соответствие основному `afterlight-local` на порту 55431. Тестовый проект на 56431 и другие URL запрещены. Создаётся новая приватная папка (`0700`, файлы `0600`); существующая папка не перезаписывается. Для повторной копии задайте новое имя, например `work/content-export-2`.

Формат v1 включает ID, slug, RU/EN, статус, даты, версии, метаданные и байты только используемых загруженных обложек. Встроенные `/assets/*.webp` уже входят в исходники. Auth, владельцы, сессии, ключи и счётчики входа не экспортируются. Проверяется, что статьи не изменились во время чтения.

После подготовки облачного владельца:

```bash
pnpm content:import work/content-export --dry-run
pnpm content:import work/content-export --apply
```

По умолчанию импорт работает как dry-run. Проверяются структура, контрольные суммы SHA-256, действительное декодирование изображений, ссылки и конфликты ID/slug/файлов. Совпадающие записи пропускаются, отличающиеся не перезаписываются. Сначала загружаются приватные обложки и регистрируются за облачным UUID владельца, затем вставляются статьи. Повторный запуск позволяет продолжить прерванный перенос без замены существующих данных.

На время переноса не редактируйте одни и те же материалы в двух окружениях. Опубликованные строки станут доступными через Supabase Data API после импорта; статус сохраняется осознанно. В этой подготовке импорт в облако не запускался.

## 6. Точный список переменных Vercel

В Vercel → Project Settings → Environment Variables задайте значения для **Production**. Для Preview используйте отдельно согласованный профиль; не направляйте автоматические тесты на рабочую облачную базу.

| Название | Назначение | Откуда взять значение |
| --- | --- | --- |
| `SUPABASE_URL` | Адрес облачного API | URL предоставленного проекта; уже записан в `.env.cloud.local` |
| `SUPABASE_PUBLISHABLE_KEY` | Доступ клиента с RLS и сессией пользователя | Предоставленный Publishable key этого проекта, Settings → API Keys |
| `SUPABASE_SECRET_KEY` | Только сервер: admin Auth, лимиты входа, проверенные операции Storage | **Secret key** (`sb_secret_…`) того же проекта, Settings → API Keys → Secret keys; пометьте секретным/sensitive |
| `SITE_ORIGIN` | Канонический HTTPS-адрес, SEO и secure cookie | Выбранный адрес проекта Vercel или собственный домен, без пути и завершающего `/` |
| `ALLOWED_ORIGINS` | Точные разрешённые адреса для входа и изменений | `SITE_ORIGIN`; при необходимости добавьте конкретные дополнительные HTTPS-origin через запятую, без wildcard |
| `ENABLE_EXPERIMENTAL_COREPACK` | Выбор закреплённого `pnpm@11.25.0` при установке | Буквальное значение `1`, не секрет |

Никаких `NEXT_PUBLIC_*` переменных для Supabase в этом приложении не требуется. Secret key нельзя помещать под таким префиксом. `SUPABASE_ACCESS_TOKEN`, пароль PostgreSQL, пароль владельца и `DATABASE_URL` для работающего приложения Vercel **не нужны**.

## 7. Настройки Vercel и сборка

- Framework: **Next.js**; Root Directory — папка текущего проекта.
- Node.js: **22.x**, закреплена диапазоном `>=22.13.0 <23` в package.json.
- Package manager: **pnpm 11.25.0** через Corepack; Install Command оставьте автоматической.
- Build Command: **pnpm build**. Output Directory — автоматическая Next.js.
- `vercel.json` задаёт Next.js и `fra1` (Frankfurt) для функций.
- Миграции, создание владельца и импорт не являются частью build/install.
- `pnpm start` и Docker не запускаются внутри Vercel Functions.

Обычная локальная проверка production-сборки:

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

После заполнения облачных переменных можно отдельно проверить сборку с ними:

```bash
pnpm cloud:build
```

Она передаёт облачные переменные только процессу сборки, очищает совместимые локальные имена ключей и не изменяет `.env.local`. Результат находится в обычной `.next`; перед последующим локальным `pnpm start` снова выполните `pnpm build` с локальным профилем. `cloud:build` до заполнения Secret key и SITE_ORIGIN откажется запускаться.

Сборка не подтверждает облачный вход/редактор. Перед публичным открытием проверьте на реальном Vercel-адресе вход/выход владельца, отказ гостю, загрузку до4 MiB, RU/EN, черновик, публикацию и снятие с публикации, отсутствие кеширования приватных обложек. Технические записи для такого теста создавайте отдельно от настоящих материалов.

## Проверки этого этапа

Выполнены typecheck, lint, production build и тесты новых настроек. RLS и дополнительная миграция проверены на отдельной настоящей PostgreSQL: **55 SQL-проверок**. Облачные URL/ключи, схема и dry-run миграций проверены только чтением; применение миграций, облачный аккаунт, импорт и Vercel runtime пока не запускались, а `SITE_ORIGIN` ещё не задан.

## Официальные источники

- [Supabase: новые Publishable/Secret keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase: управление окружениями и миграции](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase: настройки регистрации](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase: RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Vercel: переменные окружения](https://vercel.com/docs/environment-variables)
- [Vercel: Corepack](https://vercel.com/docs/builds/configure-a-build#corepack)
- [Vercel: версии Node.js](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
