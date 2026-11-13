import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { applyModelPreset, getSessionModelPreset } from "@oh-my-pi/pi-coding-agent/config/model-presets";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { cfgModelPresets } from "@oh-my-pi/pi-coding-agent/config/model-settings";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { cfgDefaultThinkingLevel } from "@oh-my-pi/pi-coding-agent/session/settings";
import { lookupBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import type { TuiSlashCommandRuntime } from "@oh-my-pi/pi-coding-agent/slash-commands/types";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { HookSelectorComponent } from "@oh-my-pi/pi-tui/overlays/hook-selector";
import { getThemeByName, setThemeInstance } from "@oh-my-pi/pi-tui/theme";
import { TempDir } from "@oh-my-pi/pi-utils";
import { createAssistantMessage } from "./helpers/agent-session-setup";

const SONNET = "anthropic/claude-sonnet-4-5";
const OPUS = "anthropic/claude-opus-4-5";
const NEW_SONNET = "anthropic/claude-sonnet-4-6";
function model(selector: string) {
	const result = getBundledModel("anthropic", selector.slice("anthropic/".length));
	if (!result) throw new Error(`Missing fixture model ${selector}`);
	return result;
}

describe("session model presets", () => {
	let root: TempDir;
	let auth: AuthStorage;
	let registry: ModelRegistry;
	const sessions: AgentSession[] = [];
	let serial = 0;

	beforeAll(async () => {
		root = TempDir.createSync("omp-session-presets-");
		auth = await AuthStorage.create(path.join(root.path(), "auth.db"));
		auth.keys.setRuntime("anthropic", "test-key");
		registry = new ModelRegistry(auth, path.join(root.path(), "models.yml"));
		const theme = await getThemeByName("dark");
		if (!theme) throw new Error("Missing test theme");
		setThemeInstance(theme);
	});
	afterEach(async () => {
		for (const session of sessions.splice(0)) await session.dispose();
	});
	afterAll(() => {
		auth.close();
		root.removeSync();
	});

	function settings() {
		const result = Settings.isolated();
		result.setModelRole("default", SONNET);
		cfgDefaultThinkingLevel.set(result, Effort.Low);
		cfgModelPresets.setEntry(result, "alpha", {
			modelRoles: { default: SONNET, smol: SONNET },
			defaultThinkingLevel: Effort.Low,
		});
		cfgModelPresets.setEntry(result, "zulu", {
			modelRoles: { default: OPUS, smol: OPUS },
			defaultThinkingLevel: Effort.High,
		});
		return result;
	}

	function create(config: Settings) {
		const manager = SessionManager.create(root.path(), path.join(root.path(), `sessions-${serial++}`));
		const session = new AgentSession({
			agent: new Agent({
				initialState: {
					model: model(SONNET),
					systemPrompt: ["Test"],
					tools: [],
					messages: [],
					thinkingLevel: Effort.Low,
				},
			}),
			sessionManager: manager,
			settings: config,
			modelRegistry: registry,
		});
		manager.appendMessage(createAssistantMessage("Ready to continue"));
		sessions.push(session);
		manager.appendMessage({ role: "user", content: "Continue the task", timestamp: Date.now() });
		return session;
	}

	async function reopen(file: string, config: Settings, explicit?: string) {
		const manager = await SessionManager.open(file, path.join(root.path(), `resumed-${serial++}`));
		const result = await createAgentSession({
			cwd: root.path(),
			agentDir: root.path(),
			authStorage: auth,
			modelRegistry: registry,
			sessionManager: manager,
			settings: config,
			model: explicit ? model(explicit) : undefined,
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			skipPythonPreflight: true,
		});
		sessions.push(result.session);
		return result;
	}

	it("resumes the named preset's latest definition without changing global defaults", async () => {
		const source = create(settings());
		await applyModelPreset(source.settings, source, "zulu");
		await source.sessionManager.flush();
		const config = settings();
		cfgModelPresets.setEntry(config, "zulu", {
			modelRoles: { default: NEW_SONNET, smol: OPUS },
			defaultThinkingLevel: Effort.Medium,
		});
		const resumed = (await reopen(source.sessionFile!, config)).session;
		expect(resumed.modelPresetName).toBe("zulu");
		expect(resumed.model?.id).toBe(model(NEW_SONNET).id);
		expect(resumed.configuredThinkingLevel()).toBe(Effort.Medium);
		expect(config.getModelRoles()).toEqual({ default: NEW_SONNET, smol: OPUS });
		expect(config.getGlobalModelRole("default")).toBe(SONNET);
	});

	it("preserves a subsequent model and effort override, while an explicit startup model wins", async () => {
		const source = create(settings());
		await applyModelPreset(source.settings, source, "zulu");
		await source.setModel(model(NEW_SONNET));
		source.setThinkingLevel(Effort.Low);
		await source.sessionManager.flush();
		const resumed = (await reopen(source.sessionFile!, settings())).session;
		expect(resumed.modelPresetName).toBe("zulu");
		expect(resumed.model?.id).toBe(model(NEW_SONNET).id);
		expect(resumed.configuredThinkingLevel()).toBe(Effort.Low);
		expect(resumed.settings.getModelRole("smol")).toBe(OPUS);
		const explicit = (await reopen(source.sessionFile!, settings(), SONNET)).session;
		expect(explicit.model?.id).toBe(model(SONNET).id);
		expect(explicit.settings.getModelRole("smol")).toBe(OPUS);
	});

	it("switches preset roles with the session and clears the session layer for a new conversation", async () => {
		const first = create(settings());
		await applyModelPreset(first.settings, first, "zulu");
		await first.sessionManager.flush();
		const second = create(settings());
		await applyModelPreset(second.settings, second, "alpha");
		await second.sessionManager.flush();
		const secondFile = second.sessionFile!;
		expect(await second.switchSession(first.sessionFile!)).toBe(true);
		expect(second.modelPresetName).toBe("zulu");
		expect(second.model?.id).toBe(model(OPUS).id);
		expect(second.settings.getModelRole("smol")).toBe(OPUS);
		expect(await second.switchSession(secondFile)).toBe(true);
		expect(second.modelPresetName).toBe("alpha");
		expect(second.settings.getModelRole("smol")).toBe(SONNET);
		await second.switchSession(first.sessionFile!);
		await second.newSession();
		expect(second.modelPresetName).toBeUndefined();
		expect(second.model?.id).toBe(model(SONNET).id);
		expect(second.settings.getModelRole("smol")).toBe(SONNET);
	});

	it("reports a removed preset and falls back to configured defaults", async () => {
		const source = create(settings());
		await applyModelPreset(source.settings, source, "zulu");
		await source.sessionManager.flush();
		const config = settings();
		cfgModelPresets.setEntry(config, "zulu", undefined);
		const result = await reopen(source.sessionFile!, config);
		expect(result.modelFallbackMessage).toContain("zulu");
		expect(result.session.model?.id).toBe(model(SONNET).id);
		expect(config.getModelRole("smol")).toBeUndefined();
	});

	it("restores the outgoing preset layer when a target session's model cannot be restored", async () => {
		const target = create(settings());
		await applyModelPreset(target.settings, target, "zulu");
		target.sessionManager.appendModelChange("missing-provider/missing-model");
		await target.sessionManager.flush();
		const active = create(settings());
		await applyModelPreset(active.settings, active, "alpha");
		await expect(active.switchSession(target.sessionFile!)).rejects.toThrow("Could not restore model");
		expect(active.modelPresetName).toBe("alpha");
		expect(active.settings.getModelRole("smol")).toBe(SONNET);
		expect(active.model?.id).toBe(model(SONNET).id);
	});

	it("forking an earlier entry restores that branch's preset instead of the later selection", async () => {
		const session = create(settings());
		await applyModelPreset(session.settings, session, "zulu");
		const entry = session.sessionManager.appendMessage({
			role: "user",
			content: "Use this branch",
			timestamp: Date.now(),
		});
		await applyModelPreset(session.settings, session, "alpha");
		expect(await session.fork(entry)).toBe(true);
		expect(session.modelPresetName).toBe("zulu");
		expect(session.model?.id).toBe(model(OPUS).id);
		expect(session.settings.getModelRole("smol")).toBe(OPUS);
		expect(session.settings.getGlobalModelRole("default")).toBe(SONNET);
	});

	it("marks the current preset independently of the cursor and switches using the unadorned name", async () => {
		const session = create(settings());
		await applyModelPreset(session.settings, session, "zulu");
		const frames: string[] = [];
		const showHookSelector: InteractiveModeContext["showHookSelector"] = async (title, options, dialogOptions) => {
			let picked: string | undefined;
			const selector = new HookSelectorComponent(
				title,
				options,
				value => {
					picked = value;
				},
				() => {},
				dialogOptions,
			);
			frames.push(Bun.stripANSI(selector.render(100).join("\n")));
			selector.handleInput("\x1b[A");
			frames.push(Bun.stripANSI(selector.render(100).join("\n")));
			selector.handleInput("\r");
			selector.dispose();
			return picked;
		};
		const runtime = {
			draftDetached: true,
			ctx: {
				session,
				settings: session.settings,
				showHookSelector,
				statusLine: { invalidate() {} },
				updateEditorBorderColor() {},
				showStatus() {},
				showWarning(message: string) {
					throw new Error(message);
				},
				ui: { requestRender() {} },
			},
		} as unknown as TuiSlashCommandRuntime;
		await lookupBuiltinSlashCommand("modelpreset")!.handleTui!(
			{ name: "modelpreset", args: "", text: "/modelpreset" },
			runtime,
		);
		for (const frame of frames) expect(frame).toMatch(/zulu[^]*Current/);
		expect(session.modelPresetName).toBe("alpha");
		expect(session.model?.id).toBe(model(SONNET).id);
		expect(getSessionModelPreset(session.sessionManager.getBranch())?.modelOverridden).toBe(false);
	});
});
