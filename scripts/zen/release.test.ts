import { expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runChangelogFixer } from "../fix-changelogs";

const PREVIOUS_ZEN_CHANGELOG = `# Changelog

## [Unreleased]

## [16.3.12-zen.1] - 2026-07-09

### Added

- Existing Zen feature.

## [16.3.11] - 2026-07-08

### Fixed

- Earlier upstream fix.
`;

const UPSTREAM_CHANGELOG = `# Changelog

## [Unreleased]

## [16.3.11] - 2026-07-08

### Fixed

- Earlier upstream fix.

## [16.3.15] - 2026-07-10

### Fixed

- Current upstream fix.
`;

const REPLAYED_ZEN_CHANGELOG = `# Changelog

## [Unreleased]

### Fixed

- New Zen fix.

## [16.3.12-zen.1] - 2026-07-09

### Added

- Existing Zen feature.

## [16.3.11] - 2026-07-08

### Fixed

- Earlier upstream fix.

## [16.3.15] - 2026-07-10

### Fixed

- Current upstream fix.
`;

it("uses the previous Zen release snapshot as the changelog baseline after a branch rebuild", async () => {
	const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zen-changelog-release-"));
	const git = async (...args: string[]) => {
		const child = Bun.spawn(["git", ...args], {
			cwd: repoRoot,
			stdout: "ignore",
			stderr: "ignore",
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_SYSTEM: "/dev/null",
				GIT_AUTHOR_NAME: "t",
				GIT_AUTHOR_EMAIL: "t@t",
				GIT_COMMITTER_NAME: "t",
				GIT_COMMITTER_EMAIL: "t@t",
			},
		});
		const exitCode = await child.exited;
		if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
	};

	try {
		const changelogPath = path.join(repoRoot, "packages/coding-agent/CHANGELOG.md");
		await git("init", "-b", "previous-zen");
		await Bun.write(changelogPath, PREVIOUS_ZEN_CHANGELOG);
		await git("add", "-A");
		await git("commit", "-m", "previous Zen release");
		const previousCommit = await Bun.file(path.join(repoRoot, ".git", "refs", "heads", "previous-zen")).text();
		await Bun.write(path.join(repoRoot, ".git", "refs", "tags", "zen", "v16.3.12-zen.1"), previousCommit);

		await git("switch", "--orphan", "rebuilt");
		await fs.rm(path.join(repoRoot, "packages"), { recursive: true, force: true });
		await Bun.write(changelogPath, UPSTREAM_CHANGELOG);
		await git("add", "-A");
		await git("commit", "-m", "upstream 16.3.15 baseline");
		const rebuiltCommit = await Bun.file(path.join(repoRoot, ".git", "refs", "heads", "rebuilt")).text();
		await Bun.write(path.join(repoRoot, ".git", "refs", "tags", "v16.3.15"), rebuiltCommit);

		await Bun.write(changelogPath, REPLAYED_ZEN_CHANGELOG);
		const previousZenTag = "zen/v16.3.12-zen.1";
		const result = await runChangelogFixer({ repoRoot, since: previousZenTag });
		await runChangelogFixer({ repoRoot, since: previousZenTag, recover: true, recoveryTags: [previousZenTag] });

		expect(result.since).toBe("zen/v16.3.12-zen.1");

		const fixed = await Bun.file(changelogPath).text();
		const unreleased = fixed.slice(0, fixed.indexOf("## [16.3.12-zen.1]"));
		expect(unreleased).toContain("- New Zen fix.");
		expect(unreleased).not.toContain("- Existing Zen feature.");
		expect(fixed.match(/- Existing Zen feature\./g)).toHaveLength(1);
	} finally {
		await fs.rm(repoRoot, { recursive: true, force: true });
	}
});
