#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

interface Manifest {
	version: string;
}

const args = new Set(Bun.argv.slice(2));
const skipBuild = args.has("--skip-build");
const rootDir = path.resolve(import.meta.dir, "../..");
const codingAgentDir = path.join(rootDir, "packages/coding-agent");
const nativeDir = path.join(rootDir, "packages/natives");
const outputBinary = path.join(codingAgentDir, "dist/omp");
const bunInstall = Bun.env.BUN_INSTALL ?? path.join(os.homedir(), ".bun");
const binDir = path.join(bunInstall, "bin");
const backupDir = path.join(binDir, "omp-backups");
const targets = ["omp", "omp-zen"] as const;

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function runStep(label: string, command: readonly string[], cwd = rootDir): Promise<void> {
	console.log(label);
	const proc = Bun.spawn(command, {
		cwd,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) throw new Error(`${label} failed with exit code ${exitCode}`);
}

async function currentVersion(targetPath: string): Promise<string> {
	if (!(await exists(targetPath))) return "missing";
	const proc = Bun.spawn([targetPath, "--version"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
	if (exitCode !== 0) return "unknown";
	return stdout.trim().replace(/[^A-Za-z0-9._-]+/g, "_") || "unknown";
}

async function installTarget(name: (typeof targets)[number]): Promise<void> {
	const targetPath = path.join(binDir, name);
	await fs.mkdir(backupDir, { recursive: true });
	if (await exists(targetPath)) {
		const version = await currentVersion(targetPath);
		const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
		const backupPath = path.join(backupDir, `${name}-${version}-${timestamp}`);
		await fs.copyFile(targetPath, backupPath);
		await fs.chmod(backupPath, 0o755);
		console.log(`  backed up ${targetPath} -> ${backupPath}`);
	}

	const tempPath = path.join(binDir, `.${name}.tmp-${process.pid}`);
	await Bun.write(tempPath, Bun.file(outputBinary));
	await fs.chmod(tempPath, 0o755);
	await fs.rename(tempPath, targetPath);
	console.log(`  installed ${targetPath}`);
}

async function smokeTarget(name: (typeof targets)[number]): Promise<void> {
	const targetPath = path.join(binDir, name);
	await runStep(`Smoke ${name} --version`, [targetPath, "--version"]);
	await runStep(`Smoke ${name} --smoke-test`, [targetPath, "--smoke-test"]);
}

async function clearNativeCache(): Promise<void> {
	const manifest = (await Bun.file(path.join(codingAgentDir, "package.json")).json()) as Manifest;
	const cachePath = path.join(os.homedir(), ".omp/natives", manifest.version);
	await fs.rm(cachePath, { recursive: true, force: true });
	console.log(`  cleared ${cachePath}`);
}

if (!skipBuild) {
	await runStep("Building natives", ["bun", "run", "build"], nativeDir);
	await runStep("Building coding agent", ["bun", "run", "build"], codingAgentDir);
}

if (!(await exists(outputBinary))) {
	throw new Error(`Missing built binary: ${outputBinary}`);
}

await fs.mkdir(binDir, { recursive: true });
for (const target of targets) {
	await installTarget(target);
}
await clearNativeCache();
for (const target of targets) {
	await smokeTarget(target);
}

console.log("Zen local install complete.");
