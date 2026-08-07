import { describe, expect, it } from "bun:test";
import { nativeVersionFromExports } from "./native-version";

describe("native addon release sentinel", () => {
	it("normalizes stable and Zen prerelease sentinels", () => {
		expect(nativeVersionFromExports(["load", "__piNativesV17_2_6", "other"])).toBe("17.2.6");
		expect(nativeVersionFromExports(["load", "__piNativesV17_2_10_zen_1", "other"])).toBe("17.2.10-zen.1");
	});

	it("rejects missing or ambiguous sentinels", () => {
		expect(nativeVersionFromExports(["load"])).toBeUndefined();
		expect(nativeVersionFromExports(["__piNativesV17_2_6", "__piNativesV17_2_7"])).toBeUndefined();
	});
});
