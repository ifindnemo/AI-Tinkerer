"use client";
import {useEffect,useMemo,useSyncExternalStore} from "react";
import type {Vehicle} from "@/lib/vehicles";
import type {AgentMode} from "@/lib/preferences";
import {createVehicleSessionAdapter} from "@/lib/vehicle-session";

export function useVehicleSession(vehicle: Vehicle, mode: Exclude<AgentMode, "device">) {
  const adapter=useMemo(()=>createVehicleSessionAdapter(vehicle,mode),[vehicle,mode]);
  const snapshot=useSyncExternalStore(adapter.subscribe,adapter.getSnapshot,adapter.getServerSnapshot);
  useEffect(()=>{adapter.start();return ()=>adapter.dispose();},[adapter]);
  return {snapshot,adapter};
}
