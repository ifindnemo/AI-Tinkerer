# Car Neuron

Car Neuron is a vehicle health dashboard featuring an interactive local 3D car, simulated blackbox telemetry, and an AI agent for explaining vehicle alerts and suggesting next steps.

Built with Next.js, React, TypeScript, and Three.js, the frontend sends 15 sensor readings to a Python backend every 15 seconds. Agent assessments appear on the dashboard, with user confirmation required before creating a Google Calendar appointment or saving a reminder.

Sensor data is simulated. Agent analysis and database actions use the connected backend. See [local setup and API integration](docs/backend-mvp-integration.md).
