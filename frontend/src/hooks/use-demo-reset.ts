"use client";
import {useEffect} from "react";
import {clearDemoState, withoutReset} from "@/lib/demo-reset";

/** Handles `?reset=1`: clears the demo's browser storage, then reloads without the parameter. */
export function useDemoReset() {
  useEffect(() => {
    const {search, pathname, hash} = window.location;
    if (new URLSearchParams(search).get("reset") !== "1") return;
    clearDemoState(localStorage);
    window.location.replace(withoutReset(search, pathname, hash));
  }, []);
}
