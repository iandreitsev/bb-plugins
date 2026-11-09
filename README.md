# BB Plugins

Четыре плагина для [BB](https://getbb.app): ответы на цитаты, мобильное выделение текста, боковая панель с приоритетами и запуск команд из блоков кода.

| Плагин | Что делает |
| --- | --- |
| [Quote Reply](./quote-reply) | Ответы на выделенные фрагменты с компактными карточками цитат в поле ввода |
| [BB Mobile](./mobile) | Сохраняет выделение на телефоне и предлагает ответить, процитировать или открыть боковой чат |
| [Codex Sidebar](./codex-sidebar) | Группирует треды по приоритету и дате, поддерживает вложенность и ручной порядок |
| [Code Block Runner](./code-block-runner) | Запускает shell-блок по кнопке, показывает результат и передаёт его исходному агенту |

## Установка

Требуется установленный BB. Для всех четырёх плагинов вместе используйте BB 0.48 или новее с Plugin SDK 0.6.104 или новее. BB проверяет совместимость каждого плагина при установке. Интерфейс некоторых действий — на русском языке.

Выполните команду для нужного плагина и подтвердите установку из этого репозитория:

```sh
bb plugin install git:https://github.com/iandreitsev/bb-plugins.git@main --plugin quote-reply
bb plugin install git:https://github.com/iandreitsev/bb-plugins.git@main --plugin mobile
bb plugin install git:https://github.com/iandreitsev/bb-plugins.git@main --plugin codex-sidebar
bb plugin install git:https://github.com/iandreitsev/bb-plugins.git@main --plugin code-block-runner
```

Каждый плагин включается и отключается отдельно. Для мобильных ответов на цитаты установите и `mobile`, и `quote-reply`.

Обновления отслеживают ветку `main`:

```sh
bb plugin outdated
bb plugin update quote-reply
```

В последней команде замените `quote-reply` на идентификатор нужного плагина.

## Поведение и ограничения

Code Block Runner выполняет команды по нажатию кнопки в рабочей папке и на машине исходного треда. Он использует обычные права терминала; перед запуском прочитайте весь блок. Результат передаётся агенту и может запустить его следующий ход.

Quote Reply хранит цитаты и ответы в локальном хранилище плагина на сервере BB. Для раскрытия сохранённых цитат агенту плагин должен оставаться включённым; его данные следует сохранять вместе с резервной копией BB.

Часть интерфейсных доработок зависит от разметки BB. После обновления BB может потребоваться обновление плагинов. Поведение системного выделения и клавиатуры зависит от мобильного браузера; подробности и ограничения описаны в README каждого плагина.

## Разработка и проверка

Каждая папка содержит собственные зависимости, lock-файл и тесты. Для разработки нужны Node.js 22.12+ из ветки 22, Node.js 24 или 26+, npm и команда `bb` в `PATH`.

```sh
git clone https://github.com/iandreitsev/bb-plugins.git
cd bb-plugins
npm --prefix quote-reply ci --include=dev
npm --prefix mobile ci --include=dev
npm --prefix codex-sidebar ci --include=dev
npm --prefix code-block-runner ci --include=dev
npm test
npm run check
npm run build
```

Корневой пакет запускает проверки всех четырёх плагинов. Для локального подключения используйте `bb plugin install ./quote-reply`, затем после изменений — `bb plugin build ./quote-reply` и `bb plugin reload quote-reply`. Подставьте папку и идентификатор нужного плагина.

## Лицензия

[MIT](./LICENSE). Заимствованная логика активности тредов BB сохраняет авторство и [лицензию Michael Yong](./codex-sidebar/BB-LICENSE.txt).
