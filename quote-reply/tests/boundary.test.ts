// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { replyBottomBoundary } from "../selection-anchor";

it("uses the owning composer's top as the lower boundary instead of the screen edge", () => {
  document.body.innerHTML = '<section><div><span id="marker"></span></div><form data-promptbox></form></section><section><form data-promptbox></form></section>';
  const forms = document.querySelectorAll("form");
  vi.spyOn(forms[0], "getBoundingClientRect").mockReturnValue({ top: 600, bottom: 720, left: 20, right: 700, width: 680, height: 120, x: 20, y: 600, toJSON() {} });
  vi.spyOn(forms[1], "getBoundingClientRect").mockReturnValue({ top: 400, bottom: 520, left: 720, right: 1000, width: 280, height: 120, x: 720, y: 400, toJSON() {} });
  expect(replyBottomBoundary(document.getElementById("marker"), 800)).toBe(600);
  expect(replyBottomBoundary(null, 800)).toBe(800);
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
