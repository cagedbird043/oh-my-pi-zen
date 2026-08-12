import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { VERSION } from "@oh-my-pi/pi-utils";
import type { BunPlugin } from "bun";
import { resolveBundledChangelogPath } from "../../src/utils/changelog";

interface HeapProbeResult {
	retainedChangelogStrings: number;
}

interface BundleProbeResult {
	version: string;
	entries: number;
}

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..", "..");
const RELEASE_BASE_VERSION = VERSION.replace(/[-+].*$/, "");
const heapProbePath = path.resolve(import.meta.dir, "..", "fixtures", "changelog-static-import-heap-probe.ts");
const bundleProbePath = path.resolve(import.meta.dir, "..", "fixtures", "changelog-bundle-fallback-probe.ts");
const utilsStubPath = path.resolve(import.meta.dir, "..", "fixtures", "changelog-utils-stub.ts");

async function runProbe<T>(command: string[], cwd?: string): Promise<T> {
	const outputPath = path.join(os.tmpdir(), `omp-changelog-probe-${Bun.randomUUIDv7()}.json`);
	try {
		const proc = Bun.spawnSync(command, {
			cwd,
			env: { ...process.env, OMP_TEST_OUTPUT: outputPath },
			stderr: "pipe",
			stdout: "pipe",
		});
		const stderr = proc.stderr.toString();
		expect(proc.exitCode, stderr).toBe(0);
		return JSON.parse(await fs.readFile(outputPath, "utf8")) as T;
	} finally {
		await fs.rm(outputPath, { force: true });
	}
}

/**
 * Swap `@oh-my-pi/pi-utils` and the changelog module's `../config` import for a
 * dependency-free stub. Both pull the native addon loader into the bundle graph, and
 * that loader resolves `pi_natives.<platform>.node` relative to the emitted artifact,
 * so any probe written outside the repo fails to start. The subject under test is
 * emitted-asset resolution, not native loading.
 */
function changelogUtilsStubPlugin(): BunPlugin {
	return {
		name: "changelog-utils-stub",
		setup(build) {
			build.onResolve({ filter: /^@oh-my-pi\/pi-utils$/ }, () => ({ path: utilsStubPath }));
			build.onResolve({ filter: /^\.\.\/config$/ }, args =>
				args.importer.endsWith("/utils/changelog.ts") ? { path: utilsStubPath } : undefined,
			);
		},
	};
}

describe("bundled changelog asset path resolution", () => {
	const moduleUrl = new URL("file:///opt/omp/dist/cli.js");

	test.each([
		["Windows drive-letter", String.raw`C:\omp\dist\CHANGELOG.md`],
		["Windows UNC", String.raw`\\server\share\omp\CHANGELOG.md`],
		["POSIX", "/opt/omp/dist/CHANGELOG.md"],
	])("preserves an absolute %s path", (_kind, nativePath) => {
		expect(resolveBundledChangelogPath(nativePath, moduleUrl)).toBe(nativePath);
	});

	test("resolves a relative emitted asset against the module", () => {
		expect(resolveBundledChangelogPath("./CHANGELOG-hash.md", moduleUrl)).toEqual(
			new URL("./CHANGELOG-hash.md", moduleUrl),
		);
	});
});

describe("changelog static import resources", () => {
	test("does not retain the multi-megabyte changelog text before parsing", async () => {
		const result = await runProbe<HeapProbeResult>([process.execPath, heapProbePath]);
		expect(result).toEqual({ retainedChangelogStrings: 0 });
	}, 30_000);

	test("reads the emitted changelog asset when run outside the bundle directory", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-changelog-bundle-"));
		try {
			const bundleDir = path.join(tempDir, "bundle");
			const unrelatedCwd = path.join(tempDir, "cwd");
			const missingPackageChangelogPath = path.join(tempDir, "missing-package", "CHANGELOG.md");
			await fs.mkdir(unrelatedCwd);
			const sourceResult = await runProbe<BundleProbeResult>([
				process.execPath,
				bundleProbePath,
				missingPackageChangelogPath,
			]);

			const buildOutput = await Bun.build({
				entrypoints: [bundleProbePath],
				outdir: bundleDir,
				target: "bun",
				external: ["omp-legacy-pi-modules"],
				plugins: [changelogUtilsStubPlugin()],
			});
			expect(buildOutput.success, buildOutput.logs.map(log => log.message).join("\n")).toBe(true);

			const outputs = await fs.readdir(bundleDir);
			expect(outputs.some(output => output.endsWith(".md"))).toBe(true);
			const bundleFilename = outputs.find(output => output.endsWith(".js"));
			if (!bundleFilename) throw new Error("Changelog bundle build did not emit an entrypoint");
			const result = await runProbe<BundleProbeResult>(
				[process.execPath, path.join(bundleDir, bundleFilename), missingPackageChangelogPath],
				unrelatedCwd,
			);
			expect(result.version).toBe(RELEASE_BASE_VERSION);
			expect(result.entries).toBe(sourceResult.entries);
		} finally {
			await fs.rm(tempDir, { force: true, recursive: true });
		}
	}, 30_000);

	test("reads the emitted changelog asset from a compiled binary", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-changelog-compiled-"));
		try {
			const binaryPath = path.join(tempDir, "changelog-probe");
			const unrelatedCwd = path.join(tempDir, "cwd");
			const missingPackageChangelogPath = path.join(tempDir, "missing-package", "CHANGELOG.md");
			await fs.mkdir(unrelatedCwd);
			const sourceResult = await runProbe<BundleProbeResult>([
				process.execPath,
				bundleProbePath,
				missingPackageChangelogPath,
			]);

			const buildOutput = await Bun.build({
				entrypoints: [bundleProbePath],
				root: repoRoot,
				external: ["omp-legacy-pi-modules"],
				plugins: [changelogUtilsStubPlugin()],
				compile: {
					outfile: binaryPath,
					autoloadBunfig: false,
					autoloadDotenv: false,
					autoloadTsconfig: false,
					autoloadPackageJson: false,
				},
			});
			expect(buildOutput.success, buildOutput.logs.map(log => log.message).join("\n")).toBe(true);

			const result = await runProbe<BundleProbeResult>([binaryPath, missingPackageChangelogPath], unrelatedCwd);
			expect(result.version).toBe(RELEASE_BASE_VERSION);
			expect(result.entries).toBe(sourceResult.entries);
		} finally {
			await fs.rm(tempDir, { force: true, recursive: true });
		}
	}, 30_000);
});
