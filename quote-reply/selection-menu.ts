/** Reorders the native selection menu without replacing BB's buttons or event handlers. */
interface MenuChange {
  menu: HTMLElement;
  originalOrder: Map<HTMLElement, string>;
  label: Text;
  originalLabel: string;
  sideLabels: Map<Text, string>;
}

export function mountSelectionMenu(): () => void {
  const changes = new Map<HTMLElement, MenuChange>();
  let disposed = false;
  let scheduled = false;
  function scan(): void {
    scheduled = false;
    if (disposed) return;
    for (const [menu] of changes) if (!menu.isConnected) changes.delete(menu);
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-radix-popper-content-wrapper] button")) {
      if (!["Add to chat", "Цитировать"].includes(button.textContent?.trim() ?? "")) continue;
      const quoteRow = button.parentElement;
      const menu = quoteRow?.parentElement;
      if (!menu || !quoteRow) continue;
      const rows = Array.from(menu.children);
      // The native selection menu has one direct button per row. Ignore toolbars and other popovers.
      if (!rows.every(row => row.querySelectorAll(":scope > button").length === 1)) continue;
      const replyRow = rows.find(row => row.querySelector(":scope > button")?.textContent?.trim() === "Ответить");
      if (!replyRow) continue;
      let change = changes.get(menu);
      if (!change) {
        const label = Array.from(button.childNodes).find((node): node is Text => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === "Add to chat");
        if (!label) continue;
        change = { menu, originalOrder: new Map(), label, originalLabel: label.data, sideLabels: new Map() };
        changes.set(menu, change);
        menu.setAttribute("data-qr-selection-menu", "");
      }
      if (change.label.data !== "Цитировать") change.label.data = "Цитировать";
      for (const row of rows) {
        const sideButton = row.querySelector(":scope > button");
        if (sideButton?.textContent?.trim() !== "Reply in side chat") continue;
        for (const node of Array.from(sideButton.childNodes)) {
          if (node.nodeType !== Node.TEXT_NODE || node.textContent?.trim() !== "Reply in side chat") continue;
          const label = node as Text;
          if (!change.sideLabels.has(label)) change.sideLabels.set(label, label.data);
          label.data = "В боковой чат";
        }
      }
      const ordered = [replyRow, ...rows.filter(row => row !== replyRow && row !== quoteRow), quoteRow];
      for (let index = 0; index < ordered.length; index++) {
        const row = ordered[index] as HTMLElement;
        if (!change.originalOrder.has(row)) change.originalOrder.set(row, row.style.order);
        row.style.order = String(index);
      }
    }
  }
  function schedule(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(scan);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
  return () => {
    disposed = true;
    observer.disconnect();
    for (const { menu, originalOrder, label, originalLabel, sideLabels } of changes.values()) {
      menu.removeAttribute("data-qr-selection-menu");
      if (label.data === "Цитировать") label.data = originalLabel;
      for (const [sideLabel, original] of sideLabels) if (sideLabel.data === "В боковой чат") sideLabel.data = original;
      for (const [row, order] of originalOrder) row.style.order = order;
    }
    changes.clear();
  };
}
