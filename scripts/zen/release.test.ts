import { expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import { runZenChangelogFixer } from "./release";

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

## [16.3.12-zen.1] - 2026-07-09

### Added

- Existing Zen feature.

### Fixed

- New Zen fix.

## [16.3.11] - 2026-07-08

### Fixed

- Earlier upstream fix.

## [16.3.15] - 2026-07-10

### Fixed

- Current upstream fix.
`;

it("uses the previous Zen release snapshot as the changelog baseline after a branch rebuild", async () => {
	const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zen-changelog-release-"));
	const git = (...args: string[]) =>
		$`git ${args}`
			.cwd(repoRoot)
			.quiet()
			.env({
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_SYSTEM: "/dev/null",
				GIT_AUTHOR_NAME: "t",
				GIT_AUTHOR_EMAIL: "t@t",
				GIT_COMMITTER_NAME: "t",
				GIT_COMMITTER_EMAIL: "t@t",
			});

	try {
		const changelogPath = path.join(repoRoot, "packages/coding-agent/CHANGELOG.md");
		await git("init", "-b", "previous-zen");
		await Bun.write(changelogPath, PREVIOUS_ZEN_CHANGELOG);
		await git("add", "-A");
		await git("commit", "-m", "previous Zen release");
		await git("tag", "zen/v16.3.12-zen.1");

		await git("switch", "--orphan", "rebuilt");
		await fs.rm(path.join(repoRoot, "packages"), { recursive: true, force: true });
		await Bun.write(changelogPath, UPSTREAM_CHANGELOG);
		await git("add", "-A");
		await git("commit", "-m", "upstream 16.3.15 baseline");
		await git("tag", "v16.3.15");

		await Bun.write(changelogPath, REPLAYED_ZEN_CHANGELOG);
		const result = await runZenChangelogFixer(repoRoot);

		expect(result.since).toBe("zen/v16.3.12-zen.1");
		expect(result.changedFiles).toEqual([
			{
				path: "packages/coding-agent/CHANGELOG.md",
				promotedItems: 1,
				mergedDuplicateHeadings: 0,
				droppedReleasedDuplicates: 0,
				removedEmptyHeadings: 1,
			},
		]);

		const fixed = await Bun.file(changelogPath).text();
		const unreleased = fixed.slice(0, fixed.indexOf("## [16.3.12-zen.1]"));
		expect(unreleased).toContain("- New Zen fix.");
		expect(unreleased).not.toContain("- Existing Zen feature.");
		expect(fixed.match(/- Existing Zen feature\./g)).toHaveLength(1);
	} finally {
		await fs.rm(repoRoot, { recursive: true, force: true });
	}
});
