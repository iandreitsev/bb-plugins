/** Captures selection geometry before the native message-action button takes focus. */
export interface ReplyAnchor { range?: Range; rect: { left: number; top: number; bottom: number; right: number } }
let selected: { text: string; range: Range } | null = null;
let pointer = { x: 24, y: 100 };

export function captureReplyAnchor(text?: string): ReplyAnchor {
  if (text && selected?.text === text && selected.range.startContainer.isConnected) {
    const range = selected.range.cloneRange();
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return { range, rect: { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right } };
  }
  return { rect: { left: pointer.x, right: pointer.x, top: pointer.y, bottom: pointer.y } };
}
export function mountSelectionCapture(): () => void {
  function capture(): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const parent = range.commonAncestorContainer.parentElement;
    if (parent?.closest('[contenteditable="true"], textarea, .qr-floating')) return;
    selected = { text: selection.toString(), range: range.cloneRange() };
  }
  function onPointer(event: PointerEvent): void { pointer = { x: event.clientX, y: event.clientY }; capture(); }
  document.addEventListener("selectionchange", capture);
  document.addEventListener("pointerdown", onPointer, true);
  return () => {
    document.removeEventListener("selectionchange", capture);
    document.removeEventListener("pointerdown", onPointer, true);
    selected = null;
  };
}

export function popupPosition(anchor: ReplyAnchor["rect"], width: number, height: number, viewport: { width: number; height: number }): { left: number; top: number } {
  const margin = 12;
  const above = anchor.top - height - 10;
  const below = anchor.bottom + 10;
  const top = above >= margin ? above : below + height <= viewport.height - margin ? below : Math.max(margin, viewport.height - height - margin);
  return { left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)), top };
}

/** Eight visible text lines at most; a short viewport may fit fewer. */
export function replyFieldHeight(contentHeight: number, lineHeight: number, availableHeight: number): number {
  const minimumHeight = Math.max(26, lineHeight);
  const maximumHeight = Math.max(minimumHeight, Math.min(lineHeight * 8, availableHeight));
  return Math.min(Math.max(contentHeight, minimumHeight), maximumHeight);
}

/** Keep the opening top until growth reaches the composer or viewport boundary. */
export function growingPopupTop(openingTop: number, height: number, bottomBoundary: number): number {
  return Math.max(12, Math.min(openingTop, bottomBoundary - height - 12));
}

/** The banner marker belongs to the same composer as the popup's SDK handle. */
export function replyBottomBoundary(marker: HTMLElement | null, viewportHeight: number): number {
  for (let parent = marker?.parentElement; parent; parent = parent.parentElement) {
    const composer = parent.querySelector<HTMLElement>("[data-promptbox]");
    if (!composer) continue;
    const rect = composer.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.top > 12) return Math.min(viewportHeight, rect.top);
  }
  return viewportHeight;
}
