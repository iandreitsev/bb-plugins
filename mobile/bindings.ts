import type { PluginComposerApi } from "@get-bb/plugin-sdk/app";

export interface ComposerBinding {
  marker: HTMLElement;
  composer: PluginComposerApi;
  key: string;
  threadId: string;
}
export const bindings = new Set<ComposerBinding>();
const listeners = new Set<() => void>();
export function subscribeBindings(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function bindComposer(marker: HTMLElement, composer: PluginComposerApi) {
  if (composer.scope.kind !== "thread") return () => {};
  const binding: ComposerBinding = { marker, composer, key: composer.key, threadId: composer.scope.threadId };
  bindings.add(binding);
  for (const listener of listeners) listener();
  return () => {
    bindings.delete(binding);
    for (const listener of listeners) listener();
  };
}
