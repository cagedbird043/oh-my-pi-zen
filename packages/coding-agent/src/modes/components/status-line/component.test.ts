import { beforeAll, describe, expect, it } from "bun:test";
import { Settings } from "../../../config/settings";
import type { AgentSession } from "../../../session/agent-session";
import { getThemeByName, setThemeInstance } from "../../theme/theme";
import { StatusLineComponent } from "./component";
import { renderSegment } from "./segments";
import type { SegmentContext } from "./types";

function makeSessionWithLastMessage(lastMessage: unknown) {
	return {
		messages: [lastMessage],
		model: { contextWindow: 128000 },
		contextUsageRevision: 0,
		systemPrompt: [],
		agent: { state: { tools: [] } },
		skills: [],
		getContextUsage: () => ({ tokens: 42, contextWindow: 128000 }),
	};
}

beforeAll(async () => {
	await Settings.init({ inMemory: true });
	const loaded = await getThemeByName("dark");
	if (!loaded) throw new Error("theme unavailable");
	setThemeInstance(loaded);
});

function makeSegmentContext(overrides: Partial<SegmentContext> = {}): SegmentContext {
	return {
		session: {
			state: {
				model: { provider: "codesonline", id: "GPT-5.5", name: "GPT-5.5" },
				thinkingLevel: undefined,
			},
			isAutoThinking: false,
			autoResolvedThinkingLevel: () => undefined,
			isFastModeActive: () => false,
			isAdvisorActive: () => false,
			settings: { get: () => false },
		} as unknown as AgentSession,
		width: 120,
		options: {},
		compactThinkingLevel: false,
		planMode: null,
		loopMode: null,
		goalMode: null,
		collab: null,
		activeRepo: null,
		usageStats: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			premiumRequests: 0,
			cost: 0,
			tokensPerSecond: null,
		},
		contextPercent: null,
		contextTokens: 0,
		contextWindow: 0,
		autoCompactEnabled: false,
		subagentCount: 0,
		activeMs: 0,
		git: { branch: null, status: null, pr: null },
		worktree: null,
		usage: null,
		...overrides,
	};
}

describe("StatusLineComponent", () => {
	it("fingerprints tool-call arguments containing bigint values", () => {
		const statusLine = new StatusLineComponent(
			makeSessionWithLastMessage({
				role: "assistant",
				timestamp: 1,
				content: [
					{
						type: "toolCall",
						name: "read",
						arguments: { offset: 1n, nested: { limit: 2n } },
					},
				],
			}) as unknown as AgentSession,
		);

		expect(statusLine.getCachedContextBreakdown()).toEqual({ usedTokens: 42, contextWindow: 128000 });
	});

	it("shows the model provider by default", () => {
		const rendered = renderSegment("model", makeSegmentContext());
		expect(rendered.content).toContain("codesonline/GPT-5.5");
	});

	it("hides the model provider only when explicitly disabled", () => {
		const rendered = renderSegment("model", makeSegmentContext({ options: { model: { showProvider: false } } }));
		expect(rendered.content).toContain("GPT-5.5");
		expect(rendered.content).not.toContain("codesonline/GPT-5.5");
	});
});
