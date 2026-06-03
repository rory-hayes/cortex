# Fix Backlog Task

You are Codex repairing one backlog task after review or validation failed.

Task: {{taskId}} — {{taskTitle}}
Fix attempt: {{fixAttempt}}

Approved plan:

{{plan}}

Review findings:

{{review}}

Validation results:

{{validation}}

Repository context:

{{promptContext}}

Rules:
- Fix only the reported blockers.
- Add or repair tests before changing behavior.
- Do not broaden scope.
- Do not create commits or PRs yourself.
