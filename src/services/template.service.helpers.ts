/**
 * Pure name helpers shared by **every** whole-file artifact flow.
 *
 * `template` and `agent` both write a file into the workspace, so both resolve a
 * filename from attacker-influenced frontmatter. The rules that decision needs —
 * path-injection rejection, "does this already carry an extension", trailing-dot
 * trimming — are identical for both and therefore live here once, imported by
 * `template.service.ts` rather than copied per type.
 *
 * `vscode`-free and side-effect free: unit-testable without an extension host.
 */

/** Path-injection characters/sequences that must never reach a filename segment. */
const PATH_INJECTION_RE = /[/\\\0]|\.\./;

/**
 * Rejects a value that could break out of a single path segment. `extension:`,
 * `target:` and the typed filename are all attacker-influenced (plan §5.2), so a
 * value carrying a separator, a `..`, or a NUL **throws** — it is never sanitised
 * into something plausible.
 *
 * @param value - The untrusted string (typed name, frontmatter extension, or target).
 * @param label - Human label used in the thrown message.
 * @throws {Error} When `value` contains `/`, `\`, `..`, or a NUL byte.
 *
 * @example
 * assertNoPathInjection('Button.tsx', 'filename'); // ok
 * assertNoPathInjection('../x', 'filename');        // throws
 */
export function assertNoPathInjection(value: string, label: string): void {
    if (PATH_INJECTION_RE.test(value)) {
        throw new Error(`Invalid ${label}: "${value}" contains a path separator, "..", or a NUL byte.`);
    }
}

/**
 * Reports whether a name already carries a usable extension: a dot that is not
 * the first character and has at least one non-dot/-separator char after it.
 *
 * @param name - The candidate filename.
 * @returns `true` when the name ends in `.<ext>` (leading-dot dotfiles excluded).
 *
 * @example
 * carriesExtension('Button.tsx')  // true
 * carriesExtension('Makefile')    // false
 * carriesExtension('.gitignore')  // false — a dotfile, not an extension
 */
export function carriesExtension(name: string): boolean {
    const lastDot = name.lastIndexOf('.');
    return lastDot > 0 && lastDot < name.length - 1;
}

/**
 * Strips trailing `.` characters from a base name via a linear scan.
 *
 * Used instead of `replace(/\.+$/, '')` — an anchored `\.+$` trips SonarLint's
 * super-linear-backtracking heuristic (S8786); a character scan is unambiguously
 * linear and reads the same.
 *
 * @param s - The candidate base name.
 * @returns `s` with any trailing dots removed.
 *
 * @example
 * stripTrailingDots('name...') // 'name'
 * stripTrailingDots('name')    // 'name'
 */
export function stripTrailingDots(s: string): string {
    let end = s.length;
    while (end > 0 && s[end - 1] === '.') { end--; }
    return s.slice(0, end);
}
