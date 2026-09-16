# 1. Architecture

The discovery plane runs observe → OpenAI-compatible model decision → Zod validation → policy check → Playwright action. Its output is a raw `RunTrace`. The execution plane accepts a reviewed `CapabilityArtifact` and typed invocation inputs, then runs through `ReplayEngine` with no `LLMProvider` dependency. Both planes use the same `SurfaceAdapter`, `PolicyEngine`, and JSONL evidence interface. The local LegacyBank simulator is a proxy for API-less browser applications, not a production bank.

# 2. Artifact schema

The Zod artifact is schema-versioned and semver-tagged. It defines application identity, typed inputs/outputs and defaults, risk and policy, ordered steps, stable target IDs with locator bundles, explicit waits/recovery, success checkpoints, classified terminal conditions, tenant override addressability, and provenance. `CheckpointSchema` is a discriminated union: each kind has only its required fields. `terminal_conditions` keeps `BUSINESS_OUTCOME` separate from `HARD_FAILURE`; generic replay does not know LegacyBank codes. The compiler parameterizes invocation values as `{from_input: member_id}` and rejects an artifact that still contains the observed input value. Raw evidence stays in the trace, not the artifact. YAML and JSON round-trip through the same schema.

# 3. Determinism & error handling

Locator strategies are tried in artifact order; ambiguous matches are not silently accepted. The LegacyBank savings extraction addresses an iframe by title and a table cell by Savings row × Current Balance column. Replay builds effective inputs from artifact defaults overridden by caller values, checks policy for every action, evaluates declared terminal conditions after each step, verifies final outputs, and emits a structured `RunResult`. The real browser runs produced `40400 → BUSINESS_OUTCOME/MEMBER_NOT_FOUND`, `40300 → HARD_FAILURE/PERMISSION_DENIED`, and `50000 → HARD_FAILURE/APP_ERROR` before extraction. Retry is explicit and bounded; `on_failure=continue` is forbidden. A declared known interstitial may be dismissed deterministically before retry. JSONL and screenshots make failures inspectable.

# 4. Heterogeneity & multi-tenant

`SurfaceAdapter` separates reusable recorded flow from the mechanism that perceives and controls a UI. A future adapter could use browser accessibility, screenshots/coordinates, Windows UI Automation, or a native desktop surface without changing artifact invocation. The schema carries vendor family, app family, compatible versions, variant, fingerprint hints, and stable target IDs. A future tenant-specific override layer could map a Vendor X v7 base target ID to Tenant A's route prefix or Tenant B's alternate field label. This slice validates override addressability but deliberately does not implement a production multi-tenant control plane. Version fingerprints and replay health metrics could detect drift before broad reuse.

# 5. Escalation & handoff

`LiveSessionControlManager` enforces `automation → paused → human → automation` over one existing headed Playwright session. For `88888`, replay created an `InterventionRequest` with screenshot, URL, state summary, and requested action; paused; allowed the human to dismiss the notice in the same browser; waited for CLI resume; re-observed the URL/dialog state; and then returned balance `888.88` and currency `USD`. It refuses to continue if takeover changes the application URL. The ownership transitions and final output are present in committed JSONL evidence.

# 6. Safety

Policy is executable code, not a prompt. Domain, route, action, protocol, and risk checks run in discovery and replay, including a policy check before known-interstitial dismissal. Logs recursively redact secret-like keys and configured sensitive values; model keys are never written to evidence or artifacts. Routine runs remain ignored, while curated fake-data evidence is copied under `evidence/submission`, converted to repository-relative references, structurally validated, and scanned for credentials, cookies, browser state, API keys, local model paths, and absolute user paths. This is not a substitute for production authentication, secrets management, or audited financial controls.

# 7. Cuts

The completed slice is browser-only and read-only. Handoff is intentionally a local headed-browser + CLI interaction, not a production operator UI with authentication, multiple operators, remote streaming, or durable job coordination. Desktop surfaces, visual locator repair, automatic tenant override application, and bounded model-assisted replay recovery remain TODOs. The compiler uses explicit output/goal hints for explainability; it does not claim universal autonomous workflow inference. No distributed infrastructure or real financial transaction path was added.
