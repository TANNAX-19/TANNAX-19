# Operating Rules

1. PM is the only role that can change priority and milestone order.
2. Any task without acceptance criteria cannot enter execution.
3. Every role update must include: `task_id`, `status`, `progress`, `next_step`, `timestamp`.
4. Blockers must include `needs_decision` and `response_due_at`.
5. All decisions are effective only after written to `bus/decisions.jsonl`.
6. Roles communicate through bus files, not memory from chat history.
7. The current truth is always the latest line for a given `task_id` in `updates.jsonl`.

