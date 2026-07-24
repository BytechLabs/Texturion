# Autopilot prompt

Paste the block below into a Claude Code session on this repo to run the
autonomous improvement loop unattended. It encodes the project's binding
practices; the details live in MEMORY.md, docs/DECISIONS.md, and
brand/README.md so the prompt stays short and the sources stay current.

```text
/anthropic-skills:auto-dev-via-github-issues

You are running unattended for weeks. GitHub issues are the only backlog; MEMORY.md, docs/DECISIONS.md, and brand/README.md are binding. Loop: refresh issues, take the highest-priority item (P0 broken production/crashes/security, then P1 bugs/regressions, then P2 epics and unfinished features, then P3 tests/UX/refactoring, then P4 new ideas), root-cause it, fix the class so the failure is architecturally impossible, gate, commit, push, close the issue with evidence, repeat. Completion beats discovery: file new issues only for real, reproducible, scoped findings, and the open count must trend down week over week. When the backlog is empty, run a discovery pass (code audit, runtime behavior, marketing/UX walkthrough, cost review) and work what it finds.

Method, binding on this project:
- Critical or confusing bugs get an adversarial multi-lens audit workflow FIRST (independent finder lenses, then verifiers instructed to refute); implement only CONFIRMED findings, using their verified fix specs. Delegate to workflows for substantive multi-file work; do small fixes yourself.
- Gates before every push: Android compile + unit tests + assembleDebug (run export PATH="${PATH//\"/}" first); web and api lint + typecheck + full tests; api e2e when Docker Desktop is up. Watch CI to green after every push and fix failures immediately - prod deploys from main, so unpushed or red work reaches no one.
- Stage explicit paths only, never git add -A: the repo is public and scratch artifacts, decompiled vendor code, or secrets must never enter history.
- Paper & Olive, the double-o brand, and the wordmark rule are binding. No em dashes in user-facing copy. No mocks, no placeholders, no copy that describes behavior the product does not have. Every new cost center ships with a cap and an alert before the cap.
- Founder messages that arrive mid-loop are P0 input: file each report as an issue with your analysis, fix in priority order, and answer their questions directly.
- Fixes that only the founder's device can verify: ship, post a test protocol on the issue, leave it open, move on. iOS is not compile-verifiable here: be conservative and route parity through its epic.

Cadence - THE MOST IMPORTANT RULE: never sleep more than 60 seconds between iterations. Every ScheduleWakeup is 60s, always; there is no long-wait mode. If a wake finds workflows still running, do OTHER work from the backlog in the meantime (different files) rather than waiting. Hundreds of commits in hours is the intended shape: small, green, pushed commits - GitHub is the tracker of record, so progress lives in commits and issue comments, not in chat.

Continuity - you will be interrupted by session limits and restarts:
- On every start or wake: check git status for stranded work, gh run list for red CI, and resume any workflow a dead process orphaned via Workflow({scriptPath, resumeFromRunId}) - completed agents replay from cache. A subagent killed by a session limit is relaunched after the reset, never dropped.
- Update the memory files after every shipped batch so a cold session can continue from them alone.
- Nobody reads the chat while you run: put status into commit messages and issue comments, and keep chat summaries to a few lines.
```
