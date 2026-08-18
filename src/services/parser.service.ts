import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAllTypes, getTypeForDir } from './artifact-type-config.service.js';
import type { ArtifactType, ParsedArtifactFile, ParsedBlock, ParsedFrontmatter, ParsedVar } from '../types/parsed-artifact.types.js';

// Accepted `type` values — any unrecognised value keeps the 'snippet' fallback.
// Derived from ARTIFACTS so a type added there is accepted here immediately;
// as a hardcoded list this silently downgraded unlisted types to 'snippet'.
// Guarded by the drift test in test/constants.test.ts.
const VALID_TYPES = new Set<string>(getAllTypes());

// Frontmatter keys copied verbatim into `ParsedFrontmatter` (string-typed).
/**
 * Frontmatter keys the parser reads as plain single-line strings.
 *
 * Exported so `test/frontmatter-keys.test.ts` can bind this list to the
 * serializer's `FRONTMATTER_KEY_ORDER`: a key the serializer emits but this set
 * (plus the specially-handled `type` and `tags`) does not know is silently
 * dropped on the next read.
 */
export const STRING_FRONTMATTER_KEYS = new Set<string>(['title', 'description', 'language', 'env', 'target']);

// Shared regex constants — declared once to avoid SonarQube duplicated-literal flags
// and to keep parsing rules in a single source of truth.
const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const FRONTMATTER_STRIP_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const CODE_FENCE_RE        = /```(\w*)\r?\n([\s\S]*?)```/;
const VKS_FENCE_RE         = /```vks\r?\n([\s\S]*?)```/;

/**
 * Matches a `<VK-Hint>` variable token, where `Hint` starts with a letter.
 *
 * Exported so `render.service.ts` highlights exactly the tokens this parser
 * detects — the two drifted apart as separate literals before Phase 1.
 *
 * **Carries the `/g` flag**, so it holds `lastIndex` state. Only use it with
 * `matchAll` or `replace`/`replaceAll`, which reset `lastIndex` themselves;
 * never with a bare `.test()` or `.exec()` loop.
 *
 * @example
 * 'x = <VK-host>'.replaceAll(VK_TOKEN_RE, 'v')  // → 'x = v'
 */
export const VK_TOKEN_RE = /<VK-([A-Za-z]\w*)>/g;

/**
 * Extracts and parses the YAML frontmatter block from raw vault file content.
 *
 * Frontmatter must appear at the very start of the file between `---` fences.
 * Unknown keys are silently skipped; an invalid `type` value falls back to `'snippet'`.
 *
 * @param content - Full UTF-8 string content of the `.md` file.
 * @returns Populated `ParsedFrontmatter`; returns `{ type: 'snippet' }` when no frontmatter is found.
 *
 * @example
 * parseFrontmatter('---\ntype: template\ntitle: React Component\nlanguage: tsx\n---\n')
 */
function parseFrontmatter(content: string, defaultType: ArtifactType = 'snippet'): ParsedFrontmatter {
    const result: ParsedFrontmatter = { type: defaultType };
    const match = FRONTMATTER_BLOCK_RE.exec(content);
    if (!match) { return result; }

    for (const line of match[1].split(/\r?\n/)) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) { continue; }
        const key = line.slice(0, colonIdx).trim();
        const raw = line.slice(colonIdx + 1).trim();
        applyFrontmatterField(result, key, raw);
    }

    return result;
}

/**
 * Mutates `result` with a single `key: value` pair from the frontmatter block.
 *
 * Extracted from `parseFrontmatter` to lower its cognitive complexity (S3776) by
 * isolating per-key validation/normalisation. Unrecognised keys are silently ignored.
 *
 * @param result - Frontmatter accumulator being populated.
 * @param key    - Trimmed key name.
 * @param raw    - Trimmed raw value string.
 *
 * @example
 * applyFrontmatterField({ type: 'snippet' }, 'tags', '[a, b]')
 */
function applyFrontmatterField(result: ParsedFrontmatter, key: string, raw: string): void {
    if (key === 'type') {
        if (VALID_TYPES.has(raw)) { result.type = raw as ArtifactType; }
        return;
    }
    if (key === 'tags') {
        // Parse inline array syntax: `[a, b, c]` → `['a', 'b', 'c']`
        const inner = raw.replaceAll(/^\[|\]$/g, '');
        result.tags = inner.split(',').map(t => t.trim()).filter(Boolean);
        return;
    }
    if (STRING_FRONTMATTER_KEYS.has(key)) {
        (result as unknown as Record<string, string>)[key] = raw;
    }
}

