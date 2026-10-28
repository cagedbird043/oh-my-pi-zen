#!/usr/bin/env bun
/**
 * Release gate: bun scripts/zen/native-portability-smoke.ts <staging-directory>
 * Requires Linux x64 and a running Docker daemon; it never installs host packages.
 * Unpacks the actual npm tarballs, then exercises their loader and CLI in a clean
 * Ubuntu runtime with no host libraries, session sockets, network, or credentials.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { dlopen } from "bun:ffi";
import type { ReleasePlan } from "./release";

async function command(argv: string[], cwd?: string): Promise<string> {
	const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	assert.equal(code, 0, `${argv.join(" ")} exited ${code}\n${stdout}${stderr}`);
	return stdout;
}

async function assertNoPipeWire(): Promise<void> {
	// Inspect the real runtime filesystem, not source text or an LD_LIBRARY_PATH
	// override. The only host mounts are the staging tree, Bun, and this probe.
	async function inspect(dir: string): Promise<void> {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			assert.ok(
				!/^(?:libpipewire|libspa[.-]|spa-\d|pipewire-\d)/i.test(entry.name),
				`Unexpected runtime library: ${dir}/${entry.name}`,
			);
			if (entry.isDirectory()) await inspect(path.join(dir, entry.name));
		}
	}
	for (const dir of ["/usr/lib", "/usr/local/lib", "/lib", "/lib64", "/opt"]) await inspect(dir);
	for (const name of ["libpipewire-0.3.so.0", "libpipewire-0.3.so", "libspa-support.so", "libspa-dbus.so"]) {
		let failure: unknown;
		try {
			const library = dlopen(
				name,
				name.startsWith("libpipewire")
					? { pw_init: { args: ["ptr", "ptr"], returns: "void" } }
					: { spa_handle_factory_enum: { args: ["ptr", "ptr"], returns: "i32" } },
			);
			library.close();
		} catch (error) {
			failure = error;
		}
		assert.ok(failure, `${name} must not be loadable in the isolated runtime`);
		assert.match(String(failure), /(?:No such file|cannot open shared object)/i);
		console.log(`Unavailable in clean runtime: ${name}: ${failure}`);
	}
	assert.equal(process.env.LD_LIBRARY_PATH, undefined);
	assert.equal(process.env.LD_PRELOAD, undefined);
	console.log("Isolation verified: no PipeWire/SPA runtime files or loadable libraries");
}

async function inside(root: string): Promise<void> {
	await assertNoPipeWire();
	await fs.mkdir(process.env.XDG_RUNTIME_DIR!, { recursive: true, mode: 0o700 });
	const plan = (await Bun.file(path.join(root, "release-plan.json")).json()) as ReleasePlan;
	const install = "/tmp/zen-native-smoke";
	const modules = path.join(install, "node_modules");
	const scope = path.join(modules, "@oh-my-pi-zen");
	await fs.mkdir(scope, { recursive: true });
	const selected = new Set(["pi-natives", "pi-natives-linux-x64", "pi-coding-agent"]);
	// Preserve the stage's already-installed third-party dependencies without
	// installing anything or consulting the registry in the isolated runtime.
	for (const entry of await fs.readdir(path.join(root, "node_modules"))) {
		if (entry === "@oh-my-pi-zen") continue;
		await fs.symlink(path.join(root, "node_modules", entry), path.join(modules, entry));
	}
	for (const entry of await fs.readdir(path.join(root, "node_modules/@oh-my-pi-zen"))) {
		if (!selected.has(entry))
			await fs.symlink(path.join(root, "node_modules/@oh-my-pi-zen", entry), path.join(scope, entry));
	}
	for (const name of selected) {
		const pkg = plan.packages.find(pkg => pkg.name === `@oh-my-pi-zen/${name}`);
		assert.ok(pkg?.tarball, `Missing packed ${name}`);
		assert.equal(pkg.version, plan.version);
		const destination = path.join(scope, name);
		await fs.mkdir(destination);
		await command(["tar", "-xzf", path.join(root, pkg.tarball), "--strip-components=1", "-C", destination]);
	}
	const leaf = path.join(scope, "pi-natives-linux-x64");
	const addonFiles = (await fs.readdir(leaf)).filter(file => file.endsWith(".node"));
	assert.ok(addonFiles.length > 0, "Packed Linux leaf has no addon");
	for (const file of addonFiles) {
		const dynamic = await command(["readelf", "-d", path.join(leaf, file)]);
		const needed = [...dynamic.matchAll(/\(NEEDED\).*?\[([^\]]+)\]/g)].map(match => match[1]!);
		assert.ok(needed.length > 0, `No DT_NEEDED entries found in ${file}`);
		assert.ok(
			!needed.some(name => /pipewire|(?:^|lib)spa(?:[.-]|$)/i.test(name)),
			`${file} has forbidden DT_NEEDED: ${needed.join(", ")}`,
		);
		console.log(`${file} DT_NEEDED: ${needed.join(", ")}`);
	}
	const nativeDir = path.join(scope, "pi-natives/native");
	const requirePacked = createRequire(import.meta.url);
	const native = requirePacked(path.join(nativeDir, "index.js"));
	const { nativeAddonStatus } = requirePacked(path.join(nativeDir, "loader-state.js"));
	const status = nativeAddonStatus();
	assert.ok(
		status && status.path.startsWith(`${leaf}/`),
		`Loader must use the packed Linux leaf: ${JSON.stringify(status)}`,
	);
	assert.equal(status.version, plan.version);
	assert.equal(status.stale, false);
	assert.equal(native.visibleWidth("\u001b[31mzen\u001b[0m界", 4), 5);
	console.log(`Packed native loaded: ${status.path}@${status.version}; visibleWidth passed`);

	const agentDir = path.join(scope, "pi-coding-agent");
	const manifest = await Bun.file(path.join(agentDir, "package.json")).json();
	assert.equal(manifest.version, plan.version);
	assert.equal(typeof manifest.bin?.omp, "string");
	const version = (
		await command([process.execPath, path.join(agentDir, manifest.bin.omp), "--version"], install)
	).trim();
	assert.equal(version, `omp/${plan.version}`, "Packed CLI --version must report the staged version");
	console.log(`Packed CLI --version: ${version}`);

	// WAYLAND_DISPLAY selects the production generic Wayland backend. There is
	// deliberately no compositor or D-Bus socket: reaching the portal instead
	// of checking the library first therefore fails this assertion, never prompts.
	const session = new native.DesktopSession();
	try {
		assert.equal(session.capabilities.backend, "wayland");
		assert.equal(session.capabilities.capture, false, "Missing PipeWire must not advertise capture");
		await assert.rejects(session.capture("desktop"), (error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /^CaptureFailed:/);
			assert.ok(error.message.includes("libpipewire-0.3.so.0"), error.message);
			assert.match(error.message, /install/i);
			console.log(`Production capture rejected before portal: ${error.message}`);
			return true;
		});
	} finally {
		await session.close();
	}
	console.log("Linux no-PipeWire release smoke passed");
}

async function run(root: string): Promise<void> {
	assert.equal(process.platform, "linux", "This release smoke requires Linux x64");
	assert.equal(process.arch, "x64", "This release smoke requires Linux x64");
	await fs.access(path.join(root, "release-plan.json"));
	const image = `zen-native-portability-smoke:${process.pid}`;
	await command([
		"docker",
		"build",
		"--tag",
		image,
		"--file",
		path.join(import.meta.dir, "native-portability.Dockerfile"),
		import.meta.dir,
	]);
	try {
		const output = await command([
			"docker",
			"run",
			"--rm",
			"--network=none",
			"--read-only",
			"--cap-drop=ALL",
			"--security-opt=no-new-privileges",
			"--pids-limit=256",
			"--tmpfs",
			"/tmp:rw,exec,nosuid,size=1g",
			"--tmpfs",
			"/home/smoke:rw,nosuid,size=64m",
			"--mount",
			`type=bind,src=${root},dst=${root},readonly`,
			"--mount",
			`type=bind,src=${process.execPath},dst=/usr/local/bin/bun,readonly`,
			"--mount",
			`type=bind,src=${import.meta.path},dst=/smoke.ts,readonly`,
			"--env",
			"HOME=/home/smoke",
			"--env",
			"XDG_RUNTIME_DIR=/tmp/runtime",
			"--env",
			"WAYLAND_DISPLAY=smoke-no-compositor",
			"--env",
			"XDG_SESSION_TYPE=wayland",
			"--env",
			"XDG_CURRENT_DESKTOP=Smoke",
			"--env",
			"DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/no-session-bus",
			"--env",
			"DBUS_SYSTEM_BUS_ADDRESS=unix:path=/tmp/no-system-bus",
			image,
			"timeout",
			"--kill-after=5s",
			"60s",
			"/usr/local/bin/bun",
			"/smoke.ts",
			"--inside",
			root,
		]);
		console.log(output.trim());
	} finally {
		await command(["docker", "image", "rm", image]);
	}
}

if (process.argv[2] === "--inside") await inside(path.resolve(process.argv[3]!));
else {
	assert.equal(process.argv.length, 3, "Usage: bun scripts/zen/native-portability-smoke.ts <staging-directory>");
	await run(await fs.realpath(process.argv[2]!));
}
