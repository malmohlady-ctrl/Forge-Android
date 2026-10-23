# U4 — Cohesion + Real-Data Import Ceremony: Scope & Acceptance Checklist (REVISED 2026-10-22)

Status: planning only. U4 starts only on Malcolm's explicit "start U4"
(and U4-Ceremony needs its own separate authorization — Clarification 8).
Revision adds Malcolm's eight final clarifications.

## Clarification 1 — U3 prerequisite gate (VERIFIED 2026-10-22 from session evidence)
- Recorded U3 head confirmed: `u3-yoga` = d6203154ff81e7e56f8cb6a52ea7b35dc9d5d9ec.
- Acceptance evidence: u3_check 14/14 locally + CI run 39887345293 success;
  device pass by Malcolm ("Works!", 2026-10-22) — U3 is CLOSED.
If any of this cannot be re-verified at U4 start, STOP and report the gap.

## Recorded baselines (re-verified at U4 start AND end)
- `main`: dfaf3b0848949825d5777b3dfb5dcf7371e23c26
- `m1-compat`: 92e2ab9a975d75115d986fa0c98129c4c162677f
- `u0-foundations`: 5b04eee2566ffd36e7c783bba3b8c230a7d4856c
- `u1-train`: 7a8909d59faa0e3a39678ef0a9586628d3921f07
- `u2-run`: 31f849703c1e68bd73b061c8b6dc9c87b69dbf74
- `u3-yoga`: d6203154ff81e7e56f8cb6a52ea7b35dc9d5d9ec  <- U4 branches from THIS commit
- New branch `u4-import` is the only branch that changes; the four upstream
  repos/websites stay untouched; `.u0test` identity retained; $0; no new
  dependencies or paid services.

## Clarification 8 — strict two-part authorization (governs everything below)
- U4-Build uses SYNTHETIC DATA ONLY. During Build, Treyvon does not export,
  import, inspect, or migrate any of Malcolm's real personal data. Build
  ends with a stop + a report containing: the APK, the exact commit,
  automated test evidence, backup/restore and rollback results,
  limitations, and the $0 cost report.
- U4-Ceremony (the real import) requires a SEPARATE explicit authorization
  from Malcolm after he reviews the Build report. Malcolm's export files
  are handled only at Ceremony time, on his device, picked by him.

## Part A — the three training stores (U4-Build)
### Step 0 (Clarification 2) — export schemas verified FIRST
Before any import code is written, inspect each pinned source app's
actual Export implementation and document, in the Build report:
- the exact payload each Export produces (envelope, fields, any version
  marker), per app: Couch to 5K (first5k.v1), Lace Up (basementbelt.v1),
  Namastay (namastayhome.v1) — and The Forge's Settings export if Part B
  is selected;
- the supported-field list the importer will accept per source;
- rejection behaviour: malformed JSON, wrong shape for the claimed
  source, unrecognized/unsupported version, and tampered records are
  rejected with the store byte-identical, and the rejection is reported
  in plain language. No partial acceptance of a file.

### A1. Importer enrichment (fixes the known U2/U4 limitation)
`ForgeImporter.toUnified` preserves, per discipline:
- run: key, week, run, status (incl. "partial"), km, paceSec, track
- train: module, name
- yoga: routine
Imported records behave IDENTICALLY to native ones everywhere: couchData
Done/next, history, week counts, streaks, totals.

