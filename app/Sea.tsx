"use client";

import { useEffect, useRef } from "react";

/**
 * The authored motion of this page, and its whole argument.
 *
 * Scrolling is a hull crossing a night sea. Two kinds of light answer it:
 *
 *   plankton — ignited around the hull and by the cursor, burns a second or
 *              two, dies. This is what every other tool does with your
 *              document history.
 *   the wake — spreads behind the hull and is never erased. It cools from
 *              cyan to amber as it ages but stays lit all the way back to the
 *              top of the document. This is Hestia.
 *
 * The lane is biased to the right so the wake never sits under the reading
 * column, and a scrim keeps the left side quiet enough for text.
 *
 * ponytail: one canvas, one rAF, no deps.
 */

const HEAD_AT = 0.62; // where in the viewport the hull sits
const MAX_SPARKS = 1400;
const SEG_PX = 12; // the wake is stroked in short segments, each carrying its own age
const STRANDS = [
  { off: -1, w: 0.9, a: 0.22 },
  { off: -0.72, w: 1.1, a: 0.32 },
  { off: -0.4, w: 1.5, a: 0.55 },
  { off: 0, w: 2.4, a: 1 },
  { off: 0.4, w: 1.5, a: 0.55 },
  { off: 0.72, w: 1.1, a: 0.32 },
  { off: 1, w: 0.9, a: 0.22 },
];

type Spark = {
  x: number;
  y: number; // document space
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
};

/**
 * Lateral drift of the current, as a fraction of viewport width. Narrow
 * viewports pin the lane to the right edge so it never sits under the
 * reading column, which on a phone is the whole width.
 */
function laneAt(t: number, narrow: boolean) {
  const x =
    0.75 +
    0.18 * Math.sin(t * Math.PI * 4.2) +
    0.05 * Math.sin(t * Math.PI * 9.1 + 1.2);
  return narrow
    ? Math.min(0.99, Math.max(0.85, x + 0.22))
    : Math.min(0.94, Math.max(0.55, x));
}

/** A wake spreads as it ages, the way one does behind a real hull. */
function spreadAt(age: number) {
  return Math.min(330, Math.pow(Math.max(0, age), 0.7) * 2.7);
}

/**
 * Living cyan at the hull, cooling to amber that never goes out. The horizon
 * is short on purpose: the whole cyan-to-amber turn has to happen inside the
 * first viewport, or the page only asserts its thesis instead of showing it.
 */
function wakeInk(age: number) {
  const hot = Math.exp(-age / 165);
  const r = Math.round(hot * 40 + (1 - hot) * 208);
  const g = Math.round(229 * hot + (1 - hot) * 140);
  const b = Math.round(255 * hot + (1 - hot) * 54);
  const alpha = 0.26 + 0.68 * hot;
  return { rgb: `${r},${g},${b}`, alpha };
}

