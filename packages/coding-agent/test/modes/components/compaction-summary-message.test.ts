import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	CompactionSummaryMessageComponent,
	createHandoffSummaryMessageComponent,
	HandoffSummaryMessageComponent,
} from "@oh-my-pi/pi-coding-agent/modes/components/compaction-summary-message";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { CompactionSummaryMessage, CustomMessage } from "@oh-my-pi/pi-coding-agent/session/messages";

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	await initTheme(false);
});

afterAll(() => {
	resetSettingsForTest();
});

function makeHandoffMessage(content: CustomMessage<unknown>["content"]): CustomMessage<unknown> {
	return {
		role: "custom",
		customType: "handoff",
		content,
		display: true,
		attribution: "agent",
		timestamp: Date.now(),
	};
}

describe("handoff summary divider", () => {
	it("renders handoff custom messages with the compact divider instead of a framed block", () => {
		const component = createHandoffSummaryMessageComponent(
			makeHandoffMessage(
				`<handoff-context>\n# Goal\nContinue the resize fix.\n</handoff-context>\n\nThe above is a handoff document.`,
			),
			false,
		);

		expect(component).toBeInstanceOf(HandoffSummaryMessageComponent);
		const collapsed = Bun.stripANSI(component!.render(80).join("\n"));
		expect(collapsed).toContain("handoff");
		expect(collapsed).toContain("ctrl+o");
		expect(collapsed).not.toContain("[handoff]");
		expect(collapsed).not.toContain("Continue the resize fix");
	});

	it("expands to the handoff document without the provider-only XML wrapper", () => {
		const component = createHandoffSummaryMessageComponent(
			makeHandoffMessage([
				{
					type: "text",
					text: "<handoff-context>\n# Goal\nContinue the resize fix.\n</handoff-context>",
				},
			]),
			true,
		);

		expect(component).toBeInstanceOf(HandoffSummaryMessageComponent);
		const expanded = Bun.stripANSI(component!.render(80).join("\n"));
		expect(expanded).toContain("Handoff context");
		expect(expanded).toContain("Continue the resize fix");
		expect(expanded).not.toContain("<handoff-context>");
		expect(expanded).not.toContain("</handoff-context>");
	});

	it("leaves unrelated custom messages on the generic renderer path", () => {
		const message = makeHandoffMessage("Not a handoff.");
		message.customType = "extension-note";

		expect(createHandoffSummaryMessageComponent(message, false)).toBeUndefined();
	});
});

describe("compaction summary divider", () => {
	it("shows the persisted Snapcompact frame summary only when expanded", () => {
		const shortSummary =
			"Archived 55,191 chars of history onto 7 snapcompact frames (+1,427 chars tail, 0 truncated)";
		const message: CompactionSummaryMessage = {
			role: "compactionSummary",
			summary: "Provider context summary",
			shortSummary,
			tokensBefore: 15_938,
			timestamp: Date.now(),
		};
		const component = new CompactionSummaryMessageComponent(message);

		const collapsed = Bun.stripANSI(component.render(160).join("\n"));
		expect(collapsed).toContain("compacted");
		expect(collapsed).not.toContain(shortSummary);
		expect(collapsed).not.toContain("Provider context summary");

		component.setExpanded(true);
		const expanded = Bun.stripANSI(component.render(160).join("\n"));
		expect(expanded).toContain(shortSummary);
		expect(expanded).toContain("Provider context summary");
		expect(expanded.indexOf(shortSummary)).toBeGreaterThan(expanded.indexOf("Provider context summary"));
	});
});
