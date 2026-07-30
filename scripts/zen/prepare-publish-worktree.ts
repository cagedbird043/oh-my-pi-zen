#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $ } from "bun";
import { rewriteZenPackageText } from "./package-map";

const repoRoot = path.join(import.meta.dir, "..", "..");
const isDryRun = process.argv.includes("--dry-run");

interface PreparePublishWorktreeOptions {
	repoRoot?: string;
	dryRun?: boolean;
}
const textExtensions: Record<string, true> = {
	".cjs": true,
	".cts": true,
	".js": true,
	".json": true,
	".jsx": true,
	".md": true,
	".mjs": true,
	".mts": true,
	".ts": true,
	".tsx": true,
	".yaml": true,
	".yml": true,
};
const rootFiles = ["package.json", "bun.lock"];
const packageRootFiles = ["package.json", "README.md", "CHANGELOG.md"];
const packageDirs = ["src", "scripts", "native", "dist"];
const ignoredDirs: Record<string, true> = { binaries: true, node_modules: true, npm: true };

async function* walk(dir: string): AsyncGenerator<string> {
	let entries: fs.Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
		throw err;
	}
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (ignoredDirs[entry.name]) continue;
			yield* walk(entryPath);
			continue;
		}
		if (entry.isFile() && textExtensions[path.extname(entryPath)]) yield entryPath;
	}
}

async function* packageFiles(targetRepoRoot: string): AsyncGenerator<string> {
	const packagesDir = path.join(targetRepoRoot, "packages");
	const entries = await fs.readdir(packagesDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const packageDir = path.join(packagesDir, entry.name);
		for (const file of packageRootFiles) {
			const filePath = path.join(packageDir, file);
			if (await Bun.file(filePath).exists()) yield filePath;
		}
		for (const dir of packageDirs) {
			for await (const file of walk(path.join(packageDir, dir))) {
				yield file;
			}
		}
	}
}

async function rewriteFile(filePath: string, dryRun: boolean): Promise<boolean> {
	const original = await Bun.file(filePath).text();
	const rewritten = rewriteZenPackageText(original);
	if (rewritten === original) return false;
	if (!dryRun) await Bun.write(filePath, rewritten);
	return true;
}

export async function preparePublishWorktree(options: PreparePublishWorktreeOptions = {}): Promise<string[]> {
	const targetRepoRoot = options.repoRoot ?? repoRoot;
	const dryRun = options.dryRun ?? isDryRun;
	const candidates: string[] = [];
	for (const file of rootFiles) {
		candidates.push(path.join(targetRepoRoot, file));
	}
	for await (const file of packageFiles(targetRepoRoot)) {
		candidates.push(file);
	}

	const changed: string[] = [];
	for (const file of candidates) {
		if (await rewriteFile(file, dryRun)) changed.push(path.relative(targetRepoRoot, file));
	}
	if (!dryRun) await $`bun install --frozen-lockfile`.cwd(targetRepoRoot).quiet();
	return changed;
}

async function main(): Promise<void> {
	const changed = await preparePublishWorktree();
	const action = isDryRun ? "Would rewrite" : "Rewrote";
	console.log(`${action} ${changed.length} file(s) for Zen publish identity`);
	for (const file of changed) console.log(`  ${file}`);
}

if (import.meta.main) await main();
