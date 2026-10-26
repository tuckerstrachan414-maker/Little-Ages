import { drawBubble } from "../render/sprites/people.ts";

/* Small helpers the panels share. */

export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

/** The little speech-bubble picture of an event, as in the news. */
export function eventIcon(bubble: number): HTMLCanvasElement {
  const c = el("canvas"); c.width = 15; c.height = 12; c.className = "ev-icon";
  drawBubble(c.getContext("2d")!, 7, 11, bubble, 1);
  return c;
}
