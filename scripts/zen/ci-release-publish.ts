#!/usr/bin/env bun

function nativeLeafArgs(argv: readonly string[]): string[] {
	const args: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		args.push(arg);
		if (arg === "--native-leaf") {
			const value = argv[i + 1];
			if (!value) throw new Error("--native-leaf requires a target tag");
			args.push(value);
			i++;
		}
	}
	return args;
}

async function run(command: string[], env: NodeJS.ProcessEnv = Bun.env): Promise<void> {
	const proc = Bun.spawn(command, { env, stdout: "inherit", stderr: "inherit" });
	const exitCode = await proc.exited;
	if (exitCode !== 0) throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`);
}

await run(["bun", "scripts/ci-release-publish.ts", ...nativeLeafArgs(process.argv.slice(2))], {
	...Bun.env,
	PI_CODING_AGENT_PUBLISH_BIN: "zen",
	PI_NPM_PACKAGE_SCOPE: "@oh-my-pi-zen",
	PI_REPOSITORY_URL: "git+https://github.com/cagedbird043/oh-my-pi-zen.git",
	PI_NPM_NATIVE_LEAF_TAGS: "linux-x64,linux-arm64,darwin-arm64",
	PI_NPM_DIST_TAG: "latest",
	PI_PACK_IGNORE_SCRIPTS: "true",
	PI_ZEN_REWRITE_BEFORE_PACK: "true",
});