/**
 * Extracts the first fenced code block from a vault file, along with its language tag.
 *
 * The frontmatter section is stripped first to prevent false matches.
 * Trailing whitespace is removed so the inserted content does not carry an
 * unwanted trailing newline into the editor.
 *
 * @param content - Full UTF-8 string content of the `.md` file.
 * @returns `{ code, fenceLang }` — code is `''` and fenceLang is `undefined` when no fence is found.
 *
 * @example
 * parseCodeBlock('---\ntype: snippet\n---\n\n```javascript\nconsole.log("hi");\n```')
 */
function parseCodeBlock(content: string): { code: string; fenceLang?: string } {
    // Strip frontmatter before scanning to avoid matching a fence inside it
    const afterFrontmatter = content.replace(FRONTMATTER_STRIP_RE, '');
    const match = CODE_FENCE_RE.exec(afterFrontmatter);
    if (!match) { return { code: '' }; }
    return {
        code:     match[2].trimEnd(),
        fenceLang: match[1] || undefined,
    };
}

/**
 * Converts a raw `KEY=value` block into an ordered array of `ParsedVar` objects.
 *
 * Lines that do not contain `=` are skipped. Lines starting with `#` (comments)
 * are skipped. A value may be empty (`KEY=` is valid and yields `defaultValue: ''`).
 *
 * @param raw - Multi-line string of `KEY=value` pairs.
 * @returns Ordered array of `{ name, defaultValue }` objects.
 *
 * @example
 * parseVarLines('port=8080\nimage=nginx\n')
 */
function parseVarLines(raw: string): ParsedVar[] {
    return raw
        .split(/\r?\n/)
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => {
            const eq = l.indexOf('=');
            return { name: l.slice(0, eq).trim(), defaultValue: l.slice(eq + 1).trim() };
        })
        .filter(v => v.name.length > 0);
}

/**
 * Locates and parses the variables section from raw vault file content.
 *
 * Two formats are supported, tried in priority order:
 * 1. **Fenced block** — ` ```vks\nKEY=val\n``` ` (standard for `type: variables` files).
 * 2. **Unfenced section** — a `vars:` or `vars` label on its own line followed by
 *    `KEY=value` pairs, placed after the ` ```code` block.
 *
 * @param content - Full UTF-8 string content of the `.md` file.
 * @returns Ordered array of `ParsedVar` objects, or `[]` when no vars section exists.
 *
 * @example
 * parseVars('...\n```vks\nAPI_URL=http://localhost\n```')
 *
 * parseVars('...\n```javascript\n...\n```\n\nvars:\nroute=/test\n')
 */
function parseVars(content: string): ParsedVar[] {
    // Priority 1: fenced ```vks block — used by type: variables files
    const fenced = VKS_FENCE_RE.exec(content);
    if (fenced) { return parseVarLines(fenced[1]); }

    // Priority 2: unfenced section after the code block ("vars:" or "vars" label)
    const afterCode = content
        .replace(FRONTMATTER_STRIP_RE, '') // strip frontmatter
        .replace(CODE_FENCE_RE, '');       // strip first code block
    const unfenced = /\bvars:?\s*\r?\n([\s\S]+?)(?:\n\n|\n*$)/.exec(afterCode);
    if (unfenced) { return parseVarLines(unfenced[1]); }

    return [];
}

/**
 * Scans raw code for `<VK-hint>` tokens and returns a deduplicated list of `ParsedVar` objects.
 *
 * A valid token must match `<VK-hint>` where `hint` starts with a letter and is followed by
 * zero or more letters, digits, or underscores. The full `VK-hint` string (without angle
 * brackets) becomes the `name` field; `defaultValue` is always `''`. Duplicate tokens
 * (same name in multiple positions) are collapsed to a single entry in first-appearance order.
 *
 * @param code - Arbitrary string, typically the content of a code block.
 * @returns Deduplicated array of `{ name, defaultValue }` objects, or `[]` when no tokens are found.
 *
 * @example
 * extractVars('curl <VK-host>/<VK-path> -H "x: <VK-host>"')
 */
export function extractVars(code: string): ParsedVar[] {
    const seen = new Set<string>();
    const vars: ParsedVar[] = [];
    for (const m of code.matchAll(VK_TOKEN_RE)) {
        const name = `VK-${m[1]}`;
        if (!seen.has(name)) {
            seen.add(name);
            vars.push({ name, defaultValue: '' });
        }
    }
    return vars;
}

