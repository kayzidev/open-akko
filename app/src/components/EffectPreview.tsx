// SPDX-FileCopyrightText: JR Lanteigne <root@dnim.dev>
// SPDX-License-Identifier: GPL-3.0-or-later
// The board picture lit by the effect the Lighting page holds, animated on
// the firmware's 5 ms tick. Paints straight into the DOM from a frame
// loop rather than through React state, so a 100-key picture at 60 fps
// costs one style write per key and no renders.

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { BoardLayout } from "@/lib/layout-loader";
import { FRAME_MS, colorAt, type EffectParam, type Family, type Led, type ReactiveHit } from "@/lib/effects";

export default function EffectPreview({
  layout,
  family,
  param,
}: {
  layout: BoardLayout;
  family: Family;
  param: EffectParam;
}) {
  const keys = useMemo(() => {
    if (!layout?.keys || !Array.isArray(layout.keys)) return [];
    return layout.keys.filter((k) => k?.type !== "knob");
  }, [layout]);
  const leds = useMemo<Led[]>(() => {
    if (!layout?.canvas?.width || !layout?.canvas?.height) return [];
    return keys.map((k) => {
      const width = Math.max(1, layout.canvas.width);
      const height = Math.max(1, layout.canvas.height);
      return {
        x: (k.x + k.w / 2) / width,
        y: (k.y + k.h / 2) / height,
      };
    });
  }, [keys, layout]);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const hits = useRef<ReactiveHit[]>([]);
  const frameRef = useRef(0);
  const forcePaint = useRef<() => void>(() => {});
  const paramRef = useRef(param);
  useEffect(() => {
    paramRef.current = param;
  }, [param]);
  const strike = useCallback((i: number) => {
    if (!paramRef.current || typeof paramRef.current.mode !== "number") return;
    if (![5, 8, 14].includes(paramRef.current.mode)) return;
    const led = leds[i];
    if (!led || typeof led.x !== "number" || typeof led.y !== "number") return;
    const now = frameRef.current;
    hits.current = [...hits.current.filter((h) => now - h.frame < 440), { ...led, frame: now }].slice(-32);
    forcePaint.current();
  }, [leds]);
  useEffect(() => {
    hits.current = [];
  }, [param?.mode]);

  useEffect(() => {
    if (!leds.length || !keys.length) return;
    const still =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paint = (frame: number) => {
      if (!paramRef.current || !Array.isArray(leds)) return;
      frameRef.current = frame;
      const p = { ...paramRef.current, hits: hits.current };
      for (let i = 0; i < leds.length; i++) {
        const el = refs.current[i];
        if (!el) continue;
        const led = leds[i];
        if (!led) continue;
        try {
          const [r, g, b] = colorAt(family, p, led, i, frame);
          el.style.background = `rgb(${r} ${g} ${b})`;
          el.style.boxShadow = `0 0 1.2cqw 0.3cqw rgb(${r} ${g} ${b} / 0.7)`;
        } catch {
          // Fail gracefully: leave the element as is.
        }
      }
    };
    forcePaint.current = () => paint(frameRef.current);
    const onKey = (event: KeyboardEvent) => {
      if (!Array.isArray(keys)) return;
      const i = keys.findIndex((k) => k?.code === event.code);
      if (i >= 0 && !event.repeat) strike(i);
    };
    window.addEventListener("keydown", onKey);
    if (still) {
      paint(0);
      return () => window.removeEventListener("keydown", onKey);
    }
    let handle = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (document.visibilityState === "visible") {
        const frame = Math.floor((now - start) / FRAME_MS);
        paint(frame);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
      window.removeEventListener("keydown", onKey);
    };
  }, [family, leds, keys, strike]);

  // Lights only: a soft glow where each LED sits, on a dark ground. No
  // caps, so it reads as the effect and not as something to paint.
  if (!layout?.canvas || !keys.length) return null;
  const canvasWidth = Math.max(1, layout.canvas.width);
  const canvasHeight = Math.max(1, layout.canvas.height);
  return (
    <div className="w-full" style={{ containerType: "inline-size" }}>
      <div className="mx-auto max-w-[920px] rounded-2xl bg-black p-[2.5%]">
        <div className="relative" style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}>
          {keys.map((k, i) => {
            if (!k) return null;
            return (
              <button
                type="button"
                aria-label={`Aperçu de la touche ${k.text ?? k.code}`}
                title="Cliquez pour essayer la réaction"
                onClick={() => strike(i)}
                key={`${k.code}-${k.matrixIndex ?? i}`}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className="absolute rounded-full"
                style={{
                  left: `${((k.x + k.w * 0.2) / canvasWidth) * 100}%`,
                  top: `${((k.y + k.h * 0.2) / canvasHeight) * 100}%`,
                  width: `${((k.w * 0.6) / canvasWidth) * 100}%`,
                  height: `${((k.h * 0.6) / canvasHeight) * 100}%`,
                  background: "#000",
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
