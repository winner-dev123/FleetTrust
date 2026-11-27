"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Scroll animations for the whole site, without a library:
 *
 * - Sections and cards below the fold fade up as they scroll into view (`.reveal` → `.is-in`).
 *   Content already on screen is never hidden, so pages don't flicker, and nothing is hidden
 *   without JavaScript.
 * - The header gets a shadow once the page scrolls (`.site-header.is-scrolled`).
 *
 * Every animation is short and runs once (WCAG 2.2.2). With "reduce motion" switched on,
 * nothing is hidden or moved.
 */
const TARGETS = [
  "[data-reveal]",
  ".card",
  ".feature-card",
  ".evidence-card",
  ".workspace-card",
  ".split-section > *",
  ".join-band__card",
  ".profile-aside",
  ".emergency-page__safety",
  ".prose",
].map((selector) => `main ${selector}`);

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Motion() {
  const pathname = usePathname();

  // Header shadow on scroll.
  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY > 8;
      document.querySelectorAll(".site-header").forEach((header) => {
        header.classList.toggle("is-scrolled", scrolled);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);

  // Reveal on scroll, again after each navigation and when content loads in. A position check
  // (not IntersectionObserver), so anything jumped past (End key, anchor links, a fast fling) is
  // shown too: an element is revealed once its top is above the bottom of the screen.
  useEffect(() => {
    if (reducedMotion()) return;

    let waiting: HTMLElement[] = [];

    const reveal = () => {
      const line = window.innerHeight * 0.92;
      waiting = waiting.filter((element) => {
        if (!element.isConnected) return false;
        if (element.getBoundingClientRect().top > line) return true;
        element.classList.add("is-in");
        return false;
      });
    };

    const scan = () => {
      const fold = window.innerHeight;
      document.querySelectorAll<HTMLElement>(TARGETS.join(",")).forEach((element) => {
        if (element.classList.contains("reveal")) return;
        // Nested targets (a card inside a revealed section) move with their parent.
        if (element.parentElement?.closest(".reveal")) return;
        element.classList.add("reveal");
        // Already on screen: shown at once, so the page never flickers.
        if (element.getBoundingClientRect().top < fold) {
          element.classList.add("is-in");
          return;
        }
        const siblings = element.parentElement ? [...element.parentElement.children] : [];
        const index = Math.max(0, siblings.indexOf(element));
        element.style.setProperty("--reveal-delay", `${String((index % 4) * 80)}ms`);
        waiting.push(element);
      });
      reveal();
    };

    // One pending frame per task, so a scroll never cancels a scan for new content.
    const frames: number[] = [];
    const schedule = (task: () => void) => {
      const slot = frames.push(0) - 1;
      return () => {
        window.cancelAnimationFrame(frames[slot] ?? 0);
        frames[slot] = window.requestAnimationFrame(task);
      };
    };
    const onScroll = schedule(reveal);
    const onChange = schedule(scan);

    scan();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    const mutations = new MutationObserver(onChange);
    const main = document.getElementById("main");
    if (main) mutations.observe(main, { childList: true, subtree: true });

    return () => {
      frames.forEach((id) => {
        window.cancelAnimationFrame(id);
      });
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      mutations.disconnect();
    };
  }, [pathname]);

  return null;
}
