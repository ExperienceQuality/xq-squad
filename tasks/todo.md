# Todo: Repository-Native Devin Subagent Squad

## Phase 1: Devin native contract

- [ ] Task 1: Create distribution root `AGENTS.md`
- [ ] Task 2: Create `.squad/README.md` and `.squad/squad.json`
- [ ] Task 3: Create Lead contract
- [ ] Task 4: Create specialist role contracts
- [ ] Task 5: Create `.devin/agents` native profiles
- [ ] Task 6: Create `.devin/skills/squad-delivery/SKILL.md`
- [ ] Task 7: Create `.squad/workflows`
- [ ] Checkpoint 1: Contract files exist and pass Devin doctor

## Phase 2: Memory system

- [ ] Task 8: Create NDJSON memory schema
- [ ] Task 9: Create memory update script
- [ ] Task 10: Create memory search/retrieval script
- [ ] Task 11: Create `MEMORY.md` template
- [ ] Checkpoint 2: Memory schema and scripts tested

## Phase 3: Release packaging

- [ ] Task 12: Define distribution manifest and packaging rules
- [ ] Task 13: Implement archive and checksum generation
- [ ] Task 14: Implement packaging validation
- [ ] Checkpoint 3: Archive and checksum produced and validated

## Phase 4: Safe installation

- [ ] Task 15: Implement `install.sh` preflight
- [ ] Task 16: Implement archive download and verification
- [ ] Task 17: Implement managed `AGENTS.md` section
- [ ] Task 18: Implement file installation and idempotency
- [ ] Checkpoint 4: Install idempotent and preserves existing files

## Phase 5: Safe upgrade

- [ ] Task 19: Implement `update.sh` entry point
- [ ] Task 20: Implement three-way managed-file comparison
- [ ] Task 21: Implement safe apply and state update
- [ ] Checkpoint 5: Upgrade preserves consumer edits and reports conflicts

## Phase 6: End-to-end validation

- [ ] Task 22: Create sample consumer repository fixture
- [ ] Task 23: Run install, upgrade, and workflow tests
- [ ] Task 24: Produce Devin compatibility report
- [ ] Task 25: Finalize documentation
- [ ] Checkpoint 6: All tests pass, docs ready, no uncommitted changes
