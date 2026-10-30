---
"@clfly/core": minor
---

**Breaking:** stdin is read only on an explicit `-` sentinel. Piped stdin is no longer merged into args by default. `producer | cmd` now ignores stdin, so write `producer | cmd --args -` to merge one JSON object (undeclared keys dropped, argv wins). Field binds (`--field -`, positional `-`) are unchanged. `args` is now a reserved flag. Without a sentinel the CLI never touches stdin, so agent shells that hand commands a never-closed pipe no longer hang them.
