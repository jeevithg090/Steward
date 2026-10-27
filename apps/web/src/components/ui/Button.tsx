import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "@/lib/utils.ts";
import { Spinner } from "./Spinner.tsx";

/**
 * Every size is at least 44px tall (`min-h-target`), so each button is a comfortable target for a
 * finger or a shaky hand at any text size.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-field font-medium",
    "select-none text-center leading-tight no-underline",
    "transition-[background-color,color,box-shadow,opacity] duration-(--st-dur-tap) ease-out-soft",
    "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
    "[&_svg]:size-[1.125em] [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-on-accent hover:bg-accent-hover",
        secondary: "bg-card text-ink shadow-[inset_0_0_0_1px_var(--st-line)] hover:bg-tile",
        ghost: "text-ink hover:bg-tile",
        danger: "bg-problem text-on-problem hover:opacity-90",
        link: "min-h-0 px-0 text-accent underline underline-offset-4 hover:text-accent-hover",
      },
      size: {
        sm: "min-h-target px-3 text-sub",
        md: "min-h-target px-4 text-sub",
        lg: "min-h-12 px-6 text-body",
        icon: "size-target p-0",
      },
    },
    compoundVariants: [{ variant: "link", class: "min-h-0 px-0" }],
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends ComponentProps<"button">, ButtonVariantProps {
  /** Shows a spinner, disables the button and tells screen readers it is busy. */
  loading?: boolean;
  /** An icon drawn before the label. Hidden from screen readers. */
  icon?: ReactNode;
}

export function Button({
  variant,
  size,
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
}

export interface LinkButtonProps extends LinkProps, ButtonVariantProps {
  icon?: ReactNode;
}

/** A link that looks like a button: for navigation, so it opens in a new tab and reads as a link. */
export function LinkButton({ variant, size, icon, className, children, ...props }: LinkButtonProps) {
  return (
    <Link className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </Link>
  );
}
