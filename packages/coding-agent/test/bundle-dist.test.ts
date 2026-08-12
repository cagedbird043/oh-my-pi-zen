import { describe, expect, it } from "bun:test";
import { runtimeExternalPackages } from "../scripts/bundle-dist";

describe("npm CLI bundle dependency policy", () => {
	it("bundles dependencies patched by the workspace", () => {
		expect(
			runtimeExternalPackages({
				"puppeteer-core@25.3.0": "patches/puppeteer-core@25.3.0.patch",
			}),
		).toEqual(["@babel/parser"]);
	});

	it("externalizes unpatched runtime dependencies", () => {
		expect(runtimeExternalPackages({})).toEqual(["puppeteer-core", "@babel/parser"]);
	});
});
