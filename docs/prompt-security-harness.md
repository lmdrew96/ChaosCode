# Prompt Security Harness

This harness regression-tests the Claude agentic parsing and write-safety path.

## What it checks

- `<file>` extraction tolerates common model formatting variations.
- `<review>` parsing normalizes fenced `<fixed>` payloads.
- `validateAgenticOutput` blocks unsafe paths (absolute and `..` traversal).
- `validateAgenticOutput` warns when content looks like credentials.

## Run

```bash
npm run prompt-security:harness
```

## Files

- `src/renderer/src/services/agenticSecurity.ts`
- `src/renderer/src/services/agenticParser.ts`
- `src/renderer/src/services/agenticSecurity.test.ts`
- `src/renderer/src/services/__fixtures__/adversarialOutputs.ts`

