#!/usr/bin/env node
// Runs the browser suite with FBW_REQUIRE_BROWSER set, as the `npm test` gate needs it.
//
// This exists because npm runs scripts through cmd.exe on Windows, where the POSIX
// `VAR=1 node ...` prefix is not syntax but an error: "'FBW_REQUIRE_BROWSER' is not
// recognized as an internal or external command". The gate's final and most important leg
// therefore could not run at all on a Windows machine, while the three legs before it passed
// and printed their results, which reads exactly like a successful run.
//
// Setting the variable here instead keeps one `npm test` that behaves the same everywhere,
// with no cross-env dependency added for one line.
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--test', 'test/browser.test.mjs', 'test/modes.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, FBW_REQUIRE_BROWSER: '1' }
});

process.exit(result.status === null ? 1 : result.status);
