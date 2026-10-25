import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "quiet" | "danger" | "ok";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500",
  ok: "bg-emerald-600 text-white hover:bg-emerald-500",
  danger: "bg-rose-600 text-white hover:bg-rose-500",
  quiet: "bg-white/5 text-slate-200 hover:bg-white/10 border border-white/10",
};

const SIZES = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-2 text-sm",
  lg: "px-5 py-3 text-base",
};

/** Rounded-full pill button; `busy` shows a spinner and disables it. Min 44px tall in plain mode via CSS. */
export function Button({ variant = "primary", size = "md", busy = false, icon, children, className = "", disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${FOCUS} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {busy ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden /> : icon}
      {children}
    </button>
  );
}
