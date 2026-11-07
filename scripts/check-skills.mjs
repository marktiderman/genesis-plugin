// Every skill in skills/ is in the README table, has an eval case that names it, and keeps
// SKILL.md under 500 lines. Exits 1 with one line per problem.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const evalsDir = path.join(root, "evals");
const cases = existsSync(evalsDir) ? readdirSync(evalsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "results").map((d) => d.name) : [];
const graderFiles = cases.flatMap((c) => {
  const dir = path.join(evalsDir, c, "graders");
  return existsSync(dir) ? readdirSync(dir).map((f) => readFileSync(path.join(dir, f), "utf8")) : [];
});
// The skills a Skill-call grader names: the alternatives in its input_match "skill" value, e.g.
// '"skill"\s*:\s*"(?:[\w-]+:)?(?:1-3-1|one-three-one)"' names 1-3-1 and one-three-one.
// Only a grader that needs the skill to fire counts: its min (default 1) must be at least 1 and its
// max, if set, above 0. A should-not-fire grader (min: 0 or max: 0) proves nothing.
const front = (t) => /^---\n([\s\S]*?)\n---/.exec(t)?.[1] ?? "";
const graded = new Set(
  graderFiles
    .map(front)
    .filter((f) => /^type:\s*tool_used\s*$/m.test(f) && /^tool:\s*Skill\s*$/m.test(f))
    .filter((f) => !/^min:\s*0\s*$/m.test(f) && !/^max:\s*0\s*$/m.test(f))
    .flatMap((t) =>
      // The value after "skill": an optional (?:[\w-]+:)? or literal plugin prefix, then a name or (?:a|b).
      [...t.matchAll(/^input_match:\s*'"skill"\\s\*:\\s\*"(.+)"'\s*$/gm)].flatMap((m) =>
        m[1]
          .replace(/^\(\?:[^()]*:\)\?/, "")
          .replace(/^[\w-]+:(?=[\w(])/, "")
          .replace(/^\(\?:|\)$/g, "")
          .split("|"),
      ),
    ),
);
const problems = [];
for (const d of readdirSync(path.join(root, "skills"), { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const file = path.join(root, "skills", d.name, "SKILL.md");
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  const name = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? d.name;
  if (!readme.includes(`/genesis:${name}\``)) problems.push(`${name}: not in the README skills table`);
  const lines = text.split("\n").length;
  if (lines > 500) problems.push(`${name}: SKILL.md has ${lines} lines (limit 500)`);
  const tested = graded.has(name);
  if (!tested && name !== "map") // map is tested by its own node tests in CI
    problems.push(`${name}: no eval case's grader names the skill`);
}
for (const p of problems) console.error(`✗ ${p}`);
if (problems.length) process.exit(1);
console.log("✔ Every skill is listed, tested and under 500 lines.");
