#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { rewriteZenPackageText } from "./package-map";

const repoRoot = path.join(import.meta.dir, "..", "..");
const isDryRun = process.argv.includes("--dry-run");
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

async function* packageFiles(): AsyncGenerator<string> {
	const packagesDir = path.join(repoRoot, "packages");
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

async function rewriteFile(filePath: string): Promise<boolean> {
	const original = await Bun.file(filePath).text();
	const rewritten = rewriteZenPackageText(original);
	if (rewritten === original) return false;
	if (!isDryRun) await Bun.write(filePath, rewritten);
	return true;
}

async function main(): Promise<void> {
	const candidates: string[] = [];
	for (const file of rootFiles) {
		candidates.push(path.join(repoRoot, file));
	}
	for await (const file of packageFiles()) {
		candidates.push(file);
	}

	const changed: string[] = [];
	for (const file of candidates) {
		if (await rewriteFile(file)) changed.push(path.relative(repoRoot, file));
	}

	const action = isDryRun ? "Would rewrite" : "Rewrote";
	console.log(`${action} ${changed.length} file(s) for Zen publish identity`);
	for (const file of changed) console.log(`  ${file}`);
}

await main();
