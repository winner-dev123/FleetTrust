import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

/** `danger` is reserved for emergency actions (design tokens: never marketing or upsell). */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface Look {
  variant?: ButtonVariant;
  block?: boolean;
  large?: boolean;
}

function classes({ variant = "primary", block, large }: Look, extra?: string): string {
  return ["btn", `btn--${variant}`, block && "btn--block", large && "btn--lg", extra]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  variant,
  block,
  large,
  className,
  type = "button",
  busy,
  children,
  ...rest
}: Look &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    /** Disables the button and tells assistive technology an action is in progress. */
    busy?: boolean;
    children: ReactNode;
  }) {
  return (
    <button
      {...rest}
      type={type}
      className={classes({ variant, block, large }, className)}
      disabled={rest.disabled === true || busy === true}
      aria-busy={busy === true ? true : undefined}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  block,
  large,
  className,
  ...rest
}: Look & ComponentProps<typeof Link>) {
  return <Link {...rest} className={classes({ variant, block, large }, className)} />;
}
