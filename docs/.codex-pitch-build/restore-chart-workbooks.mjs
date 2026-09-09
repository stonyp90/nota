import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = "/Users/tony/Github/nota";
const candidate = path.join(root, "docs/.codex-pitch-build/candidate.pptx");
const source = path.join(root, "docs/nota-pitch-deck.pptx");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "nota-pitch-chart-"));
const candidateDir = path.join(scratch, "candidate");
const sourceDir = path.join(scratch, "source");
const chartPalette = new Map([
  ["10233F", "101B26"], ["0A1628", "0B1924"], ["33415C", "274A62"],
  ["66748A", "5B6B78"], ["E5A13A", "407598"], ["B87A17", "386888"],
  ["1B3A63", "386888"], ["46536B", "477593"], ["DDE5EF", "CBD8E2"],
  ["EEF2F7", "F3F5F7"], ["C6D5E8", "EBF1F5"], ["27456F", "274A62"],
  ["2E7D6B", "386888"], ["888888", "7C8D98"], ["A8453B", "B87569"],
  ["6B3029", "8E5B53"], ["23524A", "274A62"], ["9FB3CC", "9EB6B2"],
  ["D2802A", "407598"], ["FBEDEB", "F6E6E2"], ["7A2E26", "8E5B53"],
  ["E9F3EF", "E9F1F5"], ["1D5648", "274A62"], ["1E4A3F", "274A62"],
  ["7FC9B0", "7D93A2"], ["3A2C12", "1C3547"], ["F0DCB8", "8FB8D0"],
  ["FDF4E6", "EBF1F5"], ["E4EAF2", "EBF1F5"], ["F9F9F9", "FBFCFD"],
  ["4E6E96", "386888"], ["9AAABF", "8FA5B3"], ["C3CEDC", "CBD8E2"],
]);
await fs.mkdir(candidateDir);
await fs.mkdir(sourceDir);
await run("unzip", ["-q", candidate, "-d", candidateDir]);
await run("unzip", ["-q", source, "-d", sourceDir]);

// Artifact Tool keeps the edited slide package but does not carry through the
// source deck's embedded Excel relationships. Put those relationships back,
// keeping the original editable workbooks and formulas intact.
await fs.mkdir(path.join(candidateDir, "ppt/charts/_rels"), { recursive: true });
await fs.mkdir(path.join(candidateDir, "ppt/embeddings"), { recursive: true });
for (const n of [1, 2, 3]) {
  let chart = await fs.readFile(path.join(sourceDir, `ppt/charts/chart${n}.xml`), "utf8");
  // The supplied charts use a one-level multiLvlStrRef cache. Flattening that
  // cache keeps the same formula and displayed categories while making the
  // native chart data contract portable and readable by PowerPoint tooling.
  chart = chart.replaceAll("<c:multiLvlStrRef>", "<c:strRef>")
    .replaceAll("</c:multiLvlStrRef>", "</c:strRef>")
    .replaceAll("<c:multiLvlStrCache>", "<c:strCache>")
    .replaceAll("</c:multiLvlStrCache>", "</c:strCache>")
    .replaceAll("<c:lvl>", "")
    .replaceAll("</c:lvl>", "");
  for (const [from, to] of chartPalette) chart = chart.replaceAll(from, to);
  await fs.writeFile(path.join(candidateDir, `ppt/charts/chart${n}.xml`), chart);
  await fs.copyFile(path.join(sourceDir, `ppt/charts/_rels/chart${n}.xml.rels`), path.join(candidateDir, `ppt/charts/_rels/chart${n}.xml.rels`));
}
for (const name of await fs.readdir(path.join(sourceDir, "ppt/embeddings"))) {
  await fs.copyFile(path.join(sourceDir, "ppt/embeddings", name), path.join(candidateDir, "ppt/embeddings", name));
}

for (const n of [7, 12, 13]) {
  const relPath = path.join(candidateDir, `ppt/slides/_rels/slide${n}.xml.rels`);
  let rels = await fs.readFile(relPath, "utf8");
  rels = rels.replace(/\/ppt\/slides\/charts\/(chart[123]\.xml)/g, "/ppt/charts/$1");
  await fs.writeFile(relPath, rels);
}
const typesPath = path.join(candidateDir, "[Content_Types].xml");
let types = await fs.readFile(typesPath, "utf8");
types = types.replaceAll("/ppt/slides/charts/", "/ppt/charts/");
if (!types.includes('Extension="xlsx"')) {
  types = types.replace(/(<Types[^>]*>)/, '$1<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />');
}
await fs.writeFile(typesPath, types);

await fs.rm(candidate, { force: true });
await run("zip", ["-q", "-r", candidate, "."], { cwd: candidateDir });
console.log(candidate);
