# Codex Sidebar

A BB sidebar list using BB's native typography, status glyphs, provider icons and thread actions, grouped by Priority and date.

## Thread organization

- Pinned trees are hidden by default in Priority mode. The “…” menu beside “Приоритет” toggles “Закреплённые”; this choice persists locally and does not change BB pin state or its standard sidebar. When enabled, pinned root threads appear first. A pinned child becomes its own root.
- Priority contains working or unread trees and threads that started or failed since the last clear. Marking a root or child unread immediately returns its whole tree to Priority. Reading it keeps the reminder in Priority until “Убрать прочитанные” is used; unread trees are protected from that clear action. “Убрать прочитанные” removes stored Priority entries only for fully read, finished trees; pinned threads stay pinned.
- Remaining trees are grouped as Сегодня, Вчера, recent weekdays, then months, according to their latest attention time. Labels follow local midnight, including daylight saving changes. Returning to the window, making it visible or restoring the page resynchronizes the calendar to catch suspended timers after sleep or clock changes.
- Visible child threads nest under their parent. Folding a tree rolls its descendant activity into the parent's glyph. Navigating to a child reveals its ancestors; folding state persists locally.
- Project names sit beside titles in muted text. Long titles fade at the edge; project names truncate within their allotted width. A child's repeated project name is omitted.

The “…” popover also toggles the Priority section. When hidden, its trees return to date groups and the menu moves to the first date heading (or “Сегодня” when there are no date groups). “Отметить все как прочитанные” uses BB’s read-state API for all non-archived, non-hidden unread threads, including collapsed children and hidden pinned trees. It does not archive threads or clear Priority membership.

The bell beside BB's new-thread control switches between this view and BB's standard list. The command “Сайдбар: приоритет / по проектам” provides the same switch and can be bound in BB's keyboard settings. Settings → Appearance → Sidebar also selects the list provider.

Rows keep BB's context menu, drag-to-split, Cmd/Ctrl-click split navigation and numbered jump shortcuts. The quick action copies the thread link; double-clicking the title runs BB's rename action.

## Five threads in the standard BB list

While the plugin is enabled, its `native-project-limit` content script enhances BB's standard project groups in place: five root items, “Показать больше / меньше”, and an exception for the selected or focused tree. BB continues to render rows, project controls, environments, nesting and menus. Disabling or reloading the plugin removes its buttons and reveals the full standard list. BB's application files stay original.

This integration uses native `data-sidebar-*` markup, audited against BB 0.48.1. It handles windowed placeholders and project remounts. Unknown list structure leaves the list fully visible. Updates keep the plugin files, but changes to BB's markup may require updating this content script.

## State and implementation

Priority is stored in the BB server's plugin KV storage, capped at 500 entries. Server events track visible threads even while the sidebar is closed; reconnecting refreshes the client. Archived entries remain stored so BB's archive Undo can restore Priority membership. Hidden helper threads are excluded; visible children participate in their tree's Priority and read state. Folding lives in browser localStorage and synchronizes across windows on the same origin.

The frontend uses public `@get-bb/plugin-sdk/app` APIs. A small content script mounts the bell into the host header; its selectors require a live check after BB layout changes. The toggle route updates BB's revisioned sidebar-provider preference on the server, so the choice is shared by clients using that BB server, and retries once on failure.

## Development checks

Run `npm ci`, `npm test`, `npm run typecheck` and `bb plugin build` from this directory. Backend tests use the SDK fake host and real temporary SQLite storage. Its optional peers `better-sqlite3`, `hono` and `cron-parser` remain as test dependencies because the harness imports them. UI regression tests exercise folding, activity rollup, clearing protection, reconnection, header lifecycle and daylight saving boundaries with targeted DOM/runtime doubles. A live BB check covers actual host menus, splits, shortcuts, layout and CSS.

### Upstream activity policy

`native-thread-activity.ts` vendors BB's `plugins/thread-list/app/model/thread-activity.ts` from commit `d1b60165c69cde7f92f74c5a7e8ff95deb70d5ae` in [get-bb/bb](https://github.com/get-bb/bb). Copyright and MIT terms are in `BB-LICENSE.txt`. The file matches upstream apart from its two attribution lines.

On a BB upgrade, run `npm run check:upstream -- /path/to/bb-checkout`. A mismatch requires reviewing and porting the upstream change, rerunning tests and checking native glyphs live. Native row markup and `native-row.css` also follow BB's thread row and need visual comparison after host upgrades. Public SDK usage reduces coupling; copied policy and host header selectors still require maintenance.

### Large lists

Collapsed children are unmounted; expanded rows render in full. SDK 0.6.49 exposes neither a virtualizer nor a sidebar scroll element contract. BB assigns numbered jump shortcuts from DOM order, so removing offscreen rows changes shortcut behavior. Virtualization remains deferred until scroll ownership, selected-row reveal, menu focus and shortcut behavior can be preserved together. Large expanded lists can therefore cost more DOM and layout work; no measured performance threshold is claimed.

## Manual ordering

Drag a row onto the upper or lower half of another row to place it before or after that row. Root threads move with their children; children can be reordered among siblings. Drops across sections or parents are ignored. Order is local to the browser, persists across reloads and follows calendar dates when Today becomes Yesterday. New entries follow existing manually ordered rows. BB still assigns section membership by activity/date; a thread changing section uses that section’s order. Mouse and pen dragging are supported; touch retains normal scrolling. Cmd/Ctrl-click and the host split pointer handler remain available.
