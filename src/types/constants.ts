import type { ArtifactsArray } from './artifact.types.js';

/**
 * All Obsidian vault artifact directories known to this extension.
 *
 * Each entry drives four things simultaneously:
 *  1. Which vault directories are created / detected (vault.service.ts)
 *  2. Which VS Code context keys are set (context.service.ts)
 *  3. Which insert commands are registered and where they appear (insert.command.ts + package.json)
 *  4. Per-type create-form behaviour — language mode, label, multi-block (artifact-type-config.service.ts)
 *
 * Context key and command ID are derived from `dir.toLowerCase()`:
 *   context key — `obsidian-artifacts.<dir.toLowerCase()>Active`
 *   command     — `obsidian-artifacts.insert.<dir.toLowerCase()>`
 *
 * `contexts: ['all']` means the artifact surfaces in every VS Code context menu.
 *
 * `type` is the canonical ArtifactType literal — direct lookup key used by the
 * parser, serializer, and helper services (never derived from `dir` at runtime).
 */
export const ARTIFACTS: ArtifactsArray = [
	{
		type: 'snippet',
		name: 'Snippets',
		dir: 'Snippets',
		default: true,
		contexts: ['editor'],
		createForm: true,
		form: {
			language: { mode: 'free', default: '' },
			label: { singular: 'snippet' },
			multiBlock: true,
		},
	},
	{
		type: 'agent',
		name: 'Agents Config',
		dir: 'AgentsConf',
		default: true,
		contexts: ['explorer'],
	},
	{
		type: 'command',
		name: 'Commands',
		dir: 'Commands',
		default: false,
		contexts: ['terminal'],
		createForm: true,
		form: {
			language: { mode: 'locked', default: 'bash' },
			label: { singular: 'command' },
			multiBlock: true,
		},
	},
	{
		type: 'template',
		name: 'Templates',
		dir: 'Templates',
		default: false,
		contexts: ['editor', 'explorer'],
	},
	{
		type: 'variables',
		name: 'Variables',
		dir: 'Variables',
		default: false,
		contexts: ['all'],
	},
];

/**
 * Markdown code-fence shorthand → canonical VS Code `languageId`.
 *
 * Only entries whose fence shorthand **differs** from the VS Code id belong here.
 * Fence info-strings that already are valid ids (`javascript`, `python`, `json`,
 * `html`, `css`, `go`, `java`, `sql`, …) skip this map — `resolveLangId` validates
 * them directly against `vscode.languages.getLanguages()`.
 *
 * `LANG_FENCE` below is the **partial** inverse of this map, not the full one.
 * A full inverse is impossible: this map carries *shorthand* (`py3`, `cjs`,
 * `c++`), and inverting it would emit those as fence strings — `python` would
 * serialize as ```` ```py3 ````. `LANG_FENCE` therefore carries only the ids
 * that are not themselves valid fence strings, and
 * `test/language-consistency.test.ts` — not this comment — is what keeps the
 * two tables agreeing.
 *
 * @example
 * LANG_ALIAS['js']   // → 'javascript'
 * LANG_ALIAS['c#']   // → 'csharp'
 * LANG_ALIAS['bash'] // → 'shellscript'
 */
export const LANG_ALIAS: Record<string, string> = {
	js: 'javascript',
	node: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'javascriptreact',
	ts: 'typescript',
	tsx: 'typescriptreact',
	py: 'python',
	py3: 'python',
	rb: 'ruby',
	rs: 'rust',
	golang: 'go',
	sh: 'shellscript',
	shell: 'shellscript',
	bash: 'shellscript',
	zsh: 'shellscript',
	yml: 'yaml',
	md: 'markdown',
	'c++': 'cpp',
	'c#': 'csharp',
	cs: 'csharp',
	kt: 'kotlin',
	// `objc`/`objcpp` are the fence strings; `objective-c`/`objective-cpp` are the
	// real VS Code languageIds that `resolveLangId` validates against.
	objc: 'objective-c',
	objcpp: 'objective-cpp',
	ps1: 'powershell',
	htm: 'html',
};

/**
 * Canonical VS Code `languageId` → markdown code-fence info-string.
 *
 * The direction used when *writing* a fence (e.g. capturing an editor selection
 * into a new artifact). Only ids whose conventional fence string **differs**
 * from the id belong here — `mapLanguageId` passes anything else through
 * unchanged, so `javascript` stays ```` ```javascript ````.
 *
 * This is the partial inverse of `LANG_ALIAS`; see that map's note for why it
 * cannot be derived from it. Guard 1 of `test/language-consistency.test.ts`
 * asserts every entry here round-trips: `normalizeLangId(fence) === id`.
 *
 * @example
 * LANG_FENCE['typescriptreact'] // → 'tsx'
 * LANG_FENCE['shellscript']     // → 'bash'
 * LANG_FENCE['objective-c']     // → 'objc'
 */
export const LANG_FENCE: Readonly<Record<string, string>> = {
	typescriptreact: 'tsx',
	javascriptreact: 'jsx',
	shellscript: 'bash',
	dockerfile: 'dockerfile',
	'objective-c': 'objc',
	'objective-cpp': 'objcpp',
};

/**
 * Canonical VS Code `languageId` → cosmetic file extension for the temp edit file.
 *
 * The extension is **cosmetic only** — `BlockEditController` sets the editor
 * language explicitly via `vscode.languages.setTextDocumentLanguage`, so the
 * file name does not drive highlighting. Unmapped ids fall back through
 * `extForLang` (the id itself when filename-safe, else `txt`).
 *
 * @example
 * LANG_EXT['javascript'] // → 'js'
 * LANG_EXT['csharp']     // → 'cs'
 * LANG_EXT['plaintext']  // → 'txt'
 */
export const LANG_EXT: Record<string, string> = {
	javascript: 'js',
	javascriptreact: 'jsx',
	typescript: 'ts',
	typescriptreact: 'tsx',
	python: 'py',
	ruby: 'rb',
	rust: 'rs',
	go: 'go',
	java: 'java',
	csharp: 'cs',
	cpp: 'cpp',
	c: 'c',
	kotlin: 'kt',
	swift: 'swift',
	php: 'php',
	shellscript: 'sh',
	powershell: 'ps1',
	yaml: 'yml',
	json: 'json',
	html: 'html',
	css: 'css',
	scss: 'scss',
	sql: 'sql',
	markdown: 'md',
	xml: 'xml',
	'objective-c': 'm',
	'objective-cpp': 'mm',
	dockerfile: 'dockerfile',
	plaintext: 'txt',
};
