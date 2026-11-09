import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
const KEY = "codex-sidebar.row-order.v1";
type Orders = Record<string, string[]>;
function read(): Orders {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, ids]) => Array.isArray(ids) && ids.every(id => typeof id === "string")));
  } catch { return {}; }
}
export function orderedIds(ids: readonly string[], saved: readonly string[] = []) {
  const valid = new Set(ids);
  const known = [...new Set(saved)].filter(id => valid.has(id));
  const seen = new Set(known);
  return [...known, ...ids.filter(id => !seen.has(id))];
}
export function moveWithin(ids: readonly string[], source: string, target: string, after: boolean) {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return [...ids];
  const result = ids.filter(id => id !== source);
  result.splice(result.indexOf(target) + Number(after), 0, source);
  return result;
}
export function useRowOrder(groups: Map<string, string[]>) {
  const [orders, setOrders] = useState<Orders>(read);
  const latest = useRef({ groups, orders }); latest.current = { groups, orders };
  const cleanup = useRef<(() => void) | null>(null);
  const suppressClickUntil = useRef(0);
  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key === KEY || event.key === null) setOrders(read()); };
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("storage", refresh); cleanup.current?.(); };
  }, []);
  function start(event: ReactPointerEvent<HTMLElement>, scope: string, id: string) {
    if (event.button !== 0 || event.pointerType === "touch" || event.target instanceof window.Element && event.target.closest('button,input,[role="checkbox"]')) return;
    cleanup.current?.();
    const origin = event.currentTarget;
    const nav = origin.closest('nav');
    const x = event.clientX, y = event.clientY, pointer = event.pointerId;
    let dragging = false;
    let target: HTMLElement | null = null;
    let after = false;
    let preview: HTMLDivElement | null = null;
    let marker: HTMLDivElement | null = null;
    const sourceTree = origin.parentElement;
    function clearTarget() { marker?.remove(); marker = null; target = null; }
    function showPreview(e: PointerEvent) {
      if (!preview) {
        preview = window.document.createElement('div');
        preview.className = 'cs-drag-preview';
        preview.setAttribute('aria-hidden', 'true');
        const link = origin.querySelector('a');
        const icon = link?.firstElementChild;
        if (icon && !icon.classList.contains('cs-row-title')) {
          const copy = icon.cloneNode(true) as HTMLElement;
          copy.removeAttribute('id');
          copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
          preview.append(copy);
        }
        const label = window.document.createElement('span');
        label.textContent = link?.getAttribute('aria-label') ?? origin.textContent ?? '';
        preview.append(label);
        window.document.body.append(preview);
        sourceTree?.setAttribute('data-order-dragging', '');
      }
      preview.hidden = false;
      preview.style.left = `${Math.max(4, Math.min(e.clientX + 10, window.innerWidth - preview.offsetWidth - 4))}px`;
      preview.style.top = `${Math.max(4, Math.min(e.clientY + 12, window.innerHeight - preview.offsetHeight - 4))}px`;
    }
    function move(e: PointerEvent) {
      if (e.pointerId !== pointer) return;
      if (!dragging && Math.hypot(e.clientX - x, e.clientY - y) < 6) return;
      dragging = true;
      const rect = nav?.getBoundingClientRect();
      if (!rect || e.clientX < rect.left || e.clientX > rect.right) { clearTarget(); if (preview) preview.hidden = true; sourceTree?.removeAttribute('data-order-dragging'); return; }
      showPreview(e);
      sourceTree?.setAttribute('data-order-dragging', '');
      e.preventDefault();
      const hit = window.document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-order-id]');
      clearTarget();
      if (hit && hit.dataset.orderScope === scope && hit.dataset.orderId !== id) {
        target = hit;
        const box = hit.getBoundingClientRect();
        after = e.clientY > box.top + box.height / 2;
        marker = window.document.createElement('div');
        marker.className = 'cs-drop-marker';
        marker.setAttribute('aria-hidden', 'true');
        const inset = Number.parseFloat(hit.style.paddingLeft) || 8;
        const bottom = hit.parentElement?.getBoundingClientRect().bottom ?? box.bottom;
        Object.assign(marker.style, {
          left: `${box.left + inset}px`, top: `${after ? Math.max(box.bottom, bottom) : box.top}px`,
          width: `${Math.max(0, box.width - inset - 8)}px`,
        });
        window.document.body.append(marker);
      }
      // Scroll the nearest scrolling ancestor while moving at its edges.
      for (let el = nav?.parentElement; el; el = el.parentElement) {
        if (el.scrollHeight <= el.clientHeight || !/auto|scroll/.test(window.getComputedStyle(el).overflowY)) continue;
        const box = el.getBoundingClientRect();
        if (e.clientY < box.top + 32) el.scrollTop -= 18;
        else if (e.clientY > box.bottom - 32) el.scrollTop += 18;
        break;
      }
    }
    function finish(e: PointerEvent) {
      if (e.pointerId !== pointer) return;
      if (dragging) suppressClickUntil.current = Date.now() + 400;
      if (e.type === 'pointerup' && target && window.document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-order-id]') === target && target.isConnected && origin.isConnected && origin.dataset.orderScope === scope && target.dataset.orderScope === scope) {
        const current = latest.current;
        const ids = current.groups.get(scope) ?? [];
        const targetId = target.dataset.orderId!;
        if (ids.includes(id) && ids.includes(targetId)) {
          const next = { ...current.orders, [scope]: moveWithin(orderedIds(ids, current.orders[scope]), id, targetId, after) };
          setOrders(next);
          try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (error) { console.warn('[codex-sidebar] saving order failed', error); }
        }
      }
      dispose();
    }
    function dispose() {
      clearTarget();
      preview?.remove(); preview = null;
      sourceTree?.removeAttribute('data-order-dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', dispose);
      cleanup.current = null;
    }
    cleanup.current = dispose;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', dispose);
  }
  return {
    sort<T>(scope: string, items: readonly T[], id: (item: T) => string): T[] {
      const rank = new Map(orderedIds(items.map(id), orders[scope]).map((key, index) => [key, index]));
      return [...items].sort((a,b) => rank.get(id(a))! - rank.get(id(b))!);
    }, start,
    suppressClick() { return Date.now() < suppressClickUntil.current; },
  };
}
