# U4 Step 0 — Export schemas (verified from the pinned sources, 2026-10-22)

All findings are from the pinned app sources in upstream.lock.json
(Couch 0015723, Home-Corner 1551716, Namastay 240442c, FIT-HQ 201aec2).
No website changes are needed or made: every app already has an
"Export data" button.

## Couch to 5K -> first-5k-progress.json
Payload: `JSON.stringify(state)` — the raw store, NO envelope, NO version
field. Shape: `{completed: [...], selectedWeek, selectedRun}`.
Run record fields: key ("W-R"), week (0-based), run (0-based), date,
timestamp, minutes, durationSec, status ("completed"|"partial"), and
when GPS data exists: km, paceSec, track (downsampled points).
Importer uses `completed` only; selectedWeek/selectedRun are app state
and are NOT imported.

## Lace Up (Home-Corner) -> home-corner-progress.json
Payload: raw store, no envelope/version. Shape:
`{completed: [...], selectedModule}`.
Record fields: module, name/title, date, timestamp, minutes,
durationSec. Importer uses `completed` only.

## Namastay Home -> namastay-home-progress.json
Payload: raw store, no envelope/version. Shape:
`{completed: [...], selectedRoutine}`.
Record fields: key (routineId-timestamp), routine, title, date,
timestamp, minutes, durationSec. Importer uses `completed` only.

## The Forge (FIT-HQ) Settings export -> full DB JSON
Payload: `JSON.stringify(DB)` — the complete fithq.db.v1 object WITH a
version field: `{v: 1, settings: {...}, entries: [], foods: [],
meals: [], water: [], weights: [], measures: [], sessions: []}`.

## Validation + rejection behaviour (implemented in importer.js)
Training-store file (per source):
- Unparseable JSON -> reject ("not valid JSON").
- Not an object, or `completed` missing / not an array -> reject.
- Any record lacking an identity (needs timestamp or date, AND one of
  key/module/routine/title/name) -> reject the WHOLE file.
- Unknown fields (record-level or top-level) are ignored, never carried.
- There is no version field in these formats; a file carrying some other
  app's shape fails the source's own checks above (wrong-source files
  are rejected by the identity/shape rules for the claimed source).
The Forge file:
- Must be an object with `v === 1` (any other v -> "unsupported
  version"), a `settings` object, and every present allowlisted section
  must be an array; otherwise reject.
Rejection NEVER writes anything: the live store stays byte-identical.

## Part B allowlist (from the Forge DB schema in app.js defaultDB)
Sections replaced from the export: entries (nutrition diary), foods
(custom food library), meals (saved meals & recipes), water, weights,
measures (weight/body history).
Settings: only the portable keys are taken — name, age, sex, heightCm,
startKg, goalKg, units, activity, goalType, weekStart, centerStat,
targets, targetsCustom, exerciseBack. Live-only settings keys survive.
NEVER touched by the merge: imported (all Train/Run/Yoga records,
native and imported), sessions (The Forge's own built-in player log —
outside Malcolm's stated allowlist), and the top-level module state and
prefs (trainPrefs, runPrefs, yogaPrefs, runState, yogaState).
