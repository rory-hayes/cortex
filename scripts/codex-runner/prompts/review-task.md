# Review Backlog Task

You are Codex reviewing the local worktree after implementation.

Task: {{taskId}} — {{taskTitle}}

Approved plan:

{{plan}}

Repository context:

{{promptContext}}

Review for:

- Bugs or incomplete acceptance criteria.
- Missing tests for non-doc behavior.
- Security boundary violations.
- Raw source, diff, patch, secret, or unredacted log leakage.
- Backlog update quality.
  {{bookkeepingReviewInstructions}}

Output must start with exactly one first-line verdict:

- `PASS` if the work is ready for validation, commit, and draft PR.
- `BLOCKED` if anything must be fixed before validation, commit, or draft PR.

After the first-line verdict, include concise supporting notes.
