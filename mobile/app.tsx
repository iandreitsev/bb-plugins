import { useLayoutEffect, useRef } from "react";
import { definePluginApp, useComposer } from "@get-bb/plugin-sdk/app";
import { mountMobile } from "./mobile";
import { bindComposer } from "./bindings";

function ComposerBinding() {
  const composer = useComposer();
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current) return bindComposer(ref.current, composer);
  }, [composer, composer.key]);
  return <span ref={ref} hidden data-bb-mobile-composer="" />;
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "mobile-quote-binding", scopes: ["thread"],
    banners: [{ id: "binding", chrome: "bare", component: ComposerBinding }],
  });
  app.contentScripts.register({ id: "mobile-selection", mount: mountMobile });
});
