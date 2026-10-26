/* The camera: a center in tile coordinates and a zoom in screen pixels per tile. */

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Camera {
  x = 0; y = 0; z = 1;
  vw = 1; vh = 1;
  maxZ = 32;
  private fly: { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; t0: number; ms: number } | null = null;
  readonly worldW: number; readonly worldH: number;
  constructor(worldW: number, worldH: number) { this.worldW = worldW; this.worldH = worldH; this.x = worldW / 2; this.y = worldH / 2; }

  get minZ(): number { return Math.min(this.vw / this.worldW, this.vh / this.worldH) * 0.96; }
  resize(vw: number, vh: number): void { this.vw = vw; this.vh = vh; this.clamp(); }
  /** Start with the whole world in view; on a tall phone screen, fill the height instead. */
  fitWorld(): void { this.z = this.vh > this.vw ? Math.max(this.minZ, this.vh / this.worldH * 0.62) : this.minZ; this.x = this.worldW / 2; this.y = this.worldH / 2; this.clamp(); }

  clamp(): void {
    this.z = Math.max(this.minZ, Math.min(this.maxZ, this.z));
    const hw = this.vw / 2 / this.z, hh = this.vh / 2 / this.z;
    this.x = this.worldW <= hw * 2 ? this.worldW / 2 : Math.max(hw, Math.min(this.worldW - hw, this.x));
    this.y = this.worldH <= hh * 2 ? this.worldH / 2 : Math.max(hh, Math.min(this.worldH - hh, this.y));
  }
  toScreen(wx: number, wy: number): [number, number] { return [(wx - this.x) * this.z + this.vw / 2, (wy - this.y) * this.z + this.vh / 2]; }
  toWorld(sx: number, sy: number): [number, number] { return [(sx - this.vw / 2) / this.z + this.x, (sy - this.vh / 2) / this.z + this.y]; }
  /** Zoom keeping the world point under the cursor fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    this.fly = null;
    const [wx, wy] = this.toWorld(sx, sy);
    this.z = Math.max(this.minZ, Math.min(this.maxZ, this.z * factor));
    this.x = wx - (sx - this.vw / 2) / this.z; this.y = wy - (sy - this.vh / 2) / this.z;
    this.clamp();
  }
  pan(dx: number, dy: number): void { this.fly = null; this.x -= dx / this.z; this.y -= dy / this.z; this.clamp(); }
  flyTo(x: number, y: number, z: number, ms = 900): void { this.fly = { fx: this.x, fy: this.y, fz: this.z, tx: x, ty: y, tz: Math.max(this.minZ, Math.min(this.maxZ, z)), t0: performance.now(), ms }; }
  get flying(): boolean { return !!this.fly; }
  step(now: number): void {
    if (!this.fly) return;
    const f = this.fly, k = f.ms ? Math.min(1, (now - f.t0) / f.ms) : 1, e = easeInOut(k);
    /* zoom out a little mid-flight when travelling far, like a map app */
    const lz = Math.log(f.fz) + (Math.log(f.tz) - Math.log(f.fz)) * e;
    this.z = Math.exp(lz); this.x = f.fx + (f.tx - f.fx) * e; this.y = f.fy + (f.ty - f.fy) * e;
    if (k >= 1) this.fly = null;
    this.clamp();
  }
  visible(): { x0: number; y0: number; x1: number; y1: number } {
    const hw = this.vw / 2 / this.z, hh = this.vh / 2 / this.z;
    return { x0: Math.max(0, Math.floor(this.x - hw)), y0: Math.max(0, Math.floor(this.y - hh)), x1: Math.min(this.worldW, Math.ceil(this.x + hw)), y1: Math.min(this.worldH, Math.ceil(this.y + hh)) };
  }
}
