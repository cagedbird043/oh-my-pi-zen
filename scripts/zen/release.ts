#!/usr/bin/env bun

import { $, Glob } from "bun";
import { runChangelogFixer } from "../fix-changelogs";

const changelogGlob = new Glob("packages/*/CHANGELOG.md");
const packageJsonGlob = new Glob("packages/*/package.json");
const cargoTomlGlob = new Glob("crates/*/Cargo.toml");
const zenVersionPattern = /^\d+\.\d+\.\d+-zen\.\d+$/;

function git(args: readonly string[], cwd = ".") {
	return $`git -c core.fsmonitor=false -c core.untrackedCache=false -c fetch.pruneTags=false ${args}`.cwd(cwd);
}

async function watchCI(): Promise<boolean> {
	const commitSha = (await git(["rev-parse", "HEAD"]).text()).trim();
	console.log(`  Commit: ${commitSha.slice(0, 8)}`);

	while (true) {
		const runsOutput = await $`gh run list --commit ${commitSha} --json databaseId,status,conclusion,name`.text();
		const runs: Array<{ databaseId: number; status: string; conclusion: string | null; name: string }> =
			JSON.parse(runsOutput);

		if (runs.length === 0) {
			console.log("  Waiting for CI to start...");
			await Bun.sleep(3000);
			continue;
		}

		const pending = runs.filter(run => run.status !== "completed");
		const failed = runs.filter(run => run.status === "completed" && run.conclusion !== "success");
		const passed = runs.filter(run => run.status === "completed" && run.conclusion === "success");
		console.log(`  ${passed.length} passed, ${pending.length} pending, ${failed.length} failed`);

		if (failed.length > 0) {
			for (const run of failed) console.error(`  - ${run.name}: ${run.conclusion}`);
			return false;
		}
		if (pending.length === 0) return true;
		await Bun.sleep(5000);
	}
}

function hasUnreleasedContent(content: string): boolean {
	const unreleasedMatch = content.match(/## \[Unreleased\]\s*\n([\s\S]*?)(?=## \[\d|$)/);
	if (!unreleasedMatch) return false;
	return unreleasedMatch[1].trim().length > 0;
}

function removeEmptyVersionEntries(content: string): string {
	return content.replace(/## \[\d+\.\d+\.\d+(?:-[^\]]+)?\] - \d{4}-\d{2}-\d{2}\s*\n(?=## \[|\s*$)/g, "");
}

async function updateChangelogsForRelease(version: string): Promise<void> {
	const date = new Date().toISOString().split("T")[0];
	for await (const changelog of changelogGlob.scan(".")) {
		let content = await Bun.file(changelog).text();
		if (!content.includes("## [Unreleased]")) continue;
		if (hasUnreleasedContent(content)) {
			content = content.replace("## [Unreleased]", `## [${version}] - ${date}`);
			content = content.replace(/^(# Changelog\n\n)/, `$1## [Unreleased]\n\n`);
		}
		content = removeEmptyVersionEntries(content);
		await Bun.write(changelog, content);
		console.log(`  Updated ${changelog}`);
	}
}

function parseZenVersion(version: string): { major: number; minor: number; patch: number; zen: number } {
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)-zen\.(\d+)$/);
	if (!match) throw new Error(`Invalid Zen version: ${version}`);
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		zen: Number(match[4]),
	};
}

function compareZenVersions(a: string, b: string): number {
	const parsedA = parseZenVersion(a);
	const parsedB = parseZenVersion(b);
	return (
		parsedA.major - parsedB.major ||
		parsedA.minor - parsedB.minor ||
		parsedA.patch - parsedB.patch ||
		parsedA.zen - parsedB.zen
	);
}

async function currentUpstreamBaseVersion(): Promise<string> {
	const manifest = (await Bun.file("packages/coding-agent/package.json").json()) as { version: string };
	return manifest.version.replace(/-zen\.\d+$/, "");
}

async function nextZenVersion(): Promise<string> {
	const baseVersion = await currentUpstreamBaseVersion();
	const tagsOutput = await git(["tag", "--list", `zen/v${baseVersion}-zen.*`]).text();
	let next = 1;
	for (const tag of tagsOutput
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean)) {
		const match = tag.match(/-zen\.(\d+)$/);
		if (match) next = Math.max(next, Number(match[1]) + 1);
	}
	return `${baseVersion}-zen.${next}`;
}

export async function latestZenReleaseTag(repoRoot: string): Promise<string | undefined> {
	return (await git(["tag", "--list", "zen/v*-zen.*", "--sort=-v:refname"], repoRoot).text())
		.split(/\r?\n/)
		.map(line => line.trim())
		.find(Boolean);
}

export async function runZenChangelogFixer(repoRoot: string) {
	const previousZenTag = await latestZenReleaseTag(repoRoot);
	return runChangelogFixer({ repoRoot, since: previousZenTag });
}

async function updateJsonVersion(filePath: string, version: string): Promise<{ name?: string; private?: boolean }> {
	const manifest = (await Bun.file(filePath).json()) as { name?: string; private?: boolean; version?: string };
	manifest.version = version;
	await Bun.write(filePath, `${JSON.stringify(manifest, null, "  ")}\n`);
	return { name: manifest.name, private: manifest.private };
}

async function updateRootCatalogVersions(version: string): Promise<void> {
	const manifest = (await Bun.file("package.json").json()) as {
		workspaces?: { catalog?: Record<string, unknown> };
	};
	const catalog = manifest.workspaces?.catalog;
	if (!catalog) throw new Error("Root package.json has no workspaces.catalog");
	for (const key of Object.keys(catalog)) {
		if (key.startsWith("@oh-my-pi/")) catalog[key] = version;
	}
	await Bun.write("package.json", `${JSON.stringify(manifest, null, "  ")}\n`);
}

