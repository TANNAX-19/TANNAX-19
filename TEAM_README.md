# AI Software Team Workspace

This workspace is configured for a multi-session AI software team where one PM session dispatches work and other role sessions execute and report.

## Folder Layout

- `00_governance/`: rules, role boundaries, prompts
- `bus/`: shared JSONL message bus
- `scripts/`: automation scripts
- `reports/`: PM cycle reports

## Message Bus Files

- `bus/tasks.jsonl`: PM -> roles task assignments (single source of truth)
- `bus/updates.jsonl`: roles -> PM progress updates
- `bus/decisions.jsonl`: PM decisions and rationale
- `bus/dispatches.jsonl`: PM dispatch history

## One-Command Demo

Run:

```powershell
.\scripts\demo_run.ps1
```

The demo will:

1. Initialize the team workspace.
2. Seed a small project backlog.
3. Run multiple PM cycles.
4. Simulate role updates.
5. Output final status and report path.

## Real Usage Loop

1. PM runs `.\scripts\team_orchestrator.ps1 -Action pm-cycle`
2. Each role reads `tasks.jsonl`, executes assigned tasks, and appends to `updates.jsonl`
3. PM runs next cycle to make decisions and dispatch next tasks