/**
 * Substitutes `<VK-hint>` tokens in `code` with values from the `vars` map.
 *
 * Each occurrence of a `<VK-hint>` token whose key (`VK-hint`) appears in `vars`
 * is replaced with the corresponding value. Tokens absent from the map are left
 * unchanged so partial substitution is safe. Non-VK syntax — HTML tags, TypeScript
 * generics, template literals, Handlebars — is never touched.
 *
 * @param code - String potentially containing `<VK-hint>` tokens.
 * @param vars - Map of full token name (e.g. `'VK-host'`) to replacement value.
 * @returns The string with all resolvable tokens substituted.
 *
 * @example
 * resolveVars('http://<VK-host>:<VK-port>', { 'VK-host': 'localhost', 'VK-port': '3000' })
 *
 * @example
 * resolveVars('<VK-known> <VK-unknown>', { 'VK-known': 'hi' })
 */
export function resolveVars(code: string, vars: Record<string, string>): string {
    return code.replaceAll(VK_TOKEN_RE, (match, hint: string) => {
        const key = `VK-${hint}`;
        return key in vars ? vars[key] : match;
    });
}

/**
 * Parses `##`-headed sections from vault file content into an ordered array of `ParsedBlock` objects.
 *
 * Detection rule: after stripping frontmatter, if the remaining content contains at least one
 * `## ` heading followed (anywhere in its section) by a fenced code block, each such section
 * is returned as a `ParsedBlock`. Returns `[]` when no qualifying sections are found, which
 * signals that the file uses the classic single-block format.
 *
 * Vars for each block are auto-detected from `<VK-hint>` tokens in the block's code via
 * `extractVars`; `defaultValue` is always `''` because there is no explicit vars section per block.
 *
 * @param content - Full UTF-8 string content of the `.md` file.
 * @returns Ordered array of `ParsedBlock` objects, or `[]` for single-block files.
 *
 * @example
 * parseBlocks('---\ntype: snippet\n---\n## Dev\ndev server\n```bash\nhttp://<VK-host>\n```\n## Prod\n```bash\nhttp://prod.example.com\n```')
 */