async function updateRustWorkspaceVersion(version: string): Promise<void> {
	let cargoToml = await Bun.file("Cargo.toml").text();
	cargoToml = cargoToml.replace(/(^\[workspace\.package\][\s\S]*?^version = ")[^"]+("\s*$)/m, `$1${version}$2`);
	await Bun.write("Cargo.toml", cargoToml);
	for await (const cargoPath of cargoTomlGlob.scan(".")) {
		const content = await Bun.file(cargoPath).text();
		if (content.includes("version.workspace = true")) {
			const nameMatch = content.match(/^name = "([^"]+)"/m);
			if (nameMatch) console.log(`  ${nameMatch[1]}: ${version} (workspace)`);
		}
	}
}

async function updateNativeSentinel(version: string): Promise<void> {
	const sentinelName = `__piNativesV${version.replace(/[^A-Za-z0-9]/g, "_")}`;
	const files = [
		"crates/pi-natives/src/lib.rs",
		"packages/natives/native/index.d.ts",
		"packages/natives/native/index.js",
	];
	for (const file of files) {
		const original = await Bun.file(file).text();
		await Bun.write(file, original.replace(/__piNativesV[A-Za-z0-9_]+/g, sentinelName));
	}
	const libRs = await Bun.file("crates/pi-natives/src/lib.rs").text();
	if (!libRs.includes(`js_name = "${sentinelName}"`)) {
		throw new Error(`pi-natives version sentinel did not move to ${sentinelName}`);
	}
	console.log(`  sentinel: ${sentinelName}`);
}

async function cmdRelease(versionArg: string, options: { watchCi: boolean }): Promise<void> {
	const version = versionArg === "next" ? await nextZenVersion() : versionArg;
	if (!zenVersionPattern.test(version)) throw new Error(`Zen version must look like 16.3.6-zen.1, got ${version}`);

	const branch = (await git(["branch", "--show-current"]).text()).trim();
	if (branch !== "zen/main") throw new Error(`Must be on zen/main branch, currently on ${branch}`);
	const status = await git(["status", "--porcelain"]).text();
	if (status.trim()) throw new Error(`Uncommitted changes detected:\n${status}`);

	const tagName = `zen/v${version}`;
	const existingTag = await git(["tag", "--list", tagName]).text();
	if (existingTag.trim()) throw new Error(`Tag already exists: ${tagName}`);
	const latestMatchingTag = await latestZenReleaseTag(".");
	if (latestMatchingTag) {
		const latestVersion = latestMatchingTag.replace(/^zen\/v/, "");
		if (compareZenVersions(version, latestVersion) <= 0) {
			throw new Error(`Version ${version} must be greater than latest Zen tag ${latestMatchingTag}`);
		}
	}

	console.log(`Updating public package versions to ${version}...`);
	const pkgJsonPaths = await Array.fromAsync(packageJsonGlob.scan("."));
	for (const pkgPath of pkgJsonPaths) {
		const manifest = (await Bun.file(pkgPath).json()) as { name?: string; private?: boolean };
		if (manifest.private) {
			console.log(`  Skipping ${manifest.name ?? pkgPath} (private)`);
			continue;
		}
		const updated = await updateJsonVersion(pkgPath, version);
		console.log(`  ${updated.name ?? pkgPath}: ${version}`);
	}
	await updateRootCatalogVersions(version);

	console.log(`Updating Rust workspace version to ${version}...`);
	await updateRustWorkspaceVersion(version);

	console.log(`Bumping pi-natives version sentinel to ${version}...`);
	await updateNativeSentinel(version);

	console.log("Regenerating lockfiles...");
	await $`rm -f bun.lock`;
	await $`bun install`;
	await $`cargo generate-lockfile`;

	console.log("Updating CHANGELOGs...");
	const fixResult = await runZenChangelogFixer(".");
	for (const fixed of fixResult.changedFiles) {
		console.log(`  Fixed ${fixed.path}`);
	}
	await updateChangelogsForRelease(version);

	console.log("Running checks...");
	await $`bun run check`;

	console.log("Committing...");
	await git(["add", "."]);
	await git(["commit", "-m", `chore(zen): bump version to ${version}`]);

	console.log("Tagging and pushing to remote...");
	const sha = (await git(["rev-parse", "HEAD"]).text()).trim();
	await git(["tag", "-f", tagName]);
	await git(["push", "--atomic", "origin", "refs/heads/zen/main:refs/heads/zen/main", `${sha}:refs/tags/${tagName}`]);

	if (options.watchCi) {
		console.log("Watching CI...");
		const success = await watchCI();
		if (!success) process.exit(1);
	} else {
		console.log("Skipping CI watch (--no-watch).");
	}
	console.log(`=== Released ${tagName} ===`);
}

async function cmdWatch(): Promise<void> {
	const success = await watchCI();
	process.exit(success ? 0 : 1);
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
	const arg = args[0];
	const watchCi = !args.includes("--no-watch");
	if (!arg) {
		console.error("Usage:");
		console.error("  bun scripts/zen/release.ts <version|next> [--no-watch]   Full Zen release");
		console.error("  bun scripts/zen/release.ts watch                         Watch CI for current commit");
		process.exit(1);
	}

	if (arg === "watch") {
		await cmdWatch();
	} else {
		await cmdRelease(arg, { watchCi });
	}
}

if (import.meta.main) {
	await main();
}
