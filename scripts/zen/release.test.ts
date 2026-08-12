import { expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import { preparePublishWorktree } from "./prepare-publish-worktree";

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
	const git = (...args: string[]): string => {
		const result = Bun.spawnSync(["git", ...args], {
			cwd: repoRoot,
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_SYSTEM: "/dev/null",
				GIT_AUTHOR_NAME: "t",
				GIT_AUTHOR_EMAIL: "t@t",
				GIT_COMMITTER_NAME: "t",
				GIT_COMMITTER_EMAIL: "t@t",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
		}
		return result.stdout.toString();
	};

	try {
		const changelogPath = path.join(repoRoot, "packages/coding-agent/CHANGELOG.md");
		await git("init", "-b", "previous-zen");
		await fs.mkdir(path.dirname(changelogPath), { recursive: true });
		await fs.writeFile(changelogPath, PREVIOUS_ZEN_CHANGELOG);
		git("add", "-A");
		git("commit", "-m", "previous Zen release");
		git("tag", "zen/v16.3.12-zen.1");

		git("switch", "--orphan", "rebuilt");
		await fs.rm(path.join(repoRoot, "packages"), { recursive: true, force: true });
		await fs.mkdir(path.dirname(changelogPath), { recursive: true });
		await fs.writeFile(changelogPath, UPSTREAM_CHANGELOG);
		git("add", "-A");
		git("commit", "-m", "upstream 16.3.15 baseline");
		git("tag", "v16.3.15");

		await fs.writeFile(changelogPath, REPLAYED_ZEN_CHANGELOG);
		const resultPath = path.join(repoRoot, "result.json");
		const releaseUrl = new URL("./release.ts", import.meta.url).href;
		const script = `
import { runZenChangelogFixer } from ${JSON.stringify(releaseUrl)};
await Bun.write(${JSON.stringify(resultPath)}, JSON.stringify(await runZenChangelogFixer(${JSON.stringify(repoRoot)})));
`;
		const child = Bun.spawnSync([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
		if (child.exitCode !== 0) throw new Error(child.stderr.toString());
		const result = (await Bun.file(resultPath).json()) as {
			since: string;
			changedFiles: Array<{ path: string }>;
		};
		expect(result.since).toBe("zen/v16.3.12-zen.1");
		expect(result.changedFiles.map(file => file.path)).toEqual(["packages/coding-agent/CHANGELOG.md"]);

		const fixed = await fs.readFile(changelogPath, "utf8");
		const unreleased = fixed.slice(0, fixed.indexOf("## [16.3.12-zen.1]"));
		expect(unreleased).toContain("- New Zen fix.");
		expect(unreleased).not.toContain("- Existing Zen feature.");
		expect(fixed.match(/- Existing Zen feature\./g)).toHaveLength(1);
	} finally {
		await fs.rm(repoRoot, { recursive: true, force: true });
	}
});

it("rebuilds workspace aliases after applying Zen publish identities", async () => {
	const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zen-publish-worktree-"));
	const publicPackageDir = path.join(repoRoot, "packages/public");
	const privatePackageDir = path.join(repoRoot, "packages/private-build");
	const privateSourcePath = path.join(privatePackageDir, "src/index.ts");

	try {
		await Promise.all([
			Bun.write(
				path.join(repoRoot, "package.json"),
				`${JSON.stringify(
					{
						private: true,
						type: "module",
						workspaces: {
							packages: ["packages/*"],
							catalog: { "@oh-my-pi/public": "1.0.0" },
						},
					},
					null,
					2,
				)}\n`,
			),
			Bun.write(
				path.join(publicPackageDir, "package.json"),
				`${JSON.stringify(
					{ name: "@oh-my-pi/public", version: "1.0.0", type: "module", main: "./src/index.ts" },
					null,
					2,
				)}\n`,
			),
			Bun.write(path.join(publicPackageDir, "src/index.ts"), "export const value = 42;\n"),
			Bun.write(
				path.join(privatePackageDir, "package.json"),
				`${JSON.stringify(
					{
						name: "@oh-my-pi/private-build",
						version: "1.0.0",
						private: true,
						type: "module",
						dependencies: { "@oh-my-pi/public": "catalog:" },
					},
					null,
					2,
				)}\n`,
			),
			Bun.write(
				privateSourcePath,
				'import { value } from "@oh-my-pi/public";\nif (value !== 42) throw new Error("bad workspace value");\n',
			),
		]);
		await $`bun install`.cwd(repoRoot).quiet();

		const changed = await preparePublishWorktree({ repoRoot });
		const probe = await $`bun src/index.ts`.cwd(privatePackageDir).nothrow();

		expect(probe.exitCode).toBe(0);
		expect(await Bun.file(privateSourcePath).text()).toContain("@oh-my-pi-zen/public");
		expect(changed).toContain("packages/private-build/src/index.ts");
	} finally {
		await fs.rm(repoRoot, { recursive: true, force: true });
	}
});
