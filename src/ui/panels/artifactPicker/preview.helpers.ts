import * as vscode from 'vscode';
import { resolveVars } from '../../../services/parser.service.js';
import type { ParsedArtifactFile, ParsedBlock } from '../../../types/parsed-artifact.types.js';
import { styleLinkTags } from '../../../utils/html.js';

/** WebviewPanel viewType used for both the read-only preview and the interactive popup. */
export const POPUP_VIEW_TYPE = 'obsidianArtifactPopupPreview';

/**
 * Converts a `VK-xxx` variable name to a human-readable input label.
 *
 * Strips the `VK-` prefix, replaces `_` separators with spaces, lowercases
 * the result, then capitalises the first letter.
 *
 * @param name - Full variable name including the `VK-` prefix.
 * @returns Human-readable label string.
 *
 * @example
 * labelForVar('VK-min_price')  // → 'Min price'
 * labelForVar('VK-MY_VAR')     // → 'My var'
 */
export function labelForVar(name: string): string {
    const hint   = name.startsWith('VK-') ? name.slice(3) : name;
    const joined = hint.replaceAll('_', ' ').toLowerCase();
    return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * Wraps popup body content in a complete HTML document that loads the shared stylesheet.
 *
 * @param body      - Inner HTML to place inside `<body>`.
 * @param cssUri    - Webview URI for the shared stylesheet.
 * @param cspSource - Webview CSP source token; falls back to `'unsafe-inline'` before
 *                    the panel is created (e.g. for the initial empty-state render).
 * @returns Complete HTML document string.
 *
 * @example
 * return popupShell('<p>Hello</p>', cssUri, cspSource);
 */
export function popupShell(body: string, cssUri: string | string[], cspSource = "'unsafe-inline'"): string {
    const linkTag = styleLinkTags(cssUri);
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource};">
${linkTag}
</head>
<body class="popup-body">${body}</body>
</html>`;
}

/**
 * Adapts a `ParsedBlock` into a minimal `ParsedArtifactFile` so it can be passed
 * to preview/insert helpers without changes.
 *
 * Inherits `frontmatter`, `filePath`, `fileName`, and `relativePath` from the
 * parent artifact; overrides `title`, `description`, `language`, `code`, `vars`,
 * and clears `blocks` (blocks never nest).
 *
 * @param block  - The block to adapt.
 * @param parent - The artifact the block belongs to.
 * @returns A `ParsedArtifactFile`-shaped object for the block.
 *
 * @example
 * const adapted = blockAsArtifact(item.block, currentArtifact);
 */
export function blockAsArtifact(block: ParsedBlock, parent: ParsedArtifactFile): ParsedArtifactFile {
    return {
        ...parent,
        frontmatter: {
            ...parent.frontmatter,
            title:       block.heading,
            description: block.description || undefined,
            language:    block.fenceLang ?? parent.frontmatter.language,
        },
        code:   block.code,
        vars:   block.vars,
        blocks: [],
    };
}

/**
 * Substitutes variables and delivers resolved content to the editor, terminal, or clipboard.
 *
 * For `type: command` artifacts the resolved text is sent to the active terminal (created
 * if absent). For all other types the text is inserted at the cursor; if no editor is open
 * it falls back to the clipboard with an informational message.
 *
 * @param editor   - Active text editor to insert into, or `undefined` when none is open.
 * @param artifact - Artifact supplying the code template and type.
 * @param vars     - Resolved `{ name → value }` map from the edit panel or input box.
 *
 * @example
 * performInsert(vscode.window.activeTextEditor, artifact, { 'VK-host': 'localhost' });
 */
export function performInsert(
    editor: vscode.TextEditor | undefined,
    artifact: ParsedArtifactFile,
    vars: Record<string, string>
): void {
    const content = resolveVars(artifact.code, vars);
    if (artifact.frontmatter.type === 'command') {
        const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal('Obsidian Artifacts');
        terminal.sendText(content, false);
        terminal.show(true);
        return;
    }
    if (editor) {
        editor.edit(edit => edit.insert(editor.selection.active, content));
        return;
    }
    vscode.env.clipboard.writeText(content);
    vscode.window.showInformationMessage('Obsidian Artifacts: No active editor — content copied to clipboard.');
}
