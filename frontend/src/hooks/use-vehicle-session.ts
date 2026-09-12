"use client";
import {useEffect,useMemo,useSyncExternalStore} from "react";
import type {Vehicle} from "@/lib/vehicles";
import {createVehicleSessionAdapter} from "@/lib/vehicle-session";

export function useVehicleSession(vehicle: Vehicle) {
  const adapter=useMemo(()=>createVehicleSessionAdapter(vehicle),[vehicle]);
  const snapshot=useSyncExternalStore(adapter.subscribe,adapter.getSnapshot,adapter.getServerSnapshot);
  useEffect(()=>{adapter.start();return ()=>adapter.dispose();},[adapter]);
  return {snapshot,adapter};
}
