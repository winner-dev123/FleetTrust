import type { ReactNode } from "react";

/**
 * Full-width page banner from the Figma Make design (sub-pages): a soft gradient band with a
 * kicker, the page's h1 and an intro. "emergency" uses the warm emergency tone.
 */
export function PageHero({
  kicker,
  title,
  intro,
  tone = "default",
  children,
}: {
  kicker?: string;
  title: string;
  intro?: ReactNode;
  tone?: "default" | "emergency";
  children?: ReactNode;
}) {
  return (
    <section className={`page-hero page-hero--${tone}`} aria-label={title}>
      <div className="page-hero__inner">
        {kicker ? <p className="page-hero__kicker">{kicker}</p> : null}
        <h1>{title}</h1>
        {intro ? <div className="page-hero__intro">{intro}</div> : null}
        {children}
      </div>
    </section>
  );
}
