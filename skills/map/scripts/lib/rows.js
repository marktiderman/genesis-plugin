/**
 * What gitdata loads as a row, and where the rows are — stated once, for the whole tool.
 *
 * This is gitdata's contract, not ours, and until recently gitdata kept it private: `isRowFile`
 * was a module-local const in its `src/load.js`, unexported. So every consumer that writes into
 * `data/` answered the same question by copying the clauses, and this tool ended up with three
 * copies of the predicate and three flat directory reads. They did not stay in agreement:
 *
 *   - `map.mjs`'s copy spelled the README clause case-insensitively; `flows.mjs`'s spelled it
 *     `f !== "README.md"`. A table documented in `ReadMe.md` — a spelling gitdata's loader calls
 *     out by name as *not* a row — was read as a row by one half of this tool and not the other,
 *     and `map check` died on `no frontmatter block` with no `sync` able to clear it. That is the
 *     same defect the wholesale-rewrite comment in `map.mjs` was written to close, surviving in
 *     the half that comment did not reach.
 *   - all three read a table with one flat `readdirSync`, and **a gitdata table may nest**:
 *     `data/surfaces/2026/01/x.md` is a row of `surfaces`. So a nested row survived a rewrite that
 *     reports rows "replaced wholesale", was invisible to the drift check that exists to notice
 *     exactly that, and was loaded as a live row by gitdata all along. `map check` printed
 *     "Map is current." over a table it could not fully see.
 *
 * One copy can be wrong. Three copies are wrong in different directions at once, and the report
 * that would tell you is written by one of them.
 *
 * **These two names, and their behaviour, mirror `@marktiderman/gitdata` exactly** — it exports
 * `isRowFile` and `rowFilesIn` as of the change that made this contract public. They are spelled
 * the same on purpose: the day this plugin can take a dependency, each import below becomes a
 * one-line swap and this file is deleted. It is not a dependency today because the plugin ships as
 * a bare checkout with no install step — see `SKILL.md` ("nothing to install") — so an `import`
 * from a registry package would be `ERR_MODULE_NOT_FOUND` for every documented way of running it.
 *
 * Node built-ins only, no dependencies.
 */
import { readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * What gitdata loads as a row. `_`-prefixed files and the table's own README are not rows, and the
 * README clause is case-INSENSITIVE: `ReadMe.md` is documentation, which is the clause the two
 * copies of this predicate disagreed about.
 */
export const isRowFile = (name) =>
  name.endsWith(".md") && !name.startsWith("_") && name.toLowerCase() !== "readme.md";

/** The recursive half. `seen` holds real paths so a symlink loop cannot recurse forever. */
function walk(dir, prefix, seen) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // `_schema/`, `_views/`, and dotfiles are reserved the same way `_`-prefixed files are.
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Classify by what the entry points AT, not what it is: a Dirent for a symlink reports neither
    // file nor directory, which would drop every row behind a symlinked shard without a word.
    const stat = statSync(join(dir, entry.name));
    if (stat.isDirectory()) {
      const real = realpathSync(join(dir, entry.name));
      if (seen.has(real)) continue; // a link pointing at an ancestor
      out.push(...walk(join(dir, entry.name), rel, new Set([...seen, real])));
    } else if (isRowFile(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Every row file under a table directory, as paths relative to it, sorted — shards included.
 *
 * Sorted rather than left in directory order because everything this tool writes is compared byte
 * for byte by `check`; a list that depends on the order a filesystem hands entries back is a diff
 * that fails on somebody else's machine and nowhere else.
 *
 * Throws if `dir` is absent, exactly as gitdata's does. Callers for whom an absent table is an
 * absent table rather than an error guard with `existsSync` at their own call site, because that
 * judgement belongs to them: `data/flows/` missing means "this repo does not author flows", and
 * `data/surfaces/` missing during a rewrite means something else entirely.
 *
 * @returns {string[]}
 */
export function rowFilesIn(dir) {
  return walk(dir, "", new Set([realpathSync(dir)])).sort();
}
