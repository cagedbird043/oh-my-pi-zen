#!/usr/bin/env bun

import { $ } from "bun";

const UPSTREAM_REPO = "https://github.com/can1357/oh-my-pi";
const RELEASE_ARTIFACTS = ["omp-zen-linux-x64", "omp-zen-linux-arm64", "omp-zen-darwin-arm64"] as const;

export interface ZenReleaseTag {
	version: string;
	upstreamVersion: string;
	upstreamTag: string;
	upstreamReleaseUrl: string;
}

export function parseZenReleaseTag(tag: string): ZenReleaseTag {
	const normalized = tag.trim();
	const match = normalized.match(/^zen\/v(\d+\.\d+\.\d+)-zen\.\d+$/);
	if (!match) throw new Error(`Invalid Zen release tag: ${tag}`);
	const upstreamVersion = match[1];
	const version = normalized.slice("zen/v".length);
	const upstreamTag = `v${upstreamVersion}`;
	return {
		version,
		upstreamVersion,
		upstreamTag,
		upstreamReleaseUrl: `${UPSTREAM_REPO}/releases/tag/${upstreamTag}`,
	};
}

export function filterDownstreamSubjects(subjects: readonly string[]): string[] {
	const seen = new Set<string>();
	const filtered: string[] = [];
	for (const rawSubject of subjects) {
		const subject = rawSubject.trim();
		if (!subject) continue;
		if (subject.startsWith("Merge ")) continue;
		if (/^chore\(zen\): bump version to \d+\.\d+\.\d+-zen\.\d+$/.test(subject)) continue;
		if (seen.has(subject)) continue;
		seen.add(subject);
		filtered.push(subject);
	}
	return filtered;
}

export function renderZenReleaseNotes(tag: ZenReleaseTag, subjects: readonly string[]): string {
	const lines = [
		`# oh-my-pi-zen ${tag.version}`,
		"",
		`Based on [Oh My Pi ${tag.upstreamVersion}](${tag.upstreamReleaseUrl}).`,
		"",
		"Applies following downstream changes:",
		"",
	];
	const filteredSubjects = filterDownstreamSubjects(subjects);
	if (filteredSubjects.length === 0) {
		lines.push("- No downstream changes beyond release packaging.");
	} else {
		for (const subject of filteredSubjects) lines.push(`- \`${subject}\``);
	}
	lines.push("", "Artifacts:", "");
	for (const artifact of RELEASE_ARTIFACTS) lines.push(`- \`${artifact}\``);
	lines.push("");
	return `${lines.join("\n")}\n`;
}

async function ensureUpstreamTag(tag: string): Promise<void> {
	const exists = await $`git rev-parse --verify ${tag}`.quiet().nothrow();
	if (exists.exitCode === 0) return;
	await $`git fetch --no-tags ${UPSTREAM_REPO}.git refs/tags/${tag}:refs/tags/${tag}`;
}

async function downstreamSubjects(upstreamTag: string): Promise<string[]> {
	await ensureUpstreamTag(upstreamTag);
	const output = await $`git log --format=%s ${upstreamTag}..HEAD --reverse`.text();
	return output.split("\n");
}

async function main(argv: readonly string[]): Promise<void> {
	const tagArg = argv[2];
	if (!tagArg) throw new Error("Usage: bun scripts/zen/release-notes.ts zen/vX.Y.Z-zen.N [output.md]");
	const outputPath = argv[3] ?? "release-notes.md";
	const tag = parseZenReleaseTag(tagArg);
	const subjects = await downstreamSubjects(tag.upstreamTag);
	await Bun.write(outputPath, renderZenReleaseNotes(tag, subjects));
}

if (import.meta.main) {
	await main(Bun.argv);
}
