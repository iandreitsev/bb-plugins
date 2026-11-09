// Constants shared by server.ts and app.tsx. No imports: app.tsx may import
// values from here without pulling the backend into the browser bundle.

/** Realtime channel server.ts publishes on after every Priority change. */
export const PRIORITY_CHANGED = "priority-changed";

/** Persist at most this many reminders; unread trees stay visible regardless. */
export const MAX_PRIORITY_ENTRIES = 500;

/** This plugin's id, from the package name bb-plugin-<id>. */
export const PLUGIN_ID = "codex-sidebar";
/** The `experimental_threadList` registration id in app.tsx. */
export const LIST_ID = "codex-list";

/**
 * Switches the sidebar between bb's own list (by project) and this plugin's
 * Priority list. A plain HTTP route rather than RPC so host-rendered controls
 * (the footer button, the palette command) can call it without a mounted
 * plugin component.
 */
export const TOGGLE_VIEW_PATH = "/toggle-view";

export function toggleSidebarView(): Promise<void> {
  return fetch(`/api/v1/plugins/${PLUGIN_ID}/http${TOGGLE_VIEW_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).then((response) => {
    if (!response.ok) throw new Error(`toggle-view: HTTP ${response.status}`);
  });
}
