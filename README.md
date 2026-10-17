# XQ Squad

Repository-native Devin subagent squad. Install into any GitHub repository and operate through Devin chat.

## What it is

- One Agent Lead in the main Devin session.
- Specialist subagent profiles: analyst, implementer, tester, reviewer, memory-maintainer.
- Delivery skill and workflows.
- Durable shared memory in the repository: Markdown knowledge, NDJSON records, JSON schemas.
- Versioned GitHub Releases with installer, archive, and checksum.
- No hosted service, database, GitHub App, or custom runtime.

## Repository layout

```text
xq-squad/
├── distribution/          # Consumer-ready files
│   ├── AGENTS.md
│   ├── .devin/
│   └── .squad/
├── install.sh           # Consumer installer
├── update.sh            # Consumer upgrader
├── scripts/             # Source tooling and validators
├── tests/               # Automated tests
├── README.md
├── CHANGELOG.md
└── CONTRIBUTING.md
```

## Quick start for consumers

Pipe the installer straight into `sh` (POSIX-compatible, no download needed):

```bash
curl -LsSf https://github.com/ExperienceQuality/xq-squad/releases/download/v1.0.0/install.sh | sh -s -- --target . --version v1.0.0
```

The installer is self-contained: helper scripts ship inside the release archive.
If the target repo has uncommitted changes and stdin is not a TTY (e.g. piped or
CI), the installer refuses to continue — pass `--yes` to proceed non-interactively:

```bash
curl -LsSf https://github.com/ExperienceQuality/xq-squad/releases/download/v1.0.0/install.sh | sh -s -- --target . --version v1.0.0 --yes
```

Or download and run it yourself:

```bash
curl -fL https://github.com/ExperienceQuality/xq-squad/releases/download/v1.0.0/install.sh -o /tmp/squad-install.sh
sh /tmp/squad-install.sh --target . --version v1.0.0
```

Or use a local archive:

```bash
bash install.sh --target . --version v1.0.0 --archive squad-v1.0.0.tar.gz --checksum squad-v1.0.0.tar.gz.sha256
```

## Development

Validate the distribution:

```bash
bash scripts/validate.sh
```

Package a release:

```bash
bash scripts/package-release.sh --version v1.0.0
```

Run tests:

```bash
node --test tests/*.test.mjs
bash tests/install.test.sh
bash tests/install-pipe.test.sh
bash tests/upgrade.test.sh
bash tests/e2e.test.sh
```

## Release process

1. Bump `version` and `release_tag` in `distribution/.squad/squad.json`.
2. Update `CHANGELOG.md`.
3. Merge to `main` — the `release` workflow validates, runs the full test
   suite, tags the commit, and publishes `install.sh`, the archive, and the
   checksum as release assets automatically.
4. Or trigger manually via `workflow_dispatch` with an optional `version`
   input (e.g. `v1.0.0`).

If the tag or release already exists, the workflow skips publishing.
