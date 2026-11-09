import { useEffect, useId, useState } from "react";

function readPreference(key: string, fallback: boolean) {
  try { const value = localStorage.getItem(key); return value === null ? fallback : value === "true"; }
  catch { return fallback; }
}

function useVisibility(KEY: string, fallback: boolean) {
  const [showPinned, setShowPinned] = useState(() => readPreference(KEY, fallback));
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === KEY || event.key === null) setShowPinned(readPreference(KEY, fallback));
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [KEY, fallback]);
  const change = (value: boolean) => {
    setShowPinned(value);
    try { localStorage.setItem(KEY, String(value)); }
    catch (error) { console.warn("[codex-sidebar] saving view preference failed", error); }
  };
  return { showPinned, setShowPinned: change };
}

export function useShowPinned() { return useVisibility("codex-sidebar.show-pinned.v1", false); }
export function useShowPriority() {
  const { showPinned, setShowPinned } = useVisibility("codex-sidebar.show-priority.v1", true);
  return { showPriority: showPinned, setShowPriority: setShowPinned };
}

const itemClass = "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:bg-sidebar-accent disabled:pointer-events-none disabled:text-subtle-foreground";
function Check({ checked }: { checked: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ visibility: checked ? "visible" : "hidden", flexShrink: 0 }}><path d="m5 12 4 4L19 5" /></svg>;
}
export function ViewOptions({ showPinned, onChange, showPriority, onPriorityChange, onReadAll, canRead, reading, readError, buttonClass }: {
  showPinned: boolean; onChange: (value: boolean) => void;
  showPriority: boolean; onPriorityChange: (value: boolean) => void;
  onReadAll: () => void; canRead: boolean; reading: boolean; readError: string;
  buttonClass: string;
}) {
  const id = useId();
  const [position, setPosition] = useState({ top: 0, left: 0 });
  return <>
    <button type="button" className={buttonClass} popoverTarget={id}
      title="Настройки списка" aria-label="Настройки списка"
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 200)),
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 252)) });
      }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="20" cy="12" r="2"/>
      </svg>
    </button>
    <div id={id} popover="auto" aria-label="Настройки списка"
      className="rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ position: "fixed", margin: 0, inset: "auto", ...position, width: 244, maxWidth: "calc(100vw - 16px)" }}>
      <div className="px-2 py-1.5 text-sm text-subtle-foreground">Показывать</div>
      <button type="button" role="checkbox" aria-checked={showPriority} className={itemClass}
        onClick={() => onPriorityChange(!showPriority)}>Раздел «Приоритетное»<Check checked={showPriority} /></button>
      <button type="button" role="checkbox" aria-checked={showPinned} aria-label="Показывать закреплённые" className={itemClass}
        onClick={() => onChange(!showPinned)}>Закреплённые<Check checked={showPinned} /></button>
      <div role="separator" className="mx-2 my-1 border-t border-border" />
      <button type="button" className={itemClass} disabled={!canRead || reading} onClick={onReadAll}>
        {reading ? "Отмечаю прочитанными…" : "Отметить все как прочитанные"}
      </button>
      {readError ? <p role="alert" className="px-2 py-1 text-xs text-destructive">{readError}</p> : null}
    </div>
  </>;
}
