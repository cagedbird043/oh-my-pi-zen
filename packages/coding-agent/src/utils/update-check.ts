import { withTimeoutSignal } from "./fetch-timeout";

const UPSTREAM_PACKAGE = "@oh-my-pi/pi-coding-agent";
const ZEN_PACKAGE = "@oh-my-pi-zen/pi-coding-agent";

interface NpmLatestResponse {
	version?: string;
}

export function isZenVersion(version: string): boolean {
	return /-zen\.\d+(?:$|[+.-])/.test(version);
}

export function getUpdatePackageName(currentVersion: string): string {
	return isZenVersion(currentVersion) ? ZEN_PACKAGE : UPSTREAM_PACKAGE;
}

export function shouldNotifyNewVersion(currentVersion: string, latestVersion: string | undefined): boolean {
	if (!latestVersion) return false;
	if (isZenVersion(currentVersion) !== isZenVersion(latestVersion)) return false;
	return Bun.semver.order(latestVersion, currentVersion) > 0;
}

export async function checkForNewVersion(currentVersion: string): Promise<string | undefined> {
	try {
		const packageName = getUpdatePackageName(currentVersion);
		const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
			signal: withTimeoutSignal(5_000),
		});
		if (!response.ok) return undefined;

		const data = (await response.json()) as NpmLatestResponse;
		return shouldNotifyNewVersion(currentVersion, data.version) ? data.version : undefined;
	} catch {
		return undefined;
	}
}
