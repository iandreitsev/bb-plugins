// Enhance BB's native project list in place; never replace or patch its bundle.
// Audited against bb 0.48.1. Unknown markup leaves the native list untouched.
const PROJECT = '[data-sidebar-sticky-project-item][data-sidebar-project-id]';
const ITEM = '[data-sidebar-windowed-item]';
const HIDDEN = 'data-codex-native-limit-hidden';
const LIMIT = 5;

export function mountNativeProjectLimit({ signal }: { signal: AbortSignal }) {
  const expanded = new Set<string>();
  const hidden = new Set<HTMLElement>();
  const controls = new Map<HTMLElement, { button: HTMLButtonElement; dispose: () => void }>();
  let frame: number | null = null;
  let disposed = false;
  const style = document.createElement('style');
  style.setAttribute('data-codex-native-limit-style', '');
  style.textContent = `
    [${HIDDEN}] { display:none !important; }
    [data-codex-native-limit-button] { display:inline-flex; align-items:center;
      height:28px; margin:2px 0 0 22px; padding:0 8px; border:0; border-radius:6px;
      background:transparent; cursor:pointer; font:inherit; font-size:13px;
      color:var(--muted-foreground); opacity:.75; }
    [data-codex-native-limit-button]:hover { background:var(--state-hover); opacity:1; }
    [data-codex-native-limit-button]:focus-visible { outline:1px solid var(--ring); }
  `;
  document.head.append(style);

  function reveal(item: HTMLElement) {
    item.removeAttribute(HIDDEN);
    hidden.delete(item);
  }
  function sync() {
    if (disposed) return;
    const keepHidden = new Set<HTMLElement>();
    const keepControls = new Set<HTMLElement>();
    // Ignore project cards elsewhere in the app and the plugin's Priority view.
    for (const project of Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="app-sidebar-body"] ${PROJECT}`))) {
      // Native top-level project content contains a sticky list of windowed roots.
      // Descendant windows belong to thread children / environment groups.
      const lists = Array.from(project.querySelectorAll<HTMLElement>('[data-sidebar-sticky-section]'))
        .filter(list => list.closest(PROJECT) === project && (!list.parentElement?.closest(ITEM) || !project.contains(list.parentElement.closest(ITEM))));
      if (lists.length !== 1) continue;
      const list = lists[0];
      const children = Array.from(list.children);
      if (!children.every(child => child instanceof HTMLElement && child.matches(ITEM))) continue;
      const items = children as HTMLElement[];
      if (items.length <= LIMIT) continue;
      const key = project.getAttribute('data-sidebar-project-id')!;
      const isExpanded = expanded.has(key);
      items.forEach((item, index) => {
        const selected = item.querySelector('[data-sidebar-thread-selected]');
        const focused = item.contains(document.activeElement);
        if (!isExpanded && index >= LIMIT && !selected && !focused) keepHidden.add(item);
      });
      keepControls.add(list);
      let control = controls.get(list);
      if (!control) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-codex-native-limit-button', '');
        const toggle = (event: MouseEvent) => {
          event.stopPropagation();
          if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
          sync();
        };
        button.addEventListener('click', toggle);
        control = { button, dispose: () => { button.removeEventListener('click', toggle); button.remove(); } };
        controls.set(list, control);
      }
      const { button } = control;
      const text = isExpanded ? 'Показать меньше' : 'Показать больше';
      if (button.textContent !== text) button.textContent = text;
      const pressed = String(isExpanded);
      if (button.getAttribute('aria-expanded') !== pressed) button.setAttribute('aria-expanded', pressed);
      if (list.nextSibling !== button) list.after(button);
    }
    for (const item of hidden) if (!keepHidden.has(item)) reveal(item);
    for (const item of keepHidden) {
      if (!item.hasAttribute(HIDDEN)) item.setAttribute(HIDDEN, '');
      hidden.add(item);
    }
    for (const [list, control] of controls) {
      if (!keepControls.has(list)) { control.dispose(); controls.delete(list); }
    }
  }
  const observer = new MutationObserver(() => {
    if (disposed || frame !== null) return;
    frame = window.requestAnimationFrame(() => { frame = null; sync(); });
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-sidebar-thread-selected', 'data-sidebar-windowed-nav', 'data-sidebar-project-id'] });
  // A focus moved into a concealed tree must reveal it before keyboard interaction.
  const focus = () => sync();
  document.addEventListener('focusin', focus);
  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
    document.removeEventListener('focusin', focus);
    for (const item of hidden) item.removeAttribute(HIDDEN);
    hidden.clear();
    for (const control of controls.values()) control.dispose();
    controls.clear();
    style.remove();
    signal.removeEventListener('abort', dispose);
  }
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose(); else sync();
  return dispose;
}
