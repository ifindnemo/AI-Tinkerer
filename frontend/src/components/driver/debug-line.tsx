"use client";
import {useEffect, useState} from "react";
import type {LiveChannel} from "@/lib/driver/live";
import styles from "./driver.module.css";

/**
 * `?debug=1`: raw, uncalibrated model values, for tuning thresholds on the real camera and car.
 * The JSON is also on `data-raw` for browser tests.
 */
export default function DebugLine({live}: {live: LiveChannel}) {
  const [enabled, setEnabled] = useState(false);
  const [raw, setRaw] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setEnabled(new URLSearchParams(window.location.search).get("debug") === "1"), 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const frame = live.get()?.sample.frame;
      setRaw(frame ? JSON.stringify({face: frame.facePresent, yaw: frame.yaw, pitch: frame.pitch, closure: frame.closure, confidence: frame.confidence}) : "");
    }, 200);
    return () => clearInterval(timer);
  }, [enabled, live]);
  if (!enabled) return null;
  return <p className={styles.fineprint} data-testid="driver-debug" data-raw={raw}>raw {raw || "—"}</p>;
}
