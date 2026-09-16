# Curated submission evidence

This directory contains sanitized evidence from actual fake-data runs against the local LegacyBank Express application and a real Playwright-controlled Chrome browser. The discovery run used the local OpenAI-compatible `Qwen3.5-35B-A3B-4bit` provider; replay did not load or call an LLM.

| Scenario | Run ID | Verified result |
|---|---|---|
| Discovery | `1e2c1687-0055-4ab2-9ef8-d317458f681d` | `SUCCESS`, balance `12340.22`, currency `USD`; sanitized model decisions recorded |
| Replay success | `e7eae7f6-b8fe-42f6-9288-cf0cdd68b32c` | `SUCCESS`, balance `12340.22`, currency `USD` |
| Missing member | `5f1b04f1-0904-4c42-ba53-e6755a338788` | `BUSINESS_OUTCOME/MEMBER_NOT_FOUND` |
| Permission failure | `dc52ed74-7f7a-4af1-b5db-47078120c27e` | `HARD_FAILURE/PERMISSION_DENIED` |
| Application failure | `efe5c5b2-f74a-4e92-814c-968c3e72ddc4` | `HARD_FAILURE/APP_ERROR` |
| Human handoff | `8e43d342-e656-4431-9b18-26b2fbe18940` | Same-session takeover/resume, then `SUCCESS`, balance `888.88`, currency `USD` |

All people, member IDs, accounts, and balances are simulator data. The curation command checks run IDs and expected event classes, requires PNG evidence, rewrites absolute run references, and rejects likely credentials, cookies, storage state, local model paths, or absolute user paths. [manifest.json](manifest.json) is the machine-readable index.
