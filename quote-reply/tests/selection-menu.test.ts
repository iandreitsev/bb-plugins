// @vitest-environment jsdom
import { expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { mountSelectionMenu } from "../selection-menu";

it("orders native buttons, renames only Add to chat and restores the menu on disable", async () => {
  document.body.innerHTML = '<div data-radix-popper-content-wrapper><div id="menu"><div><button><svg></svg>Add to chat</button></div><div><span aria-hidden="true"></span><button>Ответить</button></div><div><span aria-hidden="true"></span><button>Reply in side chat</button></div></div></div><button>Add to chat</button>';
  const menu = document.getElementById("menu")!;
  const quoteButton = menu.querySelector("button")!;
  let clicks = 0;
  quoteButton.addEventListener("click", () => clicks++);
  const labels = () => Array.from(menu.querySelectorAll("button"), button => button.textContent);
  const dispose = mountSelectionMenu();
  try {
    await waitFor(() => expect(Array.from(menu.children).sort((a,b)=>Number((a as HTMLElement).style.order)-Number((b as HTMLElement).style.order)).map(row=>row.textContent)).toEqual(["Ответить", "В боковой чат", "Цитировать"]));
    expect(menu.firstElementChild?.querySelector("button")).toBe(quoteButton);
    quoteButton.click();
    expect(clicks).toBe(1);
    expect(document.body.lastElementChild?.textContent).toBe("Add to chat");
    // React can refresh its text node; reapply the label without replacing the button.
    quoteButton.lastChild!.textContent = "Add to chat";
    await waitFor(() => expect(quoteButton.textContent).toBe("Цитировать"));
  } finally { dispose(); }
  expect(labels()).toEqual(["Add to chat", "Ответить", "Reply in side chat"]);
  expect(menu.hasAttribute("data-qr-selection-menu")).toBe(false);
  document.body.replaceChildren();
});
