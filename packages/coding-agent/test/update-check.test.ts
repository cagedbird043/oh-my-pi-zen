import { describe, expect, test } from "bun:test";
import { getUpdatePackageName, shouldNotifyNewVersion } from "@oh-my-pi/pi-coding-agent/utils/update-check";

describe("startup update checks", () => {
	test("uses the Zen npm package for Zen prerelease builds", () => {
		expect(getUpdatePackageName("16.3.6-zen.2")).toBe("@oh-my-pi-zen/pi-coding-agent");
		expect(getUpdatePackageName("16.3.6")).toBe("@oh-my-pi/pi-coding-agent");
	});

	test("does not compare Zen prereleases against upstream stable releases", () => {
		expect(shouldNotifyNewVersion("16.3.6-zen.2", "16.3.6")).toBe(false);
		expect(shouldNotifyNewVersion("16.3.6", "16.3.6-zen.2")).toBe(false);
	});

	test("notifies only for newer versions inside the active channel", () => {
		expect(shouldNotifyNewVersion("16.3.6-zen.2", "16.3.6-zen.3")).toBe(true);
		expect(shouldNotifyNewVersion("16.3.6-zen.2", "16.3.6-zen.2")).toBe(false);
		expect(shouldNotifyNewVersion("16.3.6", "16.3.7")).toBe(true);
		expect(shouldNotifyNewVersion("16.3.6", "16.3.6")).toBe(false);
	});
});
