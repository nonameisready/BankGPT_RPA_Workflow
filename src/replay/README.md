# Deterministic replay

`ReplayEngine` merges defaults with caller inputs, authorizes every action, runs bounded explicit retries, interprets artifact-declared terminal conditions, handles same-session intervention when configured, checks success outputs, and returns a structured result. It has no LLM dependency and no demo-specific outcome codes.
