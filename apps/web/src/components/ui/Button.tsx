import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "quiet" | "danger" | "ok" | "gold" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300";

// Every filled colour keeps white text at WCAG AA (4.5:1 or better) at rest and on hover.
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-b from-violet-600 to-violet-700 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.22)_inset,0_10px_28px_-12px_rgb(124_58_237/0.9)] hover:from-violet-500 hover:to-violet-700 hover:shadow-[0_1px_0_0_rgb(255_255_255/0.28)_inset,0_14px_34px_-12px_rgb(139_92_246/0.95)]",
  ok: "bg-gradient-to-b from-emerald-700 to-emerald-800 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.18)_inset,0_10px_26px_-12px_rgb(16_185_129/0.7)] hover:from-emerald-600 hover:to-emerald-800",
  danger: "bg-gradient-to-b from-rose-600 to-rose-700 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.18)_inset,0_10px_26px_-12px_rgb(244_63_94/0.7)] hover:from-rose-500 hover:to-rose-700",
  gold: "bg-gradient-to-b from-gold-300 to-gold-400 text-ink shadow-[0_1px_0_0_rgb(255_255_255/0.5)_inset,0_10px_28px_-12px_rgb(245_181_68/0.8)] hover:from-gold-200 hover:to-gold-300",
  quiet: "border border-white/10 bg-white/[0.05] text-slate-100 hover:border-white/20 hover:bg-white/[0.09]",
  ghost: "text-slate-300 hover:bg-white/[0.06] hover:text-white",
};

const SIZES = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

/** Rounded-full pill button; `busy` shows a spinner and disables it. Min 44px tall in plain mode via CSS. */
export function Button({ variant = "primary", size = "md", busy = false, icon, children, className = "", disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={`inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-[-0.005em] transition-[transform,background-color,box-shadow,border-color,color] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none motion-reduce:active:scale-100 ${FOCUS} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {busy ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : icon}
      {children}
    </button>
  );
}
