/*
  The interface's layout. The clock sits top left and the toolbar top right, with the button
  that hides the whole interface beside it. News sits bottom left and the minimap bottom
  right. The people and map-mode lists drop down under the toolbar, one at a time. Every
  panel slides out toward its own edge when it is toggled, and H hides the lot for a clean
  view of the world.
*/

export type Slide = "up" | "down" | "left" | "right" | "drop" | "fade";
export type Slot = "top-start" | "top-end" | "bottom-start" | "bottom-end" | "float";

export interface PanelOpts {
  slot: Slot;
  slide: Slide;
  /** the label of its toolbar button; a panel without one is always shown */
  label?: string;
  /** toolbar buttons appear in this order */
  order?: number;
  /** panels in one group close each other, so only one drops down at a time */
  group?: string;
  open?: boolean;
  onChange?: (open: boolean) => void;
}
interface Entry extends PanelOpts { el: HTMLElement; open: boolean; button?: HTMLButtonElement; }

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = ""): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

export class Dock {
  private readonly panels = new Map<string, Entry>();
  private readonly tools = make("div", "paper tools slide slide-up");
  private readonly uiToggle = make("button", "pbtn ui-toggle");
  private readonly slots: Record<Slot, HTMLElement>;
  private hidden = false;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    const top = make("div"), bottom = make("div"), topStart = make("div", "slot"), topEnd = make("div", "slot end");
    const bottomStart = make("div", "slot"), bottomEnd = make("div", "slot end");
    top.id = "hud-top"; bottom.id = "hud-bottom";
    top.append(topStart, topEnd); bottom.append(bottomStart, bottomEnd);
    topEnd.append(this.tools, this.uiToggle);
    root.append(top, bottom);
    this.slots = { "top-start": topStart, "top-end": topEnd, "bottom-start": bottomStart, "bottom-end": bottomEnd, float: root };
    this.tools.setAttribute("role", "toolbar"); this.tools.setAttribute("aria-label", "Panels");
    this.uiToggle.type = "button";
    this.uiToggle.onclick = () => this.setHidden(!this.hidden);
    /* a fresh world always starts with the interface shown */
    this.setHidden(false);
  }

  add(key: string, element: HTMLElement, o: PanelOpts): void {
    const entry: Entry = { ...o, el: element, open: o.open ?? true };
    element.classList.add("slide", `slide-${o.slide}`);
    element.dataset.panel = key;
    element.classList.toggle("off", !entry.open);
    this.slots[o.slot].append(element);
    if (o.label) {
      const b = make("button", "tool");
      b.type = "button"; b.textContent = o.label; b.dataset.panel = key;
      b.setAttribute("aria-pressed", String(entry.open));
      b.onclick = () => this.toggle(key);
      entry.button = b;
    }
    this.panels.set(key, entry);
    this.renderTools();
  }

  set(key: string, open: boolean): void {
    const p = this.panels.get(key);
    if (!p || p.open === open) return;
    if (open && p.group) for (const [k, q] of this.panels) if (k !== key && q.open && q.group === p.group) this.set(k, false);
    p.open = open;
    p.el.classList.toggle("off", !open);
    p.button?.setAttribute("aria-pressed", String(open));
    p.onChange?.(open);
    this.renderTools();
  }
  toggle(key: string): void { this.set(key, !this.panels.get(key)?.open); }
  isOpen(key: string): boolean { return !!this.panels.get(key)?.open; }

  get isHidden(): boolean { return this.hidden; }
  setHidden(on: boolean): void {
    this.hidden = on;
    this.root.classList.toggle("no-ui", on);
    this.uiToggle.textContent = on ? "SHOW UI" : "HIDE UI";
    this.uiToggle.title = on ? "Show the interface (H)" : "Hide the interface (H)";
  }

  private renderTools(): void {
    const buttons = [...this.panels.values()].filter(p => p.button).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(p => p.button!);
    this.tools.replaceChildren(...buttons);
  }
}
