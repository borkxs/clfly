---
"@clfly/core": patch
---

Don't read stdin when it can't contribute: with no `-` bind and every declared field already on argv (or no declared fields), the CLI skips the read. Agent shells that hand commands a never-closed stdin pipe no longer hang those commands. Commands with unset fields still read stdin to EOF, per the stdio ADR.
