import { VERSION } from "@oh-my-pi/pi-utils";
import { parseChangelog } from "../../src/utils/changelog";

const RELEASE_BASE_VERSION = VERSION.replace(/[-+].*$/, "");

const missingPackageChangelogPath = process.argv[2];
if (!missingPackageChangelogPath) {
	throw new Error("Expected a missing package changelog path argument");
}

const entries = await parseChangelog(missingPackageChangelogPath);
const latest = entries[0];
const version = latest ? `${latest.major}.${latest.minor}.${latest.patch}` : undefined;
if (version !== RELEASE_BASE_VERSION || !latest?.content.startsWith(`## [${RELEASE_BASE_VERSION}`)) {
	throw new Error(
		`Unexpected latest changelog release: ${JSON.stringify({ version, expected: RELEASE_BASE_VERSION })}`,
	);
}

const output = JSON.stringify({ version, entries: entries.length });
if (Bun.env.OMP_TEST_OUTPUT) await Bun.write(Bun.env.OMP_TEST_OUTPUT, output);
else process.stdout.write(output);