export default function Sea() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

    let w = 0;
    let h = 0;
    let docH = 1;
    let raf = 0;
    let running = true;

    const sparks: Spark[] = [];
    let pointer: { x: number; y: number } | null = null;
    const drift: { x: number; y: number; r: number; p: number; s: number }[] =
      [];

    /**
     * Abyss Film: the world's third material. A real noise tile, laid over
     * everything as grain, so the ground is water with depth rather than flat
     * black. Built once, reused every frame.
     */
    let film: CanvasPattern | null = null;
    function makeFilm() {
      const tile = document.createElement("canvas");
      tile.width = 128;
      tile.height = 128;
      const tctx = tile.getContext("2d");
      if (!tctx) return;
      const img = tctx.createImageData(128, 128);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random();
        // a cold grain, not a gray one
        img.data[i] = 40 + v * 90;
        img.data[i + 1] = 90 + v * 130;
        img.data[i + 2] = 120 + v * 135;
        img.data[i + 3] = v * v * 190;
      }
      tctx.putImageData(img, 0, 0);
      film = ctx!.createPattern(tile, "repeat");
    }

    function measure() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      docH = Math.max(document.documentElement.scrollHeight - h, 1);
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      drift.length = 0;
      const count = Math.round((w * h) / 3600);
      for (let i = 0; i < count; i++) {
        drift.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.4 + Math.random() * 1.3,
          p: Math.random() * Math.PI * 2,
          s: 0.15 + Math.random() * 0.45,
        });
      }
    }

    function ignite(x: number, y: number, n: number, reach: number) {
      for (let i = 0; i < n && sparks.length < MAX_SPARKS; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.pow(Math.random(), 0.55) * reach;
        const max = 1100 + Math.random() * 2400;
        sparks.push({
          x: x + Math.cos(a) * d,
          y: y + Math.sin(a) * d * 0.75,
          vx: Math.cos(a) * (0.1 + Math.random() * 0.55),
          vy: Math.sin(a) * (0.1 + Math.random() * 0.4) - 0.14,
          life: max,
          max,
          r: 0.5 + Math.random() * 1.9,
        });
      }
    }

    function draw(dt: number) {
      const scroll = window.scrollY;
      const span = docH + h * HEAD_AT;
      const headDoc = scroll + h * HEAD_AT;
      const headT = Math.min(1, Math.max(0, headDoc / span));
      const narrow = w < 900;
      const hx = laneAt(headT, narrow) * w;
      const hy = headDoc - scroll;

      // abyss
      ctx!.fillStyle = "#05070b";
      ctx!.fillRect(0, 0, w, h);
      const depth = ctx!.createLinearGradient(0, 0, 0, h);
      depth.addColorStop(0, "rgba(13,33,56,0.4)");
      depth.addColorStop(0.55, "rgba(8,18,34,0.15)");
      depth.addColorStop(1, "rgba(5,7,11,0)");
      ctx!.fillStyle = depth;
      ctx!.fillRect(0, 0, w, h);

      // ambient plankton, unlit until something disturbs them
      for (const d of drift) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(d.p));
        d.p += d.s * dt * 0.002;
        d.y -= d.s * dt * 0.006;
        if (d.y < -4) d.y = h + 4;
        // plankton near the hull are already glowing
        const near = Math.hypot(d.x - hx, d.y - hy);
        const lift = near < 520 ? Math.pow(1 - near / 520, 1.6) * 0.75 : 0;
        ctx!.beginPath();
        ctx!.arc(d.x, d.y, d.r * (1 + lift * 0.7), 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${Math.round(75 + lift * 130)},214,255,${
          0.1 + tw * 0.16 + lift * 0.55
        })`;
        ctx!.fill();
      }

      // ---- the wake: every strand behind the hull, still lit ----
      const startDoc = Math.max(0, scroll - 120);
      const endDoc = Math.min(headDoc, scroll + h + 120);

      ctx!.lineCap = "round";
      for (const s of STRANDS) {
        for (let d = startDoc; d < endDoc; d += SEG_PX) {
          const d2 = Math.min(d + SEG_PX, endDoc);
          const a1 = headDoc - d;
          const a2 = headDoc - d2;
          const ink = wakeInk(a1);
          const o1 = spreadAt(a1) * s.off;
          const o2 = spreadAt(a2) * s.off;
          ctx!.beginPath();
          ctx!.moveTo(laneAt(d / span, narrow) * w + o1, d - scroll);
          ctx!.lineTo(laneAt(d2 / span, narrow) * w + o2, d2 - scroll);
          ctx!.lineWidth = s.w;
          ctx!.strokeStyle = `rgba(${ink.rgb},${ink.alpha * s.a})`;
          ctx!.stroke();
          // the soft body of the wake
          ctx!.lineWidth = s.w * 7;
          ctx!.strokeStyle = `rgba(${ink.rgb},${ink.alpha * s.a * 0.075})`;
          ctx!.stroke();
        }
      }

      // ---- sparks: the sea's own light, which does go out ----
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.x += s.vx * dt * 0.05;
        s.y += s.vy * dt * 0.05;
        const k = s.life / s.max;
        const y = s.y - scroll;
        if (y < -30 || y > h + 30) continue;
        ctx!.beginPath();
        ctx!.arc(s.x, y, s.r * (0.35 + k * 0.95), 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${Math.round(150 * k)},${Math.round(
          198 + 57 * k,
        )},255,${k * 0.9})`;
        ctx!.fill();
      }

      // the hull's own light
      if (hy > -200 && hy < h + 200) {
        // on a phone the reading column is the whole width, so the hull burns
        // smaller and further off-frame rather than under the copy
        const reach = narrow
          ? Math.min(w, h) * 0.34
          : Math.max(300, Math.min(w, h) * 0.55);
        const halo = ctx!.createRadialGradient(hx, hy, 0, hx, hy, reach);
        halo.addColorStop(0, "rgba(214,248,255,0.9)");
        halo.addColorStop(0.05, "rgba(0,229,255,0.4)");
        halo.addColorStop(0.28, "rgba(0,150,255,0.11)");
        halo.addColorStop(1, "rgba(0,120,255,0)");
        ctx!.fillStyle = halo;
        ctx!.beginPath();
        ctx!.arc(hx, hy, reach, 0, Math.PI * 2);
        ctx!.fill();

        if (!calm.matches) ignite(hx, headDoc, 11, reach * 0.95);
      }

      if (pointer && !calm.matches) {
        ignite(pointer.x, pointer.y + scroll, 6, 40);
        pointer = null;
      }

      // ---- scrim: the reading column stays quiet ----
      const scrim = ctx!.createLinearGradient(0, 0, w, 0);
      if (!narrow) {
        scrim.addColorStop(0, "rgba(5,7,11,0.78)");
        scrim.addColorStop(0.42, "rgba(5,7,11,0.46)");
        scrim.addColorStop(0.78, "rgba(5,7,11,0)");
      } else {
        scrim.addColorStop(0, "rgba(5,7,11,0.84)");
        scrim.addColorStop(0.7, "rgba(5,7,11,0.72)");
        scrim.addColorStop(1, "rgba(5,7,11,0.52)");
      }
      ctx!.fillStyle = scrim;
      ctx!.fillRect(0, 0, w, h);

      // depth: the frame falls away at the edges
      const vig = ctx!.createRadialGradient(
        w * 0.62,
        h * 0.5,
        Math.min(w, h) * 0.2,
        w * 0.62,
        h * 0.5,
        Math.max(w, h) * 0.78,
      );
      vig.addColorStop(0, "rgba(5,7,11,0)");
      vig.addColorStop(1, "rgba(5,7,11,0.6)");
      ctx!.fillStyle = vig;
      ctx!.fillRect(0, 0, w, h);

      // Abyss Film over everything
      if (film) {
        ctx!.globalAlpha = 0.055;
        ctx!.fillStyle = film;
        ctx!.fillRect(0, 0, w, h);
        ctx!.globalAlpha = 1;
      }
    }

    let last = performance.now();
    function frame(now: number) {
      if (!running) return;
      const dt = Math.min(50, now - last);
      last = now;
      draw(dt);
      raf = requestAnimationFrame(frame);
    }

    function onPointer(e: PointerEvent) {
      pointer = { x: e.clientX, y: e.clientY };
    }
    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running && !calm.matches) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    }
    function onStatic() {
      draw(0);
    }
    function onResize() {
      measure();
      if (calm.matches) draw(0);
    }

    makeFilm();
    measure();
    if (calm.matches) {
      draw(0);
      window.addEventListener("scroll", onStatic, { passive: true });
    } else {
      raf = requestAnimationFrame(frame);
      window.addEventListener("pointermove", onPointer, { passive: true });
    }
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onStatic);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="sea" aria-hidden="true" />;
}
