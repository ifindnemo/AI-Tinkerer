# Vehicle motion preview

The local BMW model now retains four wheel pivots when merging geometry. Opaque meshes are batched by material within the body or each wheel, preserving the existing draw-call optimization. Wheel bounds supply centered pivots; rotation is around the normalized vehicle's transverse X axis. Brake calipers remain stationary.

Locally generated road dashes move opposite the vehicle's forward Z direction. Telemetry speed drives a smoothed, capped visual rate, not a calibrated physical speed: the workbook speed unit is still unknown. No sensor data or exported payload changes.

Motion is enabled by default and can be paused independently of telemetry and camera orbit. Zero speed, disconnection, or the OS reduced-motion preference stop the effect. Hidden documents skip rendering and elapsed time is capped to avoid catch-up jumps. Geometry and timers are cleaned up when the viewer unmounts.

Validation: `npm run lint`, `npm run build`, and `node scripts/verify-driving.mjs`. The browser check covers four wheel groups, movement, manual pause/resume, offline handling, reduced motion, mobile overflow, and browser errors.
