import { useEffect, useState, type RefObject } from "react";

/** Narrow adapter to BB's existing Stop action. No recording implementation here.
 * If the host control changes, disable this optional action and leave BB intact.
 */
export function NativeVoiceAdd({ root, pending, onBeforeStop }: {
  root: RefObject<HTMLElement | null>;
  pending: boolean;
  onBeforeStop(): void;
}) {
  const [canStop, setCanStop] = useState(false);
  const findStop = () => root.current?.querySelector<HTMLButtonElement>('button[aria-label="Stop and add text"]');
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const sync = () => { const stop = findStop(); setCanStop(Boolean(stop && !stop.disabled)); };
    const observer = new MutationObserver(sync);
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "disabled"] });
    sync();
    return () => observer.disconnect();
  }, [root]);
  return <button type="button" className="qr-add qr-native-voice-add" aria-label="Остановить и добавить цитату"
    disabled={pending || !canStop} onPointerDown={event => event.preventDefault()} onClick={() => {
      const stop = findStop();
      if (pending || !stop || stop.disabled) return;
      onBeforeStop();
      stop.click();
    }}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M15 18H9l-4 3v-5a8 8 0 1 1 15-4"/><path d="M18 14v8m-4-4h8"/></svg>
  </button>;
}
