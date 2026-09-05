---
name: brief-subagent
description: Template and checklist for handing a well-specified slice to a subagent (rules-engineer, engine-engineer, content-scribe) and for reviewing what comes back.
---
# Briefing a subagent

Use the agent types in `.claude/agents/`. A brief has: **Goal** (one paragraph) · **Files you may
touch** (explicit list) · **Contract** (paste the interface/types) · **Tests required** · **Must not**
(other dirs, deps, contract changes) · **Run** (the nvm prefix + commands) · **Report format**.

Prefer Opus for rules and anything with judgement; Sonnet for specified engine slices; Haiku for
content entry and doc tidying. Run them in the background; meanwhile keep working on disjoint files.

On return: read the diff yourself, run `npm run check && npm test`, run the gesture test if the table
or host or a rules module changed, then commit with a message naming the slice.
