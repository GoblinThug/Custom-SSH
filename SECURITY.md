# Security Policy

Русский · [English](#-english)

---

# 🇷🇺 Русский

CustomSSH — локальный SSH-клиент: пароли и ключи хранятся на устройстве пользователя. Сообщения о уязвимостях принимаем всерьёз.

## Как сообщить об уязвимости

**Не** создавайте публичный Issue с деталями эксплойта.

Предпочтительный способ — [GitHub Security Advisory](https://github.com/GoblinThug/Custom-SSH/security/advisories/new) (приватный отчёт).

Если advisory недоступен, напишите автору через GitHub ([@GoblinThug](https://github.com/GoblinThug)) **без** публикации PoC в открытом issue.

В отчёте по возможности укажите:

- версию приложения и ОС;
- тип проблемы (утечка секретов, RCE, path traversal в SFTP, XSS в редакторе и т.п.);
- шаги воспроизведения;
- влияние и, если есть, предложенный фикс.

## Что считается в приоритете

- Утечка или слабое хранение паролей / ключей / бэкапов.
- Выполнение кода вне ожидаемой песочницы Electron.
- Обход ограничений при работе с удалённой ФС / путями.
- Подмена обновлений (если применимо к каналу автообновления).

## Что обычно не является уязвимостью

- Отсутствие подписи Apple / SmartScreen у сборок с GitHub Releases (известное ограничение unsigned-сборок).
- Проблемы на стороне SSH-сервера или сети пользователя.
- Вопросы удобства UI без влияния на безопасность.

## Сроки ответа

Постараемся ответить в разумный срок (обычно в течение нескольких дней). Пожалуйста, дайте время на проверку и выпуск исправления до публичного раскрытия.

## Безопасное использование

Кратко для пользователей: см. раздел «Безопасность» в [README](README.md#-безопасность).

---

# 🇬🇧 English

CustomSSH is a local SSH client: passwords and keys stay on the user’s machine. We take vulnerability reports seriously.

## How to report

Do **not** open a public Issue with exploit details.

Preferred channel: a private [GitHub Security Advisory](https://github.com/GoblinThug/Custom-SSH/security/advisories/new).

If that isn’t available, contact the maintainer via GitHub ([@GoblinThug](https://github.com/GoblinThug)) **without** posting a PoC in a public issue.

Please include when possible:

- app version and OS;
- issue type (secret leakage, RCE, SFTP path traversal, editor XSS, etc.);
- reproduction steps;
- impact and, if you have one, a suggested fix.

## High priority

- Leakage or weak storage of passwords / keys / backups.
- Code execution outside the expected Electron boundary.
- Bypassing remote filesystem / path checks.
- Update tampering (where the auto-update channel applies).

## Usually not vulnerabilities

- Missing Apple notarization / SmartScreen on GitHub Release builds (known unsigned-build limitation).
- Issues on the user’s SSH server or network.
- Pure UX requests with no security impact.

## Response

We’ll aim to reply within a reasonable time (typically a few days). Please allow time to investigate and ship a fix before public disclosure.

## Safe usage

For end users, see the Security section in the [README](README.md#-security).
