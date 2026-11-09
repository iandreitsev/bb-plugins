/** Hide native quote pills; the summary owns presentation, the SDK owns their content. */
import { experimental_readPromptMentionClipboard } from "@get-bb/plugin-sdk/app";
import { PROVIDER } from "./quotes";

interface Binding { anchor: HTMLElement; pluginId: string; pills: Set<HTMLElement> }
const bindings = new Set<Binding>();
let refresh: (() => void) | null = null;
function release(binding: Binding) {
  for (const pill of binding.pills) pill.removeAttribute("data-qr-decorated");
  binding.pills.clear();
}
export function bindInlineCards(anchor: HTMLElement, pluginId: string): () => void {
  const binding: Binding = { anchor, pluginId, pills: new Set() };
  bindings.add(binding);
  refresh?.();
  return () => { bindings.delete(binding); release(binding); };
}
export function mountInlineCards(): () => void {
  let scheduled = false;
  let disposed = false;
  function reconcile(): void {
    scheduled = false;
    if (disposed) return;
    for (const binding of bindings) {
      let form: Element | null = binding.anchor.closest("[data-promptbox]");
      for (let parent = binding.anchor.parentElement; !form && parent; parent = parent.parentElement) {
        const boxes = parent.querySelectorAll("[data-promptbox]");
        if (boxes.length > 1) break;
        if (boxes.length === 1) form = boxes[0];
        if (parent.hasAttribute("data-thread-window")) break;
      }
      const next = new Set<HTMLElement>();
      for (const pill of form?.querySelectorAll<HTMLElement>("[data-prompt-mention]") ?? []) {
        const parsed = experimental_readPromptMentionClipboard(pill)?.mention;
        if (parsed?.kind !== "plugin" || parsed.pluginId !== binding.pluginId || parsed.provider !== PROVIDER) continue;
        pill.setAttribute("data-qr-decorated", "");
        next.add(pill);
      }
      for (const pill of binding.pills) if (!next.has(pill)) pill.removeAttribute("data-qr-decorated");
      binding.pills = next;
    }
  }
  function schedule(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(reconcile);
  }
  refresh = schedule;
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-prompt-mention-resource"] });
  schedule();
  return () => { disposed = true; observer.disconnect(); refresh = null; for (const binding of bindings) release(binding); };
}
