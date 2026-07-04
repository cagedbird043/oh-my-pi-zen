export const ZEN_PACKAGE_SCOPE = "@oh-my-pi-zen";
export const ZEN_REPOSITORY = "cagedbird043/oh-my-pi-zen";
export const ZEN_HOMEBREW_FORMULA = "cagedbird043/tap/omp-zen";
export const ZEN_MISE_TOOL = `github:${ZEN_REPOSITORY}`;

export const ZEN_TEXT_REPLACEMENTS: readonly (readonly [string, string])[] = [
	["@oh-my-pi/", `${ZEN_PACKAGE_SCOPE}/`],
	["github.com/can1357/oh-my-pi", `github.com/${ZEN_REPOSITORY}`],
	["can1357/oh-my-pi", ZEN_REPOSITORY],
	["can1357/tap/omp", ZEN_HOMEBREW_FORMULA],
	["github:can1357/oh-my-pi", ZEN_MISE_TOOL],
];

export function rewriteZenPackageText(input: string): string {
	let output = input;
	for (const [from, to] of ZEN_TEXT_REPLACEMENTS) {
		output = output.replaceAll(from, to);
	}
	return output;
}
