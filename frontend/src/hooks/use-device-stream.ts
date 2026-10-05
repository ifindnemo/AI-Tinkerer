"use client";
import {useEffect, useMemo, useSyncExternalStore} from "react";
import {DeviceStream} from "@/lib/device/stream";

export function useDeviceStream(vehicleId: string) {
  const stream = useMemo(() => new DeviceStream(vehicleId), [vehicleId]);
  const state = useSyncExternalStore(stream.subscribe, stream.getSnapshot, stream.getServerSnapshot);
  useEffect(() => {stream.start(); return () => stream.dispose();}, [stream]);
  return state;
}
