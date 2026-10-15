// The agent voice's own mute, remembered in this browser only (a per-viewer convenience). The horn is a separate
// setting (the camera's sound switch); this one silences the spoken alerts and nothing else.
const MUTE_KEY = "car-neuron.agent-dock.v1";

export const muteStore = {
  listeners: new Set<() => void>(),
  read(): boolean {
    try {
      return JSON.parse(localStorage.getItem(MUTE_KEY) ?? "{}").muted === true;
    } catch {
      return false;
    }
  },
  set(muted: boolean) {
    try {
      localStorage.setItem(MUTE_KEY, JSON.stringify({muted}));
    } catch { /* storage may be blocked: the choice still holds for this page */ }
    muteStore.value = muted;
    muteStore.listeners.forEach(listener => listener());
  },
  value: null as boolean | null,
  get: () => (muteStore.value ??= muteStore.read()),
  subscribe(listener: () => void) {
    muteStore.listeners.add(listener);
    return () => {muteStore.listeners.delete(listener);};
  },
};
