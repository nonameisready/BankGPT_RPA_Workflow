# 1. Architecture

The discovery plane runs observe → OpenAI-compatible model decision → Zod validation → policy check → Playwright action. Its output is a raw `RunTrace`. The execution plane accepts a reviewed `CapabilityArtifact` and typed invocation inputs, then runs through `ReplayEngine` with no `LLMProvider` dependency. Both planes use the same `SurfaceAdapter`, `PolicyEngine`, and JSONL evidence interface. The local LegacyBank simulator is a proxy for API-less browser applications, not a production bank.

# 2. Artifact schema

The Zod artifact is schema-versioned and semver-tagged. It defines application identity, typed inputs/outputs, risk and policy, ordered steps, stable target IDs with locator bundles, explicit waits/recovery, success checkpoints, known business outcomes, tenant override addressability, and provenance. `CheckpointSchema` is a discriminated union: each kind has only its required fields. The compiler parameterizes invocation values as `{from_input: member_id}` and rejects an artifact that still contains the observed input value. Raw evidence stays in the trace, not the artifact. YAML and JSON round-trip through the same schema.

# 3. Determinism & error handling

Locator strategies are tried in artifact order; ambiguous matches are not silently accepted. The LegacyBank savings extraction addresses an iframe by title and a table cell by Savings row × Current Balance column. Replay checks policy for each interpolated action, evaluates business outcomes after a step, verifies postconditions and final outputs, and emits a structured `RunResult`. `40400` is a known `BUSINESS_OUTCOME/MEMBER_NOT_FOUND`, while permission/app errors are hard failures. Retry is explicit and bounded; `on_failure=continue` is forbidden. JSONL and screenshots make replay failures inspectable.

# 4. Heterogeneity & multi-tenant

`SurfaceAdapter` separates reusable recorded flow from the mechanism that perceives and controls a UI. A future adapter could use browser accessibility, screenshots/coordinates, Windows UI Automation, or a native desktop surface without changing artifact invocation. The schema carries vendor family, app family, compatible versions, variant, fingerprint hints, and stable target IDs. A future tenant-specific override layer could map a Vendor X v7 base target ID to Tenant A's route prefix or Tenant B's alternate field label. This slice validates override addressability but deliberately does not implement a production multi-tenant control plane. Version fingerprints and replay health metrics could detect drift before broad reuse.

# 5. Escalation & handoff

The interface names ownership states (`automation`, `human`, `paused`) and a same-session intervention request. Replay detects the simulator's `88888` unexpected dialog and returns `HUMAN_REQUIRED/UNEXPECTED_DIALOG` with a screenshot. The operator UI and actual pause/resume controller are cut from this slice; detection is not a completed handoff flow.

# 6. Safety

Policy is executable code, not a prompt. Domain, route, action, protocol, and risk checks run in discovery and replay. Logs recursively redact secret-like keys and configured sensitive values; model keys are never written to evidence or artifacts. The demo has only fake names/data and stops sub-account actions at review. This is not a substitute for production authentication, secrets management, or audited financial controls.

# 7. Cuts

The completed slice is browser-only and read-only. The operator UI, `88888` handoff, desktop surfaces, visual locator repair, automatic tenant inheritance, and bounded model-assisted replay recovery remain TODOs. The compiler uses explicit output/goal hints for explainability. It does not claim universal autonomous workflow inference. No distributed infrastructure or real financial transaction path was added.
