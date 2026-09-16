# Evidence

`JsonlEvidenceStore` writes per-run JSONL events, copied PNG screenshots, and discovery traces with recursive redaction.

Routine runs are ignored. `npm run curate:evidence -- ...` selects verified fake-data runs, validates their classifications, rewrites references to repository-relative paths, scans for sensitive material, and copies them to `evidence/submission/` for review.
