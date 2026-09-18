#!/usr/bin/env node

// Backward-compatible neutral entry point. The underlying generator accepts
// Gemini and OpenAI-compatible providers through lib/llm-client.mjs.
import './gemini-documents.mjs';