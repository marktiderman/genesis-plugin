// Every skill in skills/ is in the README table, has an eval case that names it, and keeps
// SKILL.md under 500 lines. Exits 1 with one line per problem.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const evalsDir = path.join(root, "evals");
const cases = existsSync(evalsDir) ? readdirSync(evalsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "results").map((d) => d.name) : [];
const caseText = cases.map((c) => {
  const dir = path.join(evalsDir, c, "graders");
  return existsSync(dir) ? readdirSync(dir).map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n") : "";
});
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
  const tested = caseText.some((t) => t.includes(`${name}"`) || t.includes(`|${name})`) || t.includes(`(?:${name}|`) || t.includes(`?${name}"`));
  if (!tested && name !== "map") // map is tested by its own node tests in CI
    problems.push(`${name}: no eval case's grader names the skill`);
}
for (const p of problems) console.error(`✗ ${p}`);
if (problems.length) process.exit(1);
console.log("✔ Every skill is listed, tested and under 500 lines.");
