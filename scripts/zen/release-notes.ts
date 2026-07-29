#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";

const UPSTREAM_REPO = "https://github.com/can1357/oh-my-pi";

export interface PackageReleaseNotes {
	packageName: string;
	body: string;
}

export interface ZenReleaseTag {
	version: string;
	upstreamVersion: string;
	zenPatch: number;
	upstreamTag: string;
	upstreamReleaseUrl: string;
}

export function parseZenReleaseTag(tag: string): ZenReleaseTag {
	const normalized = tag.trim();
	const match = normalized.match(/^zen\/v(\d+\.\d+\.\d+)-zen\.(\d+)$/);
	if (!match) throw new Error(`Invalid Zen release tag: ${tag}`);
	const upstreamVersion = match[1];
	const zenPatch = Number.parseInt(match[2], 10);
	const version = normalized.slice("zen/v".length);
	const upstreamTag = `v${upstreamVersion}`;
	return {
		version,
		upstreamVersion,
		upstreamTag,
		zenPatch,
		upstreamReleaseUrl: `${UPSTREAM_REPO}/releases/tag/${upstreamTag}`,
	};
}

export function extractChangelogSection(changelog: string, version: string): string | undefined {
	const lines = changelog.split(/\r?\n/);
	const headerPattern = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\](?:\\s+-\\s+.*)?$`);
	const start = lines.findIndex(line => headerPattern.test(line.trim()));
	if (start < 0) return undefined;
	const body: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^## \[/.test(line)) break;
		body.push(line);
	}
	const trimmed = body.join("\n").trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function renderZenReleaseNotes(tag: ZenReleaseTag, packageNotes: readonly PackageReleaseNotes[]): string {
	if (tag.zenPatch === 1) {
		return `Rebased Zen on [Oh My Pi ${tag.upstreamVersion}](${tag.upstreamReleaseUrl}).\n`;
	}
	const lines = [`Based on [Oh My Pi ${tag.upstreamVersion}](${tag.upstreamReleaseUrl}).`, ""];
	const notes = packageNotes.filter(note => note.body.trim().length > 0);
	if (notes.length === 0) {
		lines.push("No downstream changelog entries for this release.", "");
		return `${lines.join("\n")}\n`;
	}
	for (const note of notes) {
		lines.push(`## ${note.packageName}`, "", note.body.trim(), "");
	}
	return `${lines.join("\n")}\n`;
}

async function collectPackageReleaseNotes(rootDir: string, version: string): Promise<PackageReleaseNotes[]> {
	const packagesDir = path.join(rootDir, "packages");
	const entries = await fs.readdir(packagesDir, { withFileTypes: true });
	const notes: PackageReleaseNotes[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const packageDir = path.join(packagesDir, entry.name);
		const changelogPath = path.join(packageDir, "CHANGELOG.md");
		const packageJsonPath = path.join(packageDir, "package.json");
		try {
			const [changelog, packageJson] = await Promise.all([
				Bun.file(changelogPath).text(),
				Bun.file(packageJsonPath).json() as Promise<{ name?: string }>,
			]);
			const body = extractChangelogSection(changelog, version);
			if (!body) continue;
			const sourceName = packageJson.name ?? `@oh-my-pi/${entry.name}`;
			const packageName = sourceName.replace("@oh-my-pi/", "@oh-my-pi-zen/");
			notes.push({ packageName, body });
		} catch (error) {
			if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
			throw error;
		}
	}
	return notes.sort((a, b) => a.packageName.localeCompare(b.packageName));
}

async function main(argv: readonly string[]): Promise<void> {
	const tagArg = argv[2];
	if (!tagArg) throw new Error("Usage: bun scripts/zen/release-notes.ts zen/vX.Y.Z-zen.N [output.md]");
	const tag = parseZenReleaseTag(tagArg);
	const outputPath = argv[3] ?? "release-notes.md";
	const packageNotes = await collectPackageReleaseNotes(process.cwd(), tag.version);
	await Bun.write(outputPath, renderZenReleaseNotes(tag, packageNotes));
}

if (import.meta.main) {
	await main(Bun.argv);
}
