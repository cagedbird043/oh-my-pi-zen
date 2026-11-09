/**
 * `generate_image` — image-generation prompt and controls plus the produced
 * image(s). Generated images travel in `details.images` (kept out of model
 * context), so the body merges them into the result before thumbnailing.
 */
import type { ReactNode } from "react";
import { Badge, Badges, InvalidArg, Kv, KvGrid, Note, PathText, ResultImages, ResultText, Row } from "../parts";
import type { ToolRenderer, ToolRenderProps, ToolResultBlock, ToolResultLike } from "../types";
import { detailsRecord, isRecord, normalizeWs, resultImagesOf, str, truncate } from "../util";

/** Result with `details.images` (`{data, mimeType}[]`) appended as image blocks. */
function withDetailImages(result: ToolResultLike | undefined): ToolResultLike | undefined {
	const details = detailsRecord(result);
	if (!result || !details || !Array.isArray(details.images)) return result;
	const extra: ToolResultBlock[] = [];
	for (const img of details.images) {
		if (isRecord(img) && typeof img.data === "string" && typeof img.mimeType === "string") {
			extra.push({ type: "image", data: img.data, mimeType: img.mimeType });
		}
	}
	if (extra.length === 0) return result;
	return { content: [...result.content, ...extra], details: result.details, isError: result.isError };
}

function Summary({ args }: ToolRenderProps): ReactNode {
	const prompt = str(args.prompt);
	const size = str(args.size);
	const count = typeof args.count === "number" ? args.count : undefined;
	return (
		<>
			{prompt ? (
				<span>{truncate(normalizeWs(prompt), 80)}</span>
			) : (
				args.prompt !== undefined && <InvalidArg what="prompt" />
			)}{" "}
			{size && <Badge>{size}</Badge>}
			{count !== undefined && <Badge tone="accent">×{count}</Badge>}
		</>
	);
}

const PROMPT_FIELDS = [
	["prompt", "prompt"],
	["size", "size"],
	["background", "background"],
	["quality", "quality"],
] as const;

function Body({ args, result }: ToolRenderProps): ReactNode {
	const inputs = Array.isArray(args.input) ? args.input : null;
	const details = detailsRecord(result);
	const provider = str(details?.provider);
	const model = str(details?.model);
	const revised = str(details?.revisedPrompt);
	const paths: string[] = [];
	if (details && Array.isArray(details.imagePaths)) {
		for (const p of details.imagePaths) {
			if (typeof p === "string") paths.push(p);
		}
	}
	const merged = withDetailImages(result);
	const hasImages = resultImagesOf(merged).length > 0;
	return (
		<>
			<KvGrid>
				{PROMPT_FIELDS.map(([arg, label]) => {
					const value = args[arg];
					return (
						<Kv key={arg} k={label}>
							{value === undefined ? null : (str(value) ?? <InvalidArg what={label} />)}
						</Kv>
					);
				})}
				<Kv k="count">{typeof args.count === "number" ? args.count : null}</Kv>
			</KvGrid>
			{inputs && inputs.length > 0 && (
				<div className="tv-list">
					{inputs.map((input, i) => {
						const path = isRecord(input) ? str(input.path) : null;
						return (
							<Row key={i} k={i === 0 ? "input" : undefined}>
								{!isRecord(input) ? (
									<InvalidArg what="input" />
								) : path ? (
									<PathText path={path} />
								) : (
									<InvalidArg what="path" />
								)}
							</Row>
						);
					})}
				</div>
			)}
			{(provider || model) && <Badges items={[provider, model]} />}
			{revised && <Note>revised: {truncate(revised, 400)}</Note>}
			<ResultImages result={merged} />
			{paths.length > 0 && (
				<div className="tv-list">
					{paths.map((p, i) => (
						<Row key={i} k={i === 0 ? "saved" : undefined}>
							<PathText path={p} />
						</Row>
					))}
				</div>
			)}
			{!hasImages && <ResultText result={result} maxLines={8} />}
		</>
	);
}

export const generateImageRenderer: ToolRenderer = { Summary, Body };