### A2. Identity, dedupe, conflicts (Clarification 3)
- Deterministic identity per record = the U0 stable-ID scheme
  (source + the record's own key when present, else source + timestamp),
  unchanged in format. Fingerprint = the U0 hash over the record's
  canonical fields, extended to cover the enriched fields above.
- Re-importing an identical export adds ZERO records (fingerprint match
  -> skipped as duplicate, counted in the report).
- Conflict = same identity, different fingerprint. The EXISTING record is
  always preserved; the importer never overwrites. Every conflict is
  listed in the dry-run report with enough detail to recognize it
  (discipline, date, title).

### A3. In-app Import view + atomic commit + exact restore (Clarification 4)
- One file picker per source app in a new Import view; shape validation
  per Clarification 2 before anything else.
- DRY-RUN FIRST: a pre-commit report (records found / new / duplicates /
  conflicts, plus the programme preview of Clarification 5 and, for
  Part B, per-section counts). NOTHING is written until Malcolm taps
  Commit on that report.
- ATOMIC COMMIT: the commit is applied to a cloned store and swapped in
  only on complete success; any failure mid-commit leaves the live store
  byte-identical (proven by a forced-failure test). A pre-import BACKUP
  is taken automatically before the swap and is restorable from the
  same view.
- EXACT RESTORE: backup restoration is verified by a COMPLETE deep
  comparison of the whole store — every section, field and relevant
  setting canonically equal — not by counts alone. The verification
  fixture includes native Train/Run/Yoga records, which must survive
  import + restore untouched.

### A4. Programme semantics (Clarification 5)
- Tests run imported records against the original Couch-to-5K rules:
  an imported COMPLETED run marks its slot Done and advances next; an
  imported PARTIAL appears in history, does not mark Done, and next
  stays on it; a mixed imported+native sequence yields the same
  programme position as the equivalent all-native sequence.
- The dry-run report PREVIEWS the post-import programme position
  (next + newly-Done slots) computed by the app's own couchData logic;
  the ceremony (and the synthetic end-to-end test) verifies the ACTUAL
  position after commit equals the preview.

### A5. Synthetic proof suite (all fixtures synthetic)
Schema acceptance/rejection per Clarification 2; enriched round-trip;
zero-add re-import; conflict preservation + reporting; corrupt-file
rejection with byte-identical store; forced-failure commit rollback;
backup -> import -> restore deep-equality incl. native records;
programme semantics per A4; GPS field fidelity per Clarification 7 on a
synthetic run (km, paceSec, track points identical after import).
All prior suites (u0, u1, spike, u2, u3) stay green.

## Part B — The Forge's own data (DECISION for Malcolm at scope approval)
### B-include isolation (Clarification 6)
If selected, the carry-over is an ALLOWLISTED section merge from the web
Forge's Settings export — never a blind whole-store replacement:
- ALLOWLIST (exact keys fixed from the real DB schema at Step 0 and
  listed in the Build report): nutrition diary, custom foods + saved
  meals/recipes, weight/body history, and portable profile/target
  settings.
- NEVER REPLACED OR TOUCHED: DB.imported, all native Train/Run/Yoga
  records, module state (runState/yogaState/trainState), audio and voice
  preferences (trainPrefs/runPrefs/yogaPrefs), and any Android-app-
  specific settings.
- Proven synthetically: after the merge, allowlisted sections match the
  (synthetic) export exactly, every protected section is deep-equal to
  its pre-merge state, and the dry-run report lists every imported
  section with its counts.
B-exclude remains available: Part A ships identically either way.

## U4-Ceremony (separately authorized; device procedure)
1. Exports taken in Chrome from each app's existing Export feature.
2. Import view dry-run per file; counts, duplicates, conflicts and the
   programme preview reviewed with Malcolm BEFORE any commit.
3. His in-the-moment approval -> backup -> atomic commit.
4. Post-verification: Progress/history complete; actual programme
   position == preview (Clarification 5); AND (Clarification 7) one
   known imported run's distance (km), pace and track (point count,
   first/last points) compared against its source export.
5. On ANY mismatch: STOP and restore the verified backup. No patching
   forward. The backup remains in the app afterward regardless.

## Explicitly NOT in U4
Spotify (U5), notifications (U6), signing/release identity (U7), any
change to the four websites/repos, altering the standalone apps' data
(exports are read-only), and — during Build — any contact with real data.

## Final report contents (Build)
Exact branch/commit + APK identity; Step-0 schema documentation; the
A5 test evidence; backup/restore deep-comparison and forced-failure
rollback results; regressions found; limitations; $0 cost / zero-new-
dependency report. (The Ceremony, when separately authorized, gets its
own report: per-source found/imported/skipped/conflicted counts, the
programme preview-vs-actual check, the GPS comparison, backup status.)
