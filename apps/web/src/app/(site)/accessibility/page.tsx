import type { Metadata } from "next";

export const metadata: Metadata = { title: "Accessibility" };

/** Accessibility statement (WCAG 2.2 AA is the target; known gaps are listed honestly). */
export default function AccessibilityPage() {
  return (
    <div className="container container--readable stack">
      <h1>Accessibility</h1>
      <p>
        We want everyone to be able to use FleetTrust, including people who use screen readers,
        keyboards, voice control, magnification or high-contrast settings.
      </p>
      <h2>What we aim for</h2>
      <ul>
        <li>Web Content Accessibility Guidelines (WCAG) 2.2, level AA.</li>
        <li>Every page works with a keyboard alone, with a visible focus indicator.</li>
        <li>Text and controls meet AA colour contrast in light and dark themes.</li>
        <li>Pages work from 320 pixels wide and when zoomed to 400%.</li>
        <li>
          Status never depends on colour alone: labels say &quot;verified&quot; or &quot;not
          verified&quot;.
        </li>
        <li>Maps repeat information shown in a list, so nothing depends on seeing the map.</li>
        <li>Animations stop when your device asks for reduced motion.</li>
      </ul>
      <h2>How we check</h2>
      <p>
        Automated accessibility checks (axe) run on every change for each page, on a large screen
        and a 320-pixel phone screen, alongside keyboard and screen-size tests. Automated checks
        don&apos;t find everything, so we welcome reports from people who use assistive technology.
      </p>
      <h2>Known limitations</h2>
      <ul>
        <li>Map backgrounds come from a map provider and may not meet contrast requirements.</li>
        <li>Content written by members (articles, comments) may lack image descriptions.</li>
      </ul>
      <h2>Tell us about a problem</h2>
      <p>
        If something doesn&apos;t work for you, please tell us which page and what happened. A
        support contact will be listed here before launch.
      </p>
    </div>
  );
}
