### Lesson: Compare real paths for Node CLI entrypoint guards

- Domain: deployment tooling
- Severity: high
- Trigger: A Node ESM deploy helper is executed through a symlinked absolute path such as `/tmp/...` on macOS.
- Root cause: The CLI entrypoint guard compared `process.argv[1]` to `fileURLToPath(import.meta.url)` as raw strings, so `/tmp` and `/private/tmp` could refer to the same file but fail equality.
- Fix: Normalize both sides with `fs.realpathSync` before deciding whether to run the CLI body.
- Rule: Never gate Node CLI execution on raw path string equality when the script can be called from temp dirs, worktrees, or symlinked paths.
- Upgrade: agent-lessons
