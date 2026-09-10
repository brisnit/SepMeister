"use client";

/** Shared control primitives. Compact, industrial, no decorative chrome. */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{children}</span>
      {hint ? <span className="text-[11px] text-ink-400">{hint}</span> : null}
    </div>
  );
}

export function SegmentedControl<T extends string | number>({
  options, value, onChange, ariaLabel,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={o.disabled}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`ctl h-8 min-w-[44px] rounded px-2.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
            value === o.value ? "ctl-active" : ""
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({
  children, onClick, variant = "secondary", disabled, size = "md", type = "button", title, className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  const sizes = {
    sm: "h-7 px-2.5 text-[12px]",
    md: "h-9 px-3.5 text-[13px]",
    lg: "h-12 px-6 text-[15px]",
  };
  const variants = {
    primary:
      "border border-transparent bg-accent text-white shadow-sm hover:bg-accent-hover disabled:bg-ink-300 disabled:shadow-none",
    secondary: "ctl",
    ghost: "border border-transparent text-ink-600 hover:bg-ink-50 hover:text-ink-900",
    danger: "border border-transparent text-bad hover:bg-red-50",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Slider({
  label, value, min, max, step, onChange, format, hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12px] font-medium text-ink-600">{label}</label>
        <span className="tnum text-[12px] font-semibold text-ink-900">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint ? <p className="mt-1 text-[11px] leading-snug text-ink-400">{hint}</p> : null}
    </div>
  );
}

/** Distance from the viewport edge the tooltip will not cross, in px. */
const TIP_MARGIN = 8;
const TIP_WIDTH = 256;

/**
 * Hover/focus tooltip. Used to explain every Sep Score heuristic.
 *
 * Rendered into a portal rather than positioned inside its own container. The
 * panels these live in scroll, and a scrolling ancestor clips on *both* axes --
 * `overflow-y: auto` implies horizontal clipping too, so an absolutely
 * positioned tooltip gets its left edge sliced off against the panel wall.
 * A portal plus fixed coordinates escapes the clip entirely, and the position
 * is then clamped to the viewport so it stays readable near any edge.
 */
export function InfoTip({ text, children }: { text: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();

    // Prefer right-aligned to the trigger, then clamp into the viewport.
    let left = r.right - TIP_WIDTH;
    const maxLeft = window.innerWidth - TIP_WIDTH - TIP_MARGIN;
    if (left > maxLeft) left = maxLeft;
    if (left < TIP_MARGIN) left = TIP_MARGIN;

    // Flip below the trigger when there is not room above it.
    const below = r.top < 140;
    const top = below ? r.bottom + 6 : r.top - 6;

    setPos({ left, top, below });
  }, []);

  const show = useCallback(() => { place(); setOpen(true); }, [place]);
  const hide = useCallback(() => setOpen(false), []);

  // A tooltip anchored to a moving element must follow it or disappear.
  useEffect(() => {
    if (!open) return;
    const onChange = () => place();
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="Explain this score"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => (open ? hide() : show())}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-ink-200 text-[9px] font-bold text-ink-400 hover:border-ink-400 hover:text-ink-600"
      >
        {children ?? "?"}
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              style={{
                left: pos.left,
                top: pos.top,
                width: TIP_WIDTH,
                transform: pos.below ? undefined : "translateY(-100%)",
              }}
              className="pointer-events-none fixed z-[100] rounded border border-ink-700 bg-ink-900 px-2.5 py-2 text-[11px] font-normal leading-relaxed text-white shadow-xl"
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <Label hint={hint}>{label}</Label>
      {children}
    </div>
  );
}

/** Status pill: neutral by default, colored only to carry meaning. */
export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad" | "accent"; children: ReactNode }) {
  const tones = {
    neutral: "border-ink-200 bg-ink-50 text-ink-600",
    good: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    bad: "border-red-200 bg-red-50 text-red-800",
    accent: "border-accent-border bg-accent-soft text-accent",
  };
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${tones[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Indeterminate progress bar.
 *
 * Deliberately has no percentage: the engine reports which stage it is in but
 * cannot know how long the remaining stages will take, and inventing a
 * percentage would be a lie the artist might plan around.
 */
export function ProgressBar({ label }: { label: string }) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-medium text-ink-600">{label}</p>
      <div className="progress-sweep relative h-0.5 w-full overflow-hidden bg-ink-100" />
    </div>
  );
}

export function ScoreDial({ score, verdict }: { score: number; verdict: string }) {
  const tone = score >= 88 ? "text-good" : score >= 72 ? "text-warn" : "text-bad";
  return (
    <div className="flex items-baseline gap-2.5">
      <span className={`tnum text-[38px] font-bold leading-none tracking-tight ${tone}`}>{score}</span>
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500">{verdict}</span>
    </div>
  );
}
