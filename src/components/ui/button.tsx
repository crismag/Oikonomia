import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The Oikonomia button.
 *
 * Tuned to the language the application already speaks rather than to shadcn's
 * defaults: no shadows, 13px labels, compact padding, borders from
 * `--color-border`. Adopting the primitive should not have changed how a single
 * screen looks — it should only stop the next screen from inventing a fifth
 * size.
 *
 * `variant` carries meaning, not appearance:
 *
 * - `primary` — the one action the page exists for. At most one per view.
 * - `secondary` — ordinary actions sitting beside it.
 * - `ghost` — low-emphasis actions inside dense rows and toolbars.
 * - `destructive` — deletes and removals. Quiet until hovered; destructive
 *   actions should not shout for attention before they are wanted.
 * - `link` — navigation rendered as text.
 */
const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md",
    "font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
    "disabled:pointer-events-none disabled:text-disabled",
    "[&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  ),
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted",
        secondary: "border border-border bg-surface hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive: "text-muted-foreground hover:bg-status-overdue-soft hover:text-status-overdue",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        /* The application's ordinary control height. */
        default: "px-3 py-1.5 text-[13px]",
        sm: "px-2.5 py-1 text-[12px]",
        /* Square, for icon-only controls. Meets the 24px target minimum. */
        icon: "size-7",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Shows the control is working and blocks a second submit.
   *
   * A mutation that leaves its button looking idle invites a double save, so
   * anything that writes should pass this.
   */
  busy?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, busy, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || busy}
        {...(busy ? { "aria-busy": true } : {})}
        {...props}
      >
        {busy ? <Spinner /> : null}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";

/** Deliberately small and un-animated beyond a slow turn — a working control, not a light show. */
function Spinner() {
  return (
    <span
      aria-hidden
      className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none"
    />
  );
}

export { Button, buttonVariants };
