import { describe, expect, it } from "bun:test";
import { extractChangelogSection, parseZenReleaseTag, renderZenReleaseNotes } from "./release-notes";

describe("parseZenReleaseTag", () => {
	it("should parse a valid Zen release tag with 'v'", () => {
		const result = parseZenReleaseTag("zen/v16.3.6-zen.2");
		expect(result).toEqual({
			version: "16.3.6-zen.2",
			upstreamVersion: "16.3.6",
			upstreamTag: "v16.3.6",
			upstreamReleaseUrl: "https://github.com/can1357/oh-my-pi/releases/tag/v16.3.6",
		});
	});

	it("should throw for invalid tag formats", () => {
		expect(() => parseZenReleaseTag("zen/16.3.6-zen.2")).toThrow();
		expect(() => parseZenReleaseTag("v16.3.6-zen.2")).toThrow();
		expect(() => parseZenReleaseTag("zen/v16.3-zen.2")).toThrow();
		expect(() => parseZenReleaseTag("zen/v16.3.6")).toThrow();
		expect(() => parseZenReleaseTag("zen/v16.3.6-zen.")).toThrow();
		expect(() => parseZenReleaseTag("")).toThrow();
	});
});

describe("extractChangelogSection", () => {
	it("extracts the requested released section without adjacent versions", () => {
		const changelog = [
			"# Changelog",
			"",
			"## [Unreleased]",
			"",
			"## [16.3.6-zen.3] - 2026-07-04",
			"",
			"### Added",
			"",
			"- Added ordered model role chains.",
			"",
			"### Fixed",
			"",
			"- Fixed Zen update checks.",
			"",
			"## [16.3.6] - 2026-07-04",
			"",
			"### Fixed",
			"",
			"- Upstream entry.",
		].join("\n");

		expect(extractChangelogSection(changelog, "16.3.6-zen.3")).toBe(
			[
				"### Added",
				"",
				"- Added ordered model role chains.",
				"",
				"### Fixed",
				"",
				"- Fixed Zen update checks.",
			].join("\n"),
		);
		expect(extractChangelogSection(changelog, "16.3.6-zen.2")).toBeUndefined();
	});
});

describe("renderZenReleaseNotes", () => {
	it("renders package changelog sections without commit subjects or artifact lists", () => {
		const tag = parseZenReleaseTag("zen/v16.3.6-zen.3");
		const markdown = renderZenReleaseNotes(tag, [
			{
				packageName: "@oh-my-pi-zen/pi-ai",
				body: ["### Fixed", "", "- Fixed quota insufficient errors."].join("\n"),
			},
			{
				packageName: "@oh-my-pi-zen/pi-coding-agent",
				body: ["### Added", "", "- Added ordered model role chains."].join("\n"),
			},
		]);

		const expectedMarkdown = [
			"Based on [Oh My Pi 16.3.6](https://github.com/can1357/oh-my-pi/releases/tag/v16.3.6).",
			"",
			"## @oh-my-pi-zen/pi-ai",
			"",
			"### Fixed",
			"",
			"- Fixed quota insufficient errors.",
			"",
			"## @oh-my-pi-zen/pi-coding-agent",
			"",
			"### Added",
			"",
			"- Added ordered model role chains.",
			"",
			"",
		].join("\n");

		expect(markdown).toBe(expectedMarkdown);
		expect(markdown).not.toContain("Artifacts:");
		expect(markdown).not.toContain("chore(zen):");
	});
});
