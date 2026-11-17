# Naturalism experiment CI verification checkpoint

This is a non-functional, branch-isolated evidence checkpoint for PR #12.

The experiment branch includes:
- `dbef846`: hoof contact correction;
- `5baf592`: sloped-ground and seed-150 unit regression;
- `1c0838a98d5f1a111197efc5fe0fc301f5dea464`: browser evidence-capture improvements.

The original strict **<5 mm** hoof-ground contact acceptance threshold is mandatory. Do not weaken or skip the gate.

## Required CI evidence

The branch's `.github/workflows/quality.yml` has both `push` and `pull_request` triggers and requires:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `npx playwright install --with-deps chromium`
6. `npx playwright test --project=naturalism --project=naturalism-v3` (on this experiment branch)
7. `npm run test:e2e -- --trace retain-on-failure`
8. Upload browser evidence/reports on completion.

Review the 720p and 1080p A/B screenshots, captured browser errors, console diagnostics and screenshot artifact paths. Do not infer physical GPU throughput from SwiftShader.

At the time of this checkpoint, GitHub's commit-specific **pull-request-triggered** workflow-run query returned zero runs for the three revisions above. That endpoint does not enumerate push-triggered runs; therefore zero results alone do **not** prove no workflow ran. This doc-only commit intentionally triggers the configured `push` workflow without altering simulation, rendering, acceptance thresholds or test execution. A subsequent GitHub Actions run must be verified separately before declaring the gate green.

PR #12 stays experimental and unmerged pending visual review and real-hardware measurements.
