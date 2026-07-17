# Team Roles

## `pm` (single command authority)
- Owns scope, priority, risk, and milestone cadence.
- Dispatches all tasks through `bus/tasks.jsonl`.
- Issues decisions to `bus/decisions.jsonl`.

## `product_owner`
- Clarifies requirements and acceptance criteria.
- Maintains requirement completeness and testability.

## `architect`
- Produces technical design and key interface contracts.
- Resolves architecture-level blockers.

## `developer`
- Implements tasks and submits evidence of completion.
- Reports blockers early with requested decision.

## `qa`
- Validates acceptance criteria and regression risk.
- Blocks release if quality gates fail.

## `platform`
- Handles environment, credentials, CI/CD, infra support.
- Unblocks delivery constraints quickly.

