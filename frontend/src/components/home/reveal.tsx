"use client";
import {useEffect, useRef, useState, type ElementType, type ReactNode} from "react";

// Adds data-visible once the element scrolls into view; CSS handles the motion.
// Content is visible without JavaScript and under reduced motion (see home.module.css).
export function useInView<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setVisible(true));
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, {threshold, rootMargin: "0px 0px -8% 0px"});
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, visible] as const;
}

export default function Reveal({as: Tag = "div", className, children, delay = 0, ...rest}: {
  as?: ElementType; className?: string; children: ReactNode; delay?: number; id?: string; "aria-label"?: string;
}) {
  const [ref, visible] = useInView<HTMLElement>(0.15);
  return (
    <Tag ref={ref} className={className} data-reveal="" data-visible={visible || undefined} style={delay ? {transitionDelay: `${delay}ms`} : undefined} {...rest}>
      {children}
    </Tag>
  );
}
