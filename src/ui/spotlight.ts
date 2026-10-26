import type { ChronicleEvent } from "../shared/people.ts";
import { Bubble } from "../shared/people.ts";
import { frameURL } from "./hud.ts";
import { dateText } from "./history.ts";
import { Director } from "./director.ts";
import type { Dock } from "./dock.ts";
import { el, esc, eventIcon } from "./dom.ts";

/*
  The Story Spotlight. Switch it on and the camera goes looking for you: it flies to the most
  worthwhile thing happening, pins the people in it, and stays long enough to follow it. For the
  heaviest moments it slows the clock so you can watch them play out. When nothing much is
  happening it follows someone through their day instead. It only ever picks from what people
  have actually done. Pan, zoom or click and it politely waits.
*/

export interface SpotlightCallbacks {
  /** Fly to this event and pin whoever was in it. */
  show: (e: ChronicleEvent) => void;
  /** Nothing is happening: find someone worth following. Returns a caption, or null if there is no one. */
  wander: () => string | null;
  /** Slow the clock for a big moment (true) or put it back (false). */
  slow: (on: boolean) => void;
  onChange: (on: boolean) => void;
}

const DWELL = 10_000, DWELL_BIG = 14_000, IDLE_AFTER = 22_000, HOLD = 12_000;

export class Spotlight {
  readonly el: HTMLElement;
  readonly director = new Director();
  on = false;
  private current: ChronicleEvent | null = null;
  private shownAt = 0;
  private dwell = DWELL;
  private holdUntil = 0;
  private slowed = false;
  private bar: HTMLElement;
  private body: HTMLElement;
  private readonly cb: SpotlightCallbacks;
  private readonly dock: Dock;

  constructor(dock: Dock, cb: SpotlightCallbacks) {
    this.cb = cb; this.dock = dock;
    this.el = el("div", "paper"); this.el.id = "hud-spot";
    this.el.style.borderImageSource = `url(${frameURL()})`;
    this.el.innerHTML = `<div class="sp-head"><span class="sp-tag">SPOTLIGHT</span><span class="sp-btns"><button type="button" data-a="next" class="pbtn" title="Skip to the next story (N)">NEXT</button><button type="button" data-a="off" class="pbtn" title="Stop (L)">STOP</button></span></div><div class="sp-body"></div><div class="sp-bar" aria-hidden="true"><i></i></div>`;
    this.body = this.el.querySelector(".sp-body")!;
    this.bar = this.el.querySelector(".sp-bar i")!;
    this.el.querySelector<HTMLButtonElement>('[data-a="next"]')!.onclick = () => this.skip();
    this.el.querySelector<HTMLButtonElement>('[data-a="off"]')!.onclick = () => this.set(false);
    dock.add("spotlight", this.el, { slot: "float", slide: "down", label: "SPOTLIGHT", open: false, order: 8, onChange: on => { if (on !== this.on) this.set(on); } });
    this.say(null, "The Spotlight looks for the story of the moment.");
  }

  set(on: boolean): void {
    if (on === this.on) { this.dock.set("spotlight", on); return; }
    this.on = on; this.dock.set("spotlight", on);
    if (!on) { this.leave(); this.current = null; }
    else { this.shownAt = -1e9; this.holdUntil = 0; }
    this.cb.onChange(on);
  }
  toggle(): void { this.set(!this.on); }

  /** Events as they arrive. */
  offer(evs: ChronicleEvent[], real: number): void { if (this.on) for (const e of evs) this.director.offer(e, real); }
  /** The player took the camera; wait a while before taking it back. */
  userActed(real: number): void { if (this.on) this.holdUntil = real + HOLD; }

  skip(): void { this.shownAt = -1e9; this.holdUntil = 0; }

  /** Every frame. */
  frame(real: number): void {
    if (!this.on) return;
    const since = real - this.shownAt;
    this.bar.style.width = `${Math.max(0, Math.min(100, (1 - since / this.dwell) * 100))}%`;
    this.el.classList.toggle("held", real < this.holdUntil);
    if (real < this.holdUntil || since < this.dwell) return;
    const e = this.director.next(real);
    if (e) {
      this.leave();
      this.current = e; this.shownAt = real; this.dwell = e.sig >= 0.7 ? DWELL_BIG : DWELL;
      this.say(e);
      this.cb.show(e);
      if (e.sig >= 0.65) { this.slowed = true; this.cb.slow(true); }
    } else if (since > IDLE_AFTER || since > this.dwell && !this.current) {
      this.leave();
      const caption = this.cb.wander();
      this.current = null; this.shownAt = real; this.dwell = DWELL;
      this.say(null, caption ?? "Waiting for something to happen.");
    }
  }
  private leave(): void { if (this.slowed) { this.slowed = false; this.cb.slow(false); } }

  private say(e: ChronicleEvent | null, text = ""): void {
    this.body.replaceChildren();
    if (e) {
      this.body.append(eventIcon(e.icon || Bubble.Sun));
      this.body.append(el("span", "", `<b>${esc(e.title)}</b><small>${esc(dateText(e.t))}</small><span>${esc(e.text)}</span>`));
    } else this.body.append(el("span", "", `<span>${esc(text)}</span>`));
  }
}
