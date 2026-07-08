import { describe, expect, it } from "bun:test";
import type { AssistantMessage, Message, Usage } from "@oh-my-pi/pi-ai";
import * as snapcompact from "../src";

const TEST_FRAME_SIZE = 128;

function createUserMessage(content: string): Message {
	return { role: "user", content, timestamp: 0 };
}

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

function createAssistantMessage(content: AssistantMessage["content"]): Message {
	return {
		role: "assistant",
		content,
		api: "mock",
		provider: "mock",
		model: "mock",
		usage: ZERO_USAGE,
		stopReason: "stop",
		timestamp: 0,
	};
}

function makePreparation(
	overrides: Partial<snapcompact.CompactionPreparation<Message>> = {},
): snapcompact.CompactionPreparation<Message> {
	return {
		firstKeptEntryId: "kept-1",
		messagesToSummarize: [
			createUserMessage("Fix the login bug. The token expires too early!"),
			createAssistantMessage([{ type: "text", text: "Fixed the TTL comparison in src/login.ts." }]),
		],
		turnPrefixMessages: [],
		tokensBefore: 99000,
		previousSummary: undefined,
		previousPreserveData: undefined,
		fileOps: snapcompact.createFileOps(),
		...overrides,
	};
}

describe("context-image-issues regression harness", () => {
	const testPath = "/home/cagedbird/Downloads/tmp/context-image-issues/001-architecture-token-confusion.md";
	const testAmd64 = "amd64";
	const testArm64 = "arm64";
	const testAarch64 = "aarch64";
	const testX8664 = "x86_64";
	const testRustSymbol = "clippy::collapsible_if";
	const testUnderscoreVar = "hand_in_pocket";
	const testUnderscoreCls = "window_sticker_cls";
	const testPackageArtifact = "omp-zen-linux-amd64";
	const testVersion = "v1.2.3";
	const testHash = "f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6";

	const issueMessageContent = `
We encountered an issue while compiling on the following environments.
Here is the environment information and the log output:
- File path: ${testPath}
- Architecture list checked: ${testAmd64}, ${testArm64}, ${testAarch64}, ${testX8664}
- Tool output or target package: ${testPackageArtifact}
- Rust warnings and variables:
  ${testRustSymbol} is triggered in the source code.
  The variable name is ${testUnderscoreVar} and class is ${testUnderscoreCls}.
- Build artifact hashes and versions:
  Release version ${testVersion} was built.
  Commit hash: ${testHash}
- Some markdown backtick noise:
  \`\`\`bash
  error: compilation failed on x86_64-unknown-linux-gnu
  \`\`\`
- Ordinary Chinese narrative to check that common Chinese words are not anchored incorrectly:
  在这个过程中，我们运行了构建脚本，并且将生成的结果保存到了临时目录中。这些普通的中文字符应该被正常处理，而不是作为锚点。
`;

	it("compresses exact strings with unicode-event-stream serializer and zpix shape", async () => {
		const prep = makePreparation({
			messagesToSummarize: [createUserMessage(issueMessageContent)],
		});

		const result = await snapcompact.compact(prep, {
			serializer: "unicode-event-stream",
			shape: snapcompact.resolveUnicodeSnapcompactShape(),
			frameSize: TEST_FRAME_SIZE,
		});

		const archive = snapcompact.getPreservedArchive(result.preserveData);
		expect(archive).toBeDefined();
		expect(archive?.exactStrings).toBeDefined();
		const exactStrings = archive?.exactStrings || [];
		// Assertion 1: archive.exactStrings contains exact mappings with correct kinds
		const pathEntry = exactStrings.find(e => e.text === testPath);
		expect(pathEntry).toBeDefined();
		expect(pathEntry?.kind).toBe("path");

		const amd64Entry = exactStrings.find(e => e.text === testAmd64);
		expect(amd64Entry).toBeDefined();
		expect(amd64Entry?.kind).toBe("arch");

		const arm64Entry = exactStrings.find(e => e.text === testArm64);
		expect(arm64Entry).toBeDefined();
		expect(arm64Entry?.kind).toBe("arch");

		const aarch64Entry = exactStrings.find(e => e.text === testAarch64);
		expect(aarch64Entry).toBeDefined();
		expect(aarch64Entry?.kind).toBe("arch");

		const x8664Entry = exactStrings.find(e => e.text === testX8664);
		expect(x8664Entry).toBeDefined();
		expect(x8664Entry?.kind).toBe("arch");

		const rustEntry = exactStrings.find(e => e.text === testRustSymbol);
		expect(rustEntry).toBeDefined();
		expect(rustEntry?.kind).toBe("symbol");

		const varEntry = exactStrings.find(e => e.text === testUnderscoreVar);
		expect(varEntry).toBeDefined();
		expect(varEntry?.kind).toBe("exact");

		const clsEntry = exactStrings.find(e => e.text === testUnderscoreCls);
		expect(clsEntry).toBeDefined();
		expect(clsEntry?.kind).toBe("exact");

		const packageEntry = exactStrings.find(e => e.text === testPackageArtifact);
		expect(packageEntry).toBeDefined();
		expect(packageEntry?.kind).toBe("exact");

		const versionEntry = exactStrings.find(e => e.text === testVersion);
		expect(versionEntry).toBeDefined();
		expect(versionEntry?.kind).toBe("version");

		const hashEntry = exactStrings.find(e => e.text === testHash);
		expect(hashEntry).toBeDefined();
		expect(hashEntry?.kind).toBe("hash");

		const targetEntries = [
			pathEntry!,
			amd64Entry!,
			arm64Entry!,
			aarch64Entry!,
			x8664Entry!,
			rustEntry!,
			varEntry!,
			clsEntry!,
			packageEntry!,
			versionEntry!,
			hashEntry!,
		];

		// Assertion 2: archive.text contains [E###] anchors and does not contain those original high-risk strings
		expect(archive?.text).toBeDefined();
		for (const entry of targetEntries) {
			expect(archive?.text).toContain(`[${entry.id}]`);
			expect(archive?.text).not.toContain(entry.text);
		}

		// Assertion 3: historyBlocks(archive) contains EXACT STRING ANCHORS and the exact mappings
		const textBlocks = snapcompact.historyBlocks(archive!).filter(block => block.type === "text");
		expect(textBlocks.some(block => block.text.includes("EXACT STRING ANCHORS"))).toBe(true);

		for (const entry of targetEntries) {
			expect(textBlocks.some(block => block.text.includes(`${entry.id} ${entry.kind} ${entry.text}`))).toBe(true);
		}

		// Assertion 4: Anchor count stays bounded and does not anchor common Chinese narrative words
		expect(exactStrings.length).toBe(targetEntries.length);
		const chineseWords = ["过程", "架构", "工具", "模块", "普通", "字符", "生成", "任何", "锚点"];
		for (const word of chineseWords) {
			const found = exactStrings.some(e => e.text.includes(word));
			expect(found).toBe(false);
		}
	});

	it("legacy serializeConversation path (no serializer option) does not create exactStrings for the same text", async () => {
		// Assertion 5: Non-unicode/legacy compact path for same fixture does not emit exactStrings
		const prep = makePreparation({
			messagesToSummarize: [createUserMessage(issueMessageContent)],
		});

		const result = await snapcompact.compact(prep, {
			frameSize: TEST_FRAME_SIZE,
		});

		const archive = snapcompact.getPreservedArchive(result.preserveData);
		expect(archive).toBeDefined();
		expect(archive?.exactStrings).toBeUndefined();
	});
});
