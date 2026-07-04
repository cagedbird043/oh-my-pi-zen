import { describe, expect, it } from "bun:test";
import { filterDownstreamSubjects, parseZenReleaseTag, renderZenReleaseNotes } from "./release-notes";

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

describe("filterDownstreamSubjects", () => {
	it("should filter out zen bump commits while keeping other downstream subjects", () => {
		const input = [
			"chore(zen): bump version to 16.3.6-zen.2",
			"feat(web-search): add AnySearch provider support",
			"chore(zen): bump version to 16.3.6-zen.1",
			"fix(gemini): suppress CCA thinking summaries by default",
			"chore(zen): perform other non-bump task",
		];
		const expected = [
			"feat(web-search): add AnySearch provider support",
			"fix(gemini): suppress CCA thinking summaries by default",
			"chore(zen): perform other non-bump task",
		];
		expect(filterDownstreamSubjects(input)).toEqual(expected);
	});
});

describe("renderZenReleaseNotes", () => {
	it("should render release notes matching the expected markdown format", () => {
		const tag = parseZenReleaseTag("zen/v16.3.6-zen.2");
		const subjects = [
			"chore(zen): bump version to 16.3.6-zen.2",
			"feat(web-search): add AnySearch provider support",
			"fix(gemini): suppress CCA thinking summaries by default",
		];

		const markdown = renderZenReleaseNotes(tag, subjects);

		// Verify title
		expect(markdown).toContain("# oh-my-pi-zen 16.3.6-zen.2");

		// Verify linked upstream release URL
		expect(markdown).toContain("https://github.com/can1357/oh-my-pi/releases/tag/v16.3.6");
		expect(markdown).toContain("[Oh My Pi 16.3.6](https://github.com/can1357/oh-my-pi/releases/tag/v16.3.6)");

		// Verify filtered downstream subjects
		expect(markdown).toContain("- `feat(web-search): add AnySearch provider support`");
		expect(markdown).toContain("- `fix(gemini): suppress CCA thinking summaries by default`");
		expect(markdown).not.toContain("bump version to");

		// Verify artifact bullets
		expect(markdown).toContain("Artifacts:");
		expect(markdown).toContain("- `omp-zen-linux-x64`");
		expect(markdown).toContain("- `omp-zen-linux-arm64`");
		expect(markdown).toContain("- `omp-zen-darwin-arm64`");

		// Ensure no Install section and no upstream package headings
		expect(markdown.toLowerCase()).not.toContain("install");
		expect(markdown).not.toContain("## @oh-my-pi/");

		// Exact match assertion to ensure structural integrity
		const expectedMarkdown = [
			"# oh-my-pi-zen 16.3.6-zen.2",
			"",
			"Based on [Oh My Pi 16.3.6](https://github.com/can1357/oh-my-pi/releases/tag/v16.3.6).",
			"",
			"Applies following downstream changes:",
			"",
			"- `feat(web-search): add AnySearch provider support`",
			"- `fix(gemini): suppress CCA thinking summaries by default`",
			"",
			"Artifacts:",
			"",
			"- `omp-zen-linux-x64`",
			"- `omp-zen-linux-arm64`",
			"- `omp-zen-darwin-arm64`",
			"",
			"",
		].join("\n");

		expect(markdown).toBe(expectedMarkdown);
	});
});
