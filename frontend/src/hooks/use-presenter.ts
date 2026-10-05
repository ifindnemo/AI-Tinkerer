"use client";
import {useEffect, useState} from "react";

/** `?presenter=1` hides developer controls (data-source switch, simulation buttons) for demos. */
export function usePresenter() {
  const [presenter, setPresenter] = useState(false);
  useEffect(() => {
    // Read after hydration so the server HTML stays identical.
    const timer = setTimeout(() => setPresenter(new URLSearchParams(window.location.search).get("presenter") === "1"), 0);
    return () => clearTimeout(timer);
  }, []);
  return presenter;
}