export function parseBlocks(content: string): ParsedBlock[] {
    // Strip frontmatter before scanning
    const body = content.replace(FRONTMATTER_STRIP_RE, '');

    // Split on ## headings — keep delimiter at start of each chunk via lookahead
    const sections = body.split(/(?=^## )/m).filter(s => s.startsWith('## '));
    if (sections.length === 0) { return []; }

    const blocks: ParsedBlock[] = [];
    for (const section of sections) {
        const block = parseBlockSection(section);
        if (block) { blocks.push(block); }
    }
    return blocks;
}

/**
 * Parses one `## Heading`-prefixed chunk into a `ParsedBlock`.
 *
 * Returns `null` when the chunk lacks either the heading or a fenced code block,
 * letting `parseBlocks` skip malformed sections without nesting another `if`.
 *
 * @param section - Raw text of a single `##`-prefixed section, including its heading line.
 * @returns Populated `ParsedBlock`, or `null` to signal "skip".
 *
 * @example
 * parseBlockSection('## Dev\nlocal\n```bash\nhttp://<VK-host>\n```')
 */
function parseBlockSection(section: string): ParsedBlock | null {
    const headingMatch = /^## (.+)/.exec(section);
    if (!headingMatch) { return null; }

    const fenceMatch = CODE_FENCE_RE.exec(section);
    if (!fenceMatch) { return null; }

    const heading   = headingMatch[1].trim();
    const fenceLang = fenceMatch[1] || undefined;
    const code      = fenceMatch[2].trimEnd();

    // Description: text between heading line and the opening fence
    const headingEnd = section.indexOf('\n') + 1;
    const fenceStart = section.indexOf('```');
    const description = section.slice(headingEnd, fenceStart).trim();

    // ` ```vks ``` ` as the *first* fence → pure variable sub-set (multi-block
    // variable files). A code fence *followed by* a ` ```vks ``` ` fence → the
    // vks fence supplies default values for the code's auto-detected `<VK-…>`
    // tokens. A bare code fence → tokens detected with empty defaults.
    const vars = fenceLang === 'vks'
        ? parseVarLines(code)
        : mergeVarDefaults(extractVars(code), readTrailingVarsFence(section));

    return { heading, description, code, fenceLang, vars };
}

/**
 * Returns the `KEY=value` pairs of a ` ```vks ``` ` fence that follows the
 * section's code fence, or `[]` when the section has no such fence.
 *
 * `VKS_FENCE_RE` only matches a fence whose info-string is exactly `vks`, so
 * the leading ` ```javascript ``` ` code fence is never mistaken for it.
 *
 * @param section - Raw text of a single `##`-prefixed section.
 * @returns Ordered array of `{ name, defaultValue }` from the vks fence, or `[]`.
 *
 * @example
 * readTrailingVarsFence('## A\n```js\nf(<VK-x>)\n```\n```vks\nVK-x=1\n```')
 */
function readTrailingVarsFence(section: string): ParsedVar[] {
    const fence = VKS_FENCE_RE.exec(section);
    return fence ? parseVarLines(fence[1]) : [];
}

/**
 * Overlays `defaults` onto the code-detected `vars`, preserving code order.
 *
 * Detected vars keep their first-appearance order; a matching `defaults` entry
 * (same `name`) supplies its `defaultValue`. Any `defaults` entry with no
 * matching detected var is appended in declaration order so users can declare
 * extra defaults the code does not (yet) reference.
 *
 * @param detected - Vars auto-detected from the code block (defaultValue always `''`).
 * @param defaults - Vars parsed from the trailing ` ```vks ``` ` fence.
 * @returns Merged, de-duplicated `ParsedVar[]` in code-then-extra order.
 *
 * @example
 * mergeVarDefaults([{ name: 'VK-a', defaultValue: '' }], [{ name: 'VK-a', defaultValue: '1' }])
 */
function mergeVarDefaults(detected: ParsedVar[], defaults: ParsedVar[]): ParsedVar[] {
    if (defaults.length === 0) { return detected; }
    const byName = new Map(defaults.map(d => [d.name, d.defaultValue]));
    const merged: ParsedVar[] = detected.map(v => ({
        name: v.name,
        defaultValue: byName.has(v.name) ? byName.get(v.name)! : v.defaultValue,
    }));
    const detectedNames = new Set(detected.map(v => v.name));
    for (const d of defaults) {
        if (!detectedNames.has(d.name)) { merged.push({ name: d.name, defaultValue: d.defaultValue }); }
    }
    return merged;
}

/**
 * Parses pre-read vault `.md` file content into a structured object.
 *
 * Functionally identical to `parseArtifactFile` but accepts the file content
 * as a string rather than reading it from disk. Intended for async callers
 * (e.g. the QuickPick picker) that read file bytes via `vscode.workspace.fs`.
 *
 * @param content         - UTF-8 file content string.
 * @param filePath        - Absolute OS path to the file (used to compute `fileName` and `relativePath`).
 * @param artifactRootDir - Absolute path to the artifact root directory.
 * @returns Fully populated `ParsedArtifactFile`.
 *
 * @example
 * const bytes = await vscode.workspace.fs.readFile(uri);
 * const content = new TextDecoder().decode(bytes);
 * parseFromContent(content, uri.fsPath, rootUri.fsPath);
 */
export function parseFromContent(content: string, filePath: string, artifactRootDir: string): ParsedArtifactFile {
    // A file with no `type:` is typed by the directory it was filed in — vault
    // files routinely carry no frontmatter at all, and without this a
    // `Commands/` file parsed as 'snippet' and inserted at the cursor instead
    // of being sent to the terminal.
    const frontmatter = parseFrontmatter(content, getTypeForDir(path.basename(artifactRootDir)));
    const { code, fenceLang } = parseCodeBlock(content);
    if (!frontmatter.language && fenceLang) { frontmatter.language = fenceLang; }
    return {
        filePath,
        fileName:     path.basename(filePath, '.md'),
        relativePath: path.relative(artifactRootDir, filePath),
        frontmatter,
        code,
        vars:         parseVars(content),
        blocks:       parseBlocks(content),
    };
}

/**
 * Reads and fully parses a single vault `.md` artifact file into a structured object.
 *
 * Thin wrapper around `parseFromContent` that handles disk I/O. Combines frontmatter,
 * code block, and vars section into a `ParsedArtifactFile` that the picker panel
 * uses for display and insert-time variable resolution.
 *
 * @param filePath - Absolute path to the `.md` file on disk.
 * @param artifactRootDir - Absolute path to the artifact's root directory
 *   (e.g. `/vault/Snippets`). Used to compute the `relativePath` field.
 * @returns Fully populated `ParsedArtifactFile`, or `null` if the file cannot be read.
 *
 * @example
 * parseArtifactFile('/vault/Snippets/Web/express-route.md', '/vault/Snippets')
 */
export function parseArtifactFile(filePath: string, artifactRootDir: string): ParsedArtifactFile | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return parseFromContent(content, filePath, artifactRootDir);
    } catch {
        // File unreadable or parse error — caller shows appropriate UI feedback
        return null;
    }
}
