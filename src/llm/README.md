# LLM providers

`OpenAICompatibleProvider` calls `/chat/completions` for OpenAI-compatible or local Qwen endpoints. Responses are normalized only to the constrained DSL and then Zod-validated. Execution-plane code must not import this directory.
