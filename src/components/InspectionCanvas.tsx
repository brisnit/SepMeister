"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PIXEL_PRESERVING_SCALE, ZOOM_STOPS, centered, clampScale, constrainPan,
  fitViewport, fitWidthScale, stepZoom, toArtwork, withinArtwork, zoomAbout, zoomLabel,
  type Viewport,
} from "@/lib/ui/viewport";
import { Button } from "./primitives";

export type LoupePower = 4 | 8 | 16;

/**
 * The inspection surface.
 *
 * Everything here is read-only. Zoom, pan and the loupe change how the pixels
 * are presented and never touch a mask — a separator has to be able to look
 * closely without wondering whether looking changed anything.
 *
 * At high magnification rendering switches to nearest-neighbour. Smoothing
 * would interpolate between samples, which is precisely the wrong thing when
 * the point of looking is to see the actual mask edge or halftone dot.
 */
export function InspectionCanvas({
  rgba, width, height, checkered, alt, loupe, loupePower,
  onHover, onLeave, footer,
}: {
  rgba: Uint8ClampedArray | null;
  width: number;
  height: number;
  checkered?: boolean;
  alt: string;
  loupe: boolean;
  loupePower: LoupePower;
  /** Artwork coordinates under the cursor, or null when outside. */
  onHover?: (point: { x: number; y: number } | null) => void;
  onLeave?: () => void;
  footer?: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  /** The decoded artwork, kept off-DOM as the source for both canvases. */
  const sourceRef = useRef<HTMLCanvasElement | null>(null);

  const [view, setView] = useState<Viewport>({ scale: 1, x: 0, y: 0 });
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panOrigin = useRef<{ x: number; y: number; view: Viewport } | null>(null);
  const hasFitted = useRef(false);

  // ---- Source bitmap ---------------------------------------------------
  useEffect(() => {
    if (!rgba || width <= 0 || height <= 0 || rgba.length < width * height * 4) {
      sourceRef.current = null;
      return;
    }
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    sourceRef.current = c;
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rgba, width, height]);

  // ---- Container size --------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setContainer({ width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit once when the artwork and container are both known. Re-fitting on
  // every change would yank the view out from under someone mid-inspection.
  useEffect(() => {
    if (hasFitted.current) return;
    if (container.width < 8 || width <= 0) return;
    setView(fitViewport({ width, height }, container));
    hasFitted.current = true;
  }, [container, width, height]);

  // A new image of a different size is a new subject; refit for it.
  useEffect(() => { hasFitted.current = false; }, [width, height]);

  // ---- Drawing ---------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const src = sourceRef.current;
    if (!canvas || !src) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(container.width));
    const ch = Math.max(1, Math.round(container.height));
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
    }
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // Past ~2x, show the samples themselves rather than an interpolation.
    ctx.imageSmoothingEnabled = view.scale < PIXEL_PRESERVING_SCALE;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(src, view.x, view.y, width * view.scale, height * view.scale);

    // A hairline boundary, so the edge of the artboard is unambiguous when the
    // artwork itself is white at the edge.
    ctx.strokeStyle = "rgba(22,22,46,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(view.x + 0.5, view.y + 0.5, width * view.scale - 1, height * view.scale - 1);
  }, [view, container, width, height]);

  useEffect(() => { draw(); }, [draw]);

  // ---- Loupe -----------------------------------------------------------
  useEffect(() => {
    const canvas = loupeRef.current;
    const src = sourceRef.current;
    if (!canvas || !src || !loupe || !cursor) return;

    const dpr = window.devicePixelRatio || 1;
    const SIZE = 168;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Checkerboard behind, so transparency is legible under the loupe.
    ctx.fillStyle = "#f4f4f9";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = "#e8e8f0";
    for (let y = 0; y < SIZE; y += 8) {
      for (let x = 0; x < SIZE; x += 8) {
        if (((x / 8) + (y / 8)) % 2 === 0) ctx.fillRect(x, y, 8, 8);
      }
    }

    // Always nearest-neighbour: a loupe exists to show individual samples.
    ctx.imageSmoothingEnabled = false;
    const span = SIZE / loupePower;
    ctx.drawImage(
      src,
      cursor.x - span / 2, cursor.y - span / 2, span, span,
      0, 0, SIZE, SIZE,
    );

    // Crosshair on the sampled pixel.
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, 0); ctx.lineTo(SIZE / 2, SIZE);
    ctx.moveTo(0, SIZE / 2); ctx.lineTo(SIZE, SIZE / 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeRect(SIZE / 2 - loupePower / 2, SIZE / 2 - loupePower / 2, loupePower, loupePower);
  }, [cursor, loupe, loupePower, view.scale]);

  // ---- Interaction -----------------------------------------------------
  const pointFromEvent = useCallback((e: { clientX: number; clientY: number }) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const focus = pointFromEvent(e);
    // Trackpad pinch arrives as a wheel event with ctrlKey set.
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
    setView((v) => constrainPan(zoomAbout(v, focus, v.scale * factor), { width, height }, container));
  }, [pointFromEvent, width, height, container]);

  // Registered natively because React's onWheel is passive and cannot
  // preventDefault, which would let the page scroll while zooming.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const focus = { x: e.clientX - r.left, y: e.clientY - r.top };
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
      setView((v) => constrainPan(zoomAbout(v, focus, v.scale * factor), { width, height }, container));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [width, height, container]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target)) { e.preventDefault(); setSpaceHeld(true); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const beginPan = (e: React.PointerEvent) => {
    // Middle button or spacebar pans; left-drag pans too, since there is no
    // selection tool competing for it on an inspection surface.
    panOrigin.current = { ...pointFromEvent(e), view };
    setPanning(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointFromEvent(e);
    if (panning && panOrigin.current) {
      const o = panOrigin.current;
      setView(constrainPan(
        { scale: o.view.scale, x: o.view.x + (p.x - o.x), y: o.view.y + (p.y - o.y) },
        { width, height }, container,
      ));
      return;
    }
    const art = toArtwork(view, p);
    if (withinArtwork({ width, height }, art)) {
      const rounded = { x: Math.floor(art.x), y: Math.floor(art.y) };
      setCursor(rounded);
      onHover?.(rounded);
    } else {
      setCursor(null);
      onHover?.(null);
    }
  };

  const endPan = (e: React.PointerEvent) => {
    setPanning(false);
    panOrigin.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const setScale = useCallback((scale: number) => {
    const focus = { x: container.width / 2, y: container.height / 2 };
    setView((v) => constrainPan(zoomAbout(v, focus, scale), { width, height }, container));
  }, [container, width, height]);

  const fit = useCallback(() => setView(fitViewport({ width, height }, container)), [width, height, container]);
  const fitWidth = useCallback(
    () => setView(centered({ width, height }, container, fitWidthScale({ width, height }, container))),
    [width, height, container],
  );

  const cursorStyle = panning ? "grabbing" : spaceHeld ? "grab" : loupe ? "crosshair" : "grab";
  const nearest = view.scale >= PIXEL_PRESERVING_SCALE;

  const loupePlacement = useMemo(() => {
    if (!cursor) return { left: 0, top: 0 };
    const p = { x: cursor.x * view.scale + view.x, y: cursor.y * view.scale + view.y };
    // Flip the loupe away from the edges so it never leaves the viewport.
    const left = p.x + 190 > container.width ? p.x - 182 : p.x + 22;
    const top = p.y + 190 > container.height ? p.y - 182 : p.y + 22;
    return { left: Math.max(6, left), top: Math.max(6, top) };
  }, [cursor, view, container]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-ink-100 bg-surface px-3 py-1.5">
        <Button size="sm" onClick={() => setScale(stepZoom(view.scale, -1))} title="Zoom out">−</Button>
        <span className="tnum w-14 text-center text-[12px] font-semibold text-ink-800">{zoomLabel(view.scale)}</span>
        <Button size="sm" onClick={() => setScale(stepZoom(view.scale, 1))} title="Zoom in">+</Button>

        <div className="mx-1 h-4 w-px bg-ink-100" />

        {ZOOM_STOPS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={Math.abs(view.scale - s) < 0.001}
            onClick={() => setScale(s)}
            className={`ctl h-6 rounded px-1.5 text-[11px] font-medium ${
              Math.abs(view.scale - s) < 0.001 ? "ctl-active" : ""
            }`}
          >
            {zoomLabel(s)}
          </button>
        ))}

        <div className="mx-1 h-4 w-px bg-ink-100" />
        <Button size="sm" onClick={fit}>Fit art</Button>
        <Button size="sm" onClick={fitWidth}>Fit width</Button>
        <Button size="sm" onClick={() => setScale(1)}>100%</Button>

        {nearest ? (
          <span className="ml-auto text-[10px] uppercase tracking-[0.06em] text-ink-400">
            Pixel-preserving
          </span>
        ) : null}
      </div>

      <div
        ref={containerRef}
        role="img"
        aria-label={alt}
        onPointerDown={beginPan}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onPointerLeave={() => { setCursor(null); onHover?.(null); onLeave?.(); }}
        onDoubleClick={(e) => {
          const focus = pointFromEvent(e);
          setView((v) => constrainPan(
            zoomAbout(v, focus, e.altKey ? stepZoom(v.scale, -1) : stepZoom(v.scale, 1)),
            { width, height }, container,
          ));
        }}
        onWheel={onWheel}
        className={`relative min-h-0 flex-1 touch-none overflow-hidden ${checkered ? "checkerboard" : "bg-surface-sunken"}`}
        style={{ cursor: cursorStyle }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block" />

        {loupe && cursor ? (
          <div
            className="pointer-events-none absolute z-20 overflow-hidden rounded-md border-2 border-ink-900 shadow-xl"
            style={{ left: loupePlacement.left, top: loupePlacement.top, width: 168, height: 168 }}
          >
            <canvas ref={loupeRef} style={{ width: 168, height: 168 }} className="block" />
            <span className="absolute bottom-0 right-0 bg-ink-900/85 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {loupePower}×
            </span>
          </div>
        ) : null}

        {cursor ? (
          <span className="tnum pointer-events-none absolute bottom-1.5 left-2 rounded bg-ink-900/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {cursor.x}, {cursor.y}
          </span>
        ) : null}
      </div>

      {footer}
    </div>
  );
}

/** Avoids stealing the spacebar while someone is typing a job name. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
