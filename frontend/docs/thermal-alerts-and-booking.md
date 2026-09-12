# Thermal alerts and confirmed garage planning

Thermal presentation now highlights the affected engine/cooling sensor markers on the local 3D model, corresponding temperature cards, and temperature rows in the blackbox table. Red includes an icon and descriptive label; warm conditions are amber. Missing/disconnected data is neutral. The marker glow follows the existing projected 3D sensor position; it is an illustrative overlay, not a segmented component diagnosis or thermal-camera reading.

`src/lib/thermal-status.ts` centralizes authored demo presentation rules. Combustion thresholds distinguish moderate warmth from high temperatures; the overheating demo's combined rising coolant and inactive fan also promote the affected temperature readings to red. Oil and coolant are evaluated separately. Voltage, fuel and unrelated operating readings are not colored red merely because a fault exists. Fault 1/2/3 and uncalibrated Excel values do not determine thermal severity. These display rules are not manufacturer limits and do not replace the backend risk engine.

On the user's request, garage planning is available during an incident, below the Safety Agent flow. A **Đặt lịch kiểm tra** shortcut focuses the planner from the health summary. The agent still owns the urgent intervention flow; the planner explains that a later inspection appointment does not replace that flow or rescue. This supersedes the earlier behavior that hid planning until resolution.

The booking workflow has three steps:

1. Select a fictional garage, ordered by relevant specialty.
2. Choose a local date and an illustrative time slot.
3. Review the exact vehicle, reason, garage and time; check the agreement box and explicitly press **Xác nhận lưu lịch demo**.

There is no persistence from selection, viewing a review or ticking the box alone. Entering review captures a separate assessment snapshot, so new packets and incident escalation cannot silently replace the approved reason. Editing clears consent and requires a new review. Cancelling an unfinished flow writes no booking. Offline/scenario identity changes reset the unfinished flow, while previously saved appointments remain visible.

Only the final confirmation handler writes a booking, using the reviewed snapshot. The existing storage decoder, appointment validation and duplicate checks remain active. Errors do not claim success. Saved bookings survive reload and may be cancelled; no external garage request is made, and the UI explicitly calls these browser-local demo appointments. Garage availability is not verified.

Keyboard focus follows step headings and the planner shortcut. Radio groups, date/time labels, a labelled consent checkbox and a current-step indicator support keyboard and screen-reader use. Layouts adapt for mobile; no flashing effect is used for red alerts.

Validation: `npm test`, `npm run lint`, `npm run build`, `node scripts/verify-thermal-booking.mjs`, `node scripts/verify-live-dashboard.mjs`, `node scripts/verify-agent-ui.mjs`.
