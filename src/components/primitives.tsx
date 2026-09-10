"use client";

/** Shared control primitives. Compact, industrial, no decorative chrome. */

import { useId, useState, type ReactNode } from "react";

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

/** Hover/focus tooltip. Used to explain every Sep Score heuristic. */
export function InfoTip({ text, children }: { text: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="Explain this score"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-ink-200 text-[9px] font-bold text-ink-400 hover:border-ink-400 hover:text-ink-600"
      >
        {children ?? "?"}
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute bottom-full right-0 z-50 mb-1.5 w-64 rounded border border-ink-200 bg-ink-900 px-2.5 py-2 text-[11px] leading-relaxed font-normal text-white shadow-lg"
        >
          {text}
        </span>
      ) : null}
    </span>
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
