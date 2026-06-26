# MRBD Field Checklist Web App

Standalone HTML/CSS/JavaScript web app for Meta Ray-Ban Display checklist testing.

## Current scope

- Vanilla static app, no build step.
- 600 x 600 HUD layout.
- Keyboard parity input:
  - `ArrowLeft`: previous item
  - `ArrowRight`: next item
  - `ArrowUp`: show details
  - `ArrowDown`: hide details
  - `Enter`: toggle step or restart after completion
- Instructions load from `data/sample-instructions.json` by default.
- An embedded mock remains available for explicit debug fallback.
- Compass and altitude support real browser APIs when available, and mock sensors via query flag.

## Run locally

From this directory:

```bash
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080/
```

For deterministic desktop testing:

```text
http://localhost:8080/?debug=1&mockSensors=1&reset=1
```

Set the browser viewport to `600 x 600` and test with arrow keys plus `Enter`.

## Debug flags

- `?debug=1`: shows state, index, checked count, data source, heading, and altitude.
- `?mockSensors=1`: simulates compass heading and altitude.
- `?reset=1`: clears cached instructions and progress.
- `?source=local-json`: loads from `data/sample-instructions.json` through `fetch` (default).
- `?localUrl=data/sample-instructions.json`: changes the local JSON URL.
- `?source=mock`: uses the embedded checklist directly.
- `?source=server&serverUrl=https://example.com/instructions.json`: uses the server-first path.
- `?mockFetchFail=1`: forces fetch failures for fallback testing.
- `?disableEmbeddedFallback=1`: disables the embedded fallback so empty-cache states can be tested.

## Fallback test URLs

Fresh local JSON fetch:

```text
http://localhost:8080/?debug=1&mockSensors=1&reset=1
```

Malformed JSON with empty cache, falling back to embedded data:

```text
http://localhost:8080/?debug=1&mockSensors=1&reset=1&localUrl=data/malformed-instructions.json
```

Fetch failure with populated cache:

```text
http://localhost:8080/?debug=1&mockSensors=1&mockFetchFail=1&disableEmbeddedFallback=1
```

Empty state with no server/cache/embedded fallback:

```text
http://localhost:8080/?debug=1&mockSensors=1&reset=1&source=server&serverUrl=data/missing.json&disableEmbeddedFallback=1
```

## Data contract

The checklist JSON must contain:

- `version`: string, required
- `title`: string, required
- `unit`: optional, `m` or `ft`
- `instructions`: non-empty array
- `instructions[].id`: unique non-empty string
- `instructions[].title`: non-empty string
- `instructions[].details`: optional string or `null`

Unknown fields are ignored.

## Architecture notes

The app is intentionally static and small:

- `index.html`: fixed HUD structure.
- `styles.css`: 600 x 600 MRBD-oriented UI.
- `app.js`: config, state machine, input routing, data loading, storage, sensors, rendering.

The current `CONFIG.dataSource` is `local-json`. The default path is now:

```text
data/sample-instructions.json -> validate -> cache -> render
```

If local JSON fails, the app tries cached instructions. If the cache is empty, it can use the embedded fallback unless `?disableEmbeddedFallback=1` is present.

## Decisions

- Completion triggers immediately when all items are checked.
- Left on the first step and right on the last step stay at the edge.
- Progress persists in `localStorage` by checklist `version`.
- In `DETAIL`, only `ArrowDown` is active.
- Altitude unit comes from JSON `unit`; fallback is meters.

## On-device deployment

For Meta Ray-Ban Display testing, host these static files at a public HTTPS URL, then add the URL in the Meta AI app under the Web Apps flow. Localhost is only for desktop parity testing.
