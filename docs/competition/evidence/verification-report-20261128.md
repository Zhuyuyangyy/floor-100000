# Release closeout verification · 2026-11-28

## Claim

The release-line code and local public-surface regression suite were revalidated after the stair-transition fix, input-race fixes, and touch-cancel stop fix.

## Commands and results

| Command | Exit | Result |
|---|---:|---|
| `npm run typecheck` | 0 | TypeScript completed without errors |
| `npm run build` | 0 | Production bundle built; Vite emitted the existing large-chunk warning |
| `npm run test:ci` | 0 | 85 test files passed, 2 Spark-live files skipped, 1244 passed and 6 skipped |
| `npm run test:collection` | 0 | 87 files and 1250 cases, above the collection floor |
| `npm run competition:benchmark -- --seeds 1,42,2026 --output output/closeout/competition-replay-20261127.json` | 0 | 9/9 offline replay matches, 100% |
| `npx playwright test --workers=1 --retries=1 --timeout=90000 --trace=off` | 0 | 123 passed, 2 skipped, 125 tests |
| `PUBLIC_BASE=... npx playwright test -c playwright.public.config.ts --workers=1` | 0 | 3/3 anonymous public smoke tests passed |
| `PUBLIC_BASE=... npx playwright test -c playwright.config.ts e2e/onlineGoldenRoute.spec.ts --workers=1 --timeout=300000` | 0 | 2/2 public golden-route tests passed, including forced model-failure fallback |

Executed on the clean `deploy-ms-20261125` worktree. The browser suite used a dedicated Vite port and an offline local AI configuration so the results do not depend on a local model service.

## Regression fixed

`e2e/actionCosts.spec.ts` now acknowledges the real chapter-completion card after reaching floor 3 before continuing to floor 4. The failure was caused by the test sending stair input while the End scene was active. The same-frame input guard is respected by repeated gift and shortcut assertions. A cancelled touch clears both the pointer map and the movement velocity in `GameScene`.

## Automated coverage

- Stair path 1→2→3→4→5 is covered through the normal scene entry and the chapter card.
- NPC gift, repair fallback, Judge Mode, adversarial inputs, save recovery, survival, UI, combat, touch, mouse and tower flows are covered by the final 125-test run.
- The public smoke suite covered anonymous portal access, iframe game boot, floor-2 residents and an online model response.
- The public golden-route suite covered the model-backed repair route and the forced network-failure fallback route.
- The offline benchmark covered seeds 1, 42 and 2026 with three scenarios per seed. It is a determinism and conservation check, not an online model quality benchmark.

## Remaining evidence boundaries

- No human participant feedback was present in the repository, so no human quote or subjective playtest result was added.
- No video file was recorded in this closeout. The video checklist remains a recording brief.
- The public runs do not prove online multi-seed model success rates or a live world-tick observation.

## Verdict

**PASS for the release-line automated engineering gate.** The competition evidence package still needs authentic human playtest records and a recorded demo before it can be described as fully complete.
