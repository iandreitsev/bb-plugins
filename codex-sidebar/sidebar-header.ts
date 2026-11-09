import { toggleSidebarView } from "./shared";

// bb 0.47 host DOM integration: the Rail navigation's header slot, which holds
// New thread. The header survives thread-list switches.
const HEADER = '[data-testid="sidebar-header-slot"][data-sidebar-header-slot]';
const PRIORITY = '[data-codex-priority-view]';
const BUTTON = 'data-codex-priority-toggle';

export function mountSidebarToggle({ signal }: { signal: AbortSignal }) {
  const owned = new Set<HTMLButtonElement>();
  let pending = false;
  let failed = false;
  let frame: number | null = null;
  let disposed = false;
  const style = document.createElement('style');
  style.textContent = `
    [${BUTTON}] { display:inline-flex; align-items:center; justify-content:center;
      flex:0 0 auto; width:26px; height:26px; margin-inline:4px; padding:0;
      border:0; border-radius:7px; background:transparent; color:inherit; cursor:pointer; }
    [${BUTTON}][aria-pressed="true"] {
      background:#dfeafb; color:#5e6ad2; }
    [${BUTTON}]:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
    [${BUTTON}]:disabled { opacity:.5; cursor:wait; }
    [${BUTTON}] svg { width:14px; height:14px; pointer-events:none; }
  `;
  document.head.append(style);

  function sync() {
    if (disposed) return;
    for (const button of owned) {
      if (!button.isConnected) {
        button.removeEventListener('click', activate);
        button.remove();
        owned.delete(button);
      }
    }
    for (const header of Array.from(document.querySelectorAll<HTMLElement>(HEADER))) {
      let button = [...owned].find((item) => item.parentElement === header);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.setAttribute(BUTTON, '');
        button.setAttribute('aria-label', 'Приоритет');
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>';
        button.addEventListener('click', activate, { signal });
        owned.add(button);
        header.append(button);
      }
      const body = header.closest('[data-testid="app-sidebar-body"]');
      const active = (body ?? document).querySelector(PRIORITY) !== null;
      const pressed = String(active);
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
      const title = failed ? 'Не удалось переключить. Нажмите ещё раз.'
        : active ? 'Вернуться к обычному списку' : 'Показать приоритет';
      if (button.title !== title) button.title = title;
      if (button.disabled !== pending) button.disabled = pending;
    }
  }

  async function activate() {
    if (pending || disposed) return;
    pending = true;
    failed = false;
    sync();
    try {
      await toggleSidebarView();
    } catch (error) {
      if (!disposed) {
        console.warn('[codex-sidebar] toggle-view failed', error);
        // Keep an actionable failure visible without changing the current list.
        failed = true;
      }
    } finally {
      pending = false;
      sync();
    }
  }

  // Child-list only: our title/pressed/disabled updates never retrigger this.
  const observer = new MutationObserver(() => {
    if (disposed || frame !== null) return;
    frame = window.requestAnimationFrame(() => { frame = null; sync(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    for (const button of owned) {
      button.removeEventListener('click', activate);
      button.remove();
    }
    owned.clear();
    style.remove();
    signal.removeEventListener('abort', dispose);
  }
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  else sync();
  return dispose;
}
