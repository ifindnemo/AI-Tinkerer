# Car Neuron · 90-second intro film

Updated 11 October 2026. `/film` plays a real MP4 derived from the original 60-second HyperFrames composition in `brag-output/composition`. It keeps the vehicle story and adds three driver-camera shots, then closes with “Hiểu xe. Hiểu người lái.” The original 60-second MP4 is preserved; a source backup is in `brag-output/archive-60s`.

The camera section uses a line-drawn illustration rather than recorded personal footage. It follows the module's 1.5-second warning and 2.5-second critical closure thresholds, retains the alert after reopening, and shows that only structured events reach the agent. The film is a scenario illustration, not live telemetry or a claim that its thermal thresholds apply to every car.

## Deliverables

- `frontend/public/film/car-neuron-90s.mp4`: H.264 + AAC, 1920 × 1080, 30 fps, exactly 90 seconds, approximately 42 MB, fast-start metadata.
- `frontend/public/film/car-neuron-poster.webp`: local poster extracted from the rendered video.
- `frontend/public/film/car-neuron-{vi,en}.vtt`: Vietnamese captions / English translation. English subtitles turn on when the site language is English; native controls let viewers choose.
- [car-neuron-film-source.zip](car-neuron-film-source.zip): complete editable HTML composition, local images/fonts/music/SFX/GSAP and pinned render scripts. This tracked archive preserves the source even though `brag-output/` is gitignored.

The player starts paused so a click can play with sound. `?t=71.7` opens paused on the camera alert; `?clean` hides the site interface and has a touch-accessible exit. Explicit `?autoplay=1` plays muted unless reduced motion is requested. Native controls handle sound, seek, playback speed and subtitles. The page adds eight chapter buttons, keyboard shortcuts (Space/K, arrows, 1–8, F, C), a transcript, download and links to both demos. Chapter highlighting reads the video's actual playback time.

## Re-render locally

Unzip the source archive, enter `car-neuron-film`, use Node.js 22 or newer and FFmpeg, then:

```bash
npm run check
npm run render -- --quality delivery --output car-neuron-90s.mp4
```

The composition pin was updated from HyperFrames `0.8.119` to `0.8.146` and verified before rendering. All render assets are local. Changes must pass the complete check and be inspected at transition boundaries; update chapter metadata, VTT timings and the poster if timings change. A frontend dependency on HyperFrames is not needed.

## Validation

- Full composition check: no errors in lint/runtime/layout/motion/contrast. Remaining structural warnings concern the existing monolithic scene arrangement; masked text-reveal and old brand-transition warnings were reviewed visually.
- Camera snapshots: attentive, head turning, closure counter, critical alert, retained alert, privacy flow and closing frame.
- Render: 2,700 frames, 90-second video and audio, fast-start `moov` before media data. Audio peak is −4.7 dBFS; the music fades at the end.
- Browser regression: native MP4 load/play/pause/seek, camera/privacy chapter links, VI/EN subtitles without rewinding, clean mode, reduced-motion autoplay, 320–1440 px layouts, download/range requests, fullscreen, error recovery and metadata loading before hydration. Shared navigation regression passed. Frontend lint, production build and 95 unit tests passed.

BMW M2 artwork: Outlaw Games™ (CC BY-NC 4.0). Music: Sascha Ende, ende.app (CC BY 4.0). Credits remain in the final shot and on the page; no affiliation with BMW is implied. Camera prototype: no vehicle control, no emergency calls, no automotive safety certification.
