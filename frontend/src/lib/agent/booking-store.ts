// What the driver did with the appointments the agent proposed, shared by every card that shows them
// (the agent panel and the robot's popup), so confirming in one place updates the other.
import type {Appointment} from "../backend/contract";

type State = {saved: Record<string, Appointment>; skipped: string[]};
let state: State = {saved: {}, skipped: []};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export const bookingStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {listeners.delete(listener);};
  },
  /** The proposal `pendingId` was confirmed and saved as `appointment`. */
  save(pendingId: string, appointment: Appointment) {
    state = {...state, saved: {...state.saved, [pendingId]: appointment}};
    emit();
  },
  /** "Not now": hide the proposal; a new proposal (another id) shows again. */
  skip(pendingId: string) {
    if (state.skipped.includes(pendingId)) return;
    state = {...state, skipped: [...state.skipped, pendingId]};
    emit();
  },
  reset() {
    state = {saved: {}, skipped: []};
    emit();
  },
};
