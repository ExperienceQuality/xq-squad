# Memory Maintenance Workflow

Run after verification and before final delivery report.

## Steps

1. Review delivery for reusable knowledge.
   - New conventions discovered.
   - Verified command patterns.
   - Architecture or design decisions.
   - Lessons that would help future sessions.

2. Inspect existing memory.
   - Read `.squad/MEMORY.md`.
   - Read `.squad/memory/lessons.ndjson` and `.squad/memory/delivery-events.ndjson`.
   - Use `.squad/scripts/memory-search.mjs` for targeted lookup.

3. Propose candidate records.
   - Avoid duplicates.
   - Mark superseded records.
   - Prevent secrets and conversation transcripts.

4. Validate proposed records.
   - Check NDJSON against `.squad/schemas/memory-record.schema.json`.
   - Confirm stable IDs.

5. Apply validated changes.
   - Update `.squad/MEMORY.md` for canonical knowledge.
   - Use `.squad/scripts/memory-update.mjs` for NDJSON changes.

6. Report outcome.
   - `UPDATED` — changes applied.
   - `UNCHANGED` — reviewed, nothing durable justified.
   - `BLOCKED` — could not validate or persist; explain why.

## Rules

- One writer per NDJSON update.
- Validate before commit.
- Keep code and memory changes on the same branch.
