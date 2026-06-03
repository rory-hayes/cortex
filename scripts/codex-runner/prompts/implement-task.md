# Implement Backlog Task

You are Codex implementing one approved backlog task in an isolated worktree.

Task: {{taskId}} — {{taskTitle}}

Approved plan:

{{plan}}

Repository context:

{{promptContext}}

Rules:

- Implement only this task and direct dependencies required for it.
- Use tests first for behavior changes.
- Do not implement unrelated backlog tasks.
- Do not weaken security, validation, or human approval requirements.
- Keep source execution local and preserve the no-raw-source-to-web boundary.
  {{bookkeepingInstructions}}

Finish with a short local summary and validation notes. Do not create commits or PRs yourself; the runner owns that step.
