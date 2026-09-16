# Computer-Use Capability Runtime

> The model discovers; the artifact becomes the capability; deterministic replay is production execution.

This repository is being built iteratively. The first review slice contains:

- a runnable, intentionally legacy-styled bank admin simulator with deterministic scenarios;
- the core runtime interfaces that enforce a discovery/execution boundary;
- a typed and versioned `CapabilityArtifact` schema;
- the full directory skeleton for later implementation.

Discovery, compilation, deterministic replay, policy enforcement, evidence storage, and human handoff are intentionally directory stubs in this first slice.

## Run the first slice

```bash
npm install
npm run demo
```

Open <http://localhost:4000>. Run validation with:

```bash
npm run typecheck
npm test
```

## Deterministic demo member IDs

| Member ID | Result |
|---|---|
| `12345` | Normal member with a savings balance |
| `40400` | Member not found |
| `40300` | Permission denied |
| `50000` | Simulated application error |
| `70000` | Delayed response |
| `88888` | Unexpected modal requiring human attention |

All names and account data are fictional.

## Current boundaries

`LLMProvider` is referenced only by discovery contracts. `ReplayEngine` accepts an artifact, inputs, surface, policy, and evidence store—there is deliberately no LLM parameter. `SurfaceAdapter` keeps orchestration independent of Playwright and the DOM. See `src/interfaces/` and `src/capability/artifact-schema.ts`.

The [draft artifact example](capabilities/get-savings-balance.example.yaml) validates against the schema and illustrates parameterized inputs, ordered locator fallbacks, output extraction, bounded recovery, and a known business outcome. It is not generated evidence and cannot yet be replayed.
