# Contributing to CustomSSH

Русский · [English](#-english)

---

# 🇷🇺 Русский

Спасибо за интерес к проекту. Ниже — как быстро войти в разработку и оформить изменения.

## С чего начать

1. Найдите или создайте [Issue](https://github.com/GoblinThug/CustomSSH/issues) с описанием бага или идеи.
2. Сделайте fork и ветку от `main` (например `fix/editor-search` или `feat/import-xyz`).
3. Внесите изменения, проверьте локально, откройте Pull Request.

Небольшие правки (опечатки, README, стили) можно присылать сразу — отдельный issue не обязателен.

## Локальный запуск

Нужны **Node.js 22+** и npm.

```bash
git clone https://github.com/GoblinThug/CustomSSH.git
cd CustomSSH
npm install
npm run dev
```

Сборка установщиков:

```bash
npm run dist          # Windows → папка release/
npm run dist:mac      # macOS (нужен Mac)
npm run dist:linux    # Linux → AppImage + deb
```

Иконки: `npm run icons` (из `build/icon.png` → `build/icon.ico`).

## Структура

| Путь | Назначение |
|---|---|
| `src/` | React UI (основное окно + редактор) |
| `electron/` | Main/preload, SSH, SFTP, обновления, импорт |
| `build/` | Иконки и ресурсы сборки |
| `docs/screenshots/` | Скриншоты для README |
| `.github/workflows/` | CI / релизы |

## Что желательно соблюдать

- Не коммитьте секреты, ключи, `connections.json`, `.env`.
- Держите PR сфокусированным: одна задача — один PR.
- UI-строки добавляйте в `src/i18n/messages.ts` (**en** и **ru**).
- Для багов приложите ОС, версию приложения и шаги воспроизведения.
- Для UI — скриншот «до/после», если уместно.

## Безопасность

Уязвимости **не** публикуйте в обычных Issues. См. [SECURITY.md](SECURITY.md).

## Лицензия

Внося вклад, вы соглашаетесь, что ваш код распространяется под [MIT](LICENSE) (русский перевод: [LICENSE.ru](LICENSE.ru)).

---

# 🇬🇧 English

Thanks for your interest. Here’s how to get started and submit changes.

## Getting started

1. Find or open an [Issue](https://github.com/GoblinThug/CustomSSH/issues) describing the bug or idea.
2. Fork and branch from `main` (e.g. `fix/editor-search` or `feat/import-xyz`).
3. Make your changes, test locally, open a Pull Request.

Tiny fixes (typos, README, styling) can skip a separate issue.

## Local setup

Requires **Node.js 22+** and npm.

```bash
git clone https://github.com/GoblinThug/CustomSSH.git
cd CustomSSH
npm install
npm run dev
```

Build installers:

```bash
npm run dist          # Windows → release/
npm run dist:mac      # macOS (needs a Mac)
npm run dist:linux    # Linux → AppImage + deb
```

Icons: `npm run icons` (from `build/icon.png` → `build/icon.ico`).

## Layout

| Path | Purpose |
|---|---|
| `src/` | React UI (main window + editor) |
| `electron/` | Main/preload, SSH, SFTP, updates, import |
| `build/` | Icons and packaging resources |
| `docs/screenshots/` | README screenshots |
| `.github/workflows/` | CI / releases |

## Guidelines

- Never commit secrets, keys, `connections.json`, or `.env`.
- Keep PRs focused: one concern per PR.
- Add UI strings in `src/i18n/messages.ts` (**en** and **ru**).
- For bugs: include OS, app version, and reproduction steps.
- For UI: before/after screenshots when helpful.

## Security

Do **not** report vulnerabilities in public Issues. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree your work is licensed under [MIT](LICENSE) (Russian translation: [LICENSE.ru](LICENSE.ru)).
