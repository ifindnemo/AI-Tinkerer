"use client";
import {useEffect} from "react";
import {clearDemoState, resetBackendState, withoutReset} from "@/lib/demo-reset";

/** Handles `?reset=1`: clears the demo's browser storage and the backend's memory of the last run, then reloads without the parameter. */
export function useDemoReset() {
  useEffect(() => {
    const {search, pathname, hash} = window.location;
    if (new URLSearchParams(search).get("reset") !== "1") return;
    clearDemoState(localStorage);
    // The backend reset comes first so the reloaded page's first batch finds it clean; a failure must not trap the page here.
    void resetBackendState((url, init) => fetch(url, init)).finally(() => window.location.replace(withoutReset(search, pathname, hash)));
  }, []);
}
