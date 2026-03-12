# Unreal-backed Tests

This directory is reserved for tests that require a real Unreal fixture project.

Run them from the repo root with:

```bash
bun run test:e2e
```

Fixture resolution order:

1. `UNREAL_FIXTURE_DIR`
2. `fixtures/unreal-project`
