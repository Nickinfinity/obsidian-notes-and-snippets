/**
 * All recognised artifact categories in the Obsidian vault.
 * Must match the `type` field written in a file's YAML frontmatter.
 */
export type ArtifactType = 'snippet' | 'template' | 'command' | 'agent' | 'variables';

/**
 * Structured representation of a vault file's YAML frontmatter block.
 *
 * All fields except `type` are optional — the parser falls back to safe defaults
 * when a field is absent or unrecognised.
 *
 * Frontmatter format in the vault file:
 * ```md
 * ---
 * type: snippet
 * title: Express Route
 * description: Basic route handler
 * language: javascript
 * tags: [express, api]
 * ---
 * ```
 */
export interface ParsedFrontmatter {
    /** Artifact category — drives insert behaviour and the type badge colour in the picker. */
    type: ArtifactType;
    /** Human-readable title shown in the picker header; falls back to the file name. */
    title?: string;
    /** Short description rendered below the title in the picker preview. */
    description?: string;
    /** Programming language of the code block (e.g. `javascript`, `tsx`, `bash`). */
    language?: string;
    /** Tag list parsed from `tags: [a, b, c]` frontmatter syntax. */
    tags?: string[];
    /** Deployment environment label — used only for `type: variables` files (e.g. `dev`, `prod`). */
    env?: string;
    /** Destination file for agent configs — used only for `type: agent` files (e.g. `CLAUDE.md`). */
    target?: string;
    /**
     * File extension for the written file — **`type: template` only**. Overrides the
     * fence language when resolving the output filename (D3 precedence:
     * user-typed → this key → fence language). Accepted with or without the leading
     * dot; a value carrying a path separator is rejected, never sanitised.
     */
    extension?: string;
    /** AI provider that authored/owns this config — **`type: agent` only** (e.g. `Claude`). */
    provider?: string;
    /** Model family for the agent config — **`type: agent` only** (e.g. `Opus`). */
    model?: string;
    /** Model version string — **`type: agent` only** (e.g. `4.8`). */
    version?: string;
}

/**
 * A single `{{PLACEHOLDER}}` variable definition extracted from the vars section.
 *
 * Variables are displayed as editable input fields in the picker so the user
 * can override defaults before inserting.
 *
 * @example
 * // Source in the vault file (unfenced section):
 * // vars:
 * // port=8080
 * // image=nginx
 *
 * // Parsed result:
 * [
 *   { name: 'port',  defaultValue: '8080'  },
 *   { name: 'image', defaultValue: 'nginx' },
 * ]
 */
export interface ParsedVar {
    /** Variable name, matching the `{{NAME}}` placeholder in the code block. */
    name: string;
    /** Pre-filled default shown in the picker input field; may be an empty string. */
    defaultValue: string;
}

/**
 * A single `##`-headed section parsed from a multi-block vault file.
 *
 * Multi-block files contain two or more `##` headings, each followed by a fenced
 * code block. When present, the picker can let the user choose which block to insert.
 *
 * @example
 * {
 *   heading:     'Development',
 *   description: 'Local dev server URL',
 *   code:        'http://localhost:{{PORT}}',
 *   fenceLang:   'bash',
 *   vars:        [{ name: 'PORT', defaultValue: '' }],
 * }
 */
export interface ParsedBlock {
    /** The `##` heading text, with leading `#` and whitespace stripped. */
    heading: string;
    /** Optional description paragraph between the heading and the code fence. */
    description: string;
    /** Raw content of the fenced code block, trailing whitespace trimmed. */
    code: string;
    /** Language tag from the opening fence (e.g. `bash`, `javascript`); `undefined` when absent. */
    fenceLang?: string;
    /** Auto-detected `<VK-hint>` vars found in `code`; `defaultValue` is always `''`. */
    vars: ParsedVar[];
}

/**
 * Full parsed representation of a single `.md` vault artifact file.
 *
 * Returned by `parseArtifactFile()` and passed to the picker webview for
 * display and insert-time variable resolution.
 *
 * @example
 * {
 *   filePath:     '/vault/Snippets/express-route.md',
 *   fileName:     'express-route',
 *   relativePath: 'express-route.md',
 *   frontmatter:  { type: 'snippet', title: 'Express Route', language: 'javascript' },
 *   code:         'app.get("/{{route}}", (req, res) => { ... })',
 *   vars:         [{ name: 'route', defaultValue: '/test' }],
 * }
 */
export interface ParsedArtifactFile {
    /** Absolute OS path to the file on disk. */
    filePath: string;
    /** File name without the `.md` extension — used as a fallback display title. */
    fileName: string;
    /** Path relative to the artifact root directory (e.g. `Web/express-route.md`). */
    relativePath: string;
    /** Parsed YAML frontmatter block. */
    frontmatter: ParsedFrontmatter;
    /** Raw content of the ` ```code ` block, trimmed of trailing whitespace. */
    code: string;
    /** Ordered list of `{{PLACEHOLDER}}` variable definitions found in the file. */
    vars: ParsedVar[];
    /**
     * Parsed `##`-headed sections when the file is a multi-block file.
     * Empty array means the file uses the classic single-block format — `code` and `vars`
     * on the root object are authoritative in that case.
     */
    blocks: ParsedBlock[];
}

/**
 * A single entry returned when listing a vault directory.
 * Used to populate the file-browser panel in the picker.
 *
 * @example
 * { name: 'Web',           path: '/vault/Snippets/Web', isDirectory: true  }
 * { name: 'express-route', path: '/vault/Snippets/express-route.md', isDirectory: false }
 */
export interface VaultEntry {
    /** Display name — file name without `.md`, or folder name as-is. */
    name: string;
    /** Absolute OS path used for navigation and file reads. */
    path: string;
    /** `true` for sub-directories, `false` for `.md` files. */
    isDirectory: boolean;
}
