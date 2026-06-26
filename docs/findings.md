# MRBD Field Checklist Findings

This document is a living build log. It should be updated after desktop and on-device testing.

## Problems faced

- Official web docs may require login. The first implementation uses the provided requirements and the public Meta Wearables Web App toolkit guidance.
- The app now loads its default checklist from `data/sample-instructions.json` through `fetch`, then validates and caches it.
- A production server endpoint is not wired as the default yet, but `?source=server&serverUrl=...` exercises the same validation and cache path.
- Sensor permissions differ by browser and device. The app handles denied or unavailable compass/location by showing explicit unavailable states.

## Known bugs and limitations

- Compass heading is not validated on real Meta Ray-Ban Display hardware yet.
- GPS altitude is not validated on real glasses/paired phone yet. The app expects `altitude` to often be `null` and displays `ALT --`.
- Inverted swipe settings are not auto-detected. The app uses Meta's documented arrow-key parity mapping.
- The app has no service worker yet. Checklist data is cached in `localStorage`; full app shell offline caching can be added later.
- Opening the app directly with `file://` is not the preferred path because fetching local JSON may be blocked by browser policy. Use a local static server for desktop testing.

## Best practices used

- Single global `keydown` handler; no DOM focus dependency.
- Explicit state machine states: `LOADING`, `EMPTY`, `CHECKLIST`, `DETAIL`, `COMPLETION`.
- Data validation before rendering.
- Default data flow uses `fetch` against a JSON file, which mirrors the future server path more closely than an in-code object.
- Progress and checklist cache are separate `localStorage` entries.
- Sensor-driven HUD updates are throttled through `requestAnimationFrame`.
- A `?debug=1` overlay exposes state and sensor status for on-device diagnosis.
- A `?mockSensors=1` mode supports desktop testing without hardware sensors.

## Sensor reality to measure on device

Record these during MRBD testing:

- Compass permission flow and whether `webkitCompassHeading` or `alpha` is populated.
- Heading update rate and jitter.
- Whether `DeviceOrientationEvent.requestPermission()` requires a user gesture.
- Geolocation permission behavior inside the MRBD host.
- GPS altitude availability indoors and outdoors.
- Altitude accuracy values when available.

## Recommendations

- Test on real glasses as early as possible because the riskiest behavior is platform-specific.
- Add a service worker after the checklist and sensor behavior are stable.
- Add a small diagnostics screen or exportable log if on-device debugging is limited.
- Consider an owner-facing config file once the server endpoint is known.
