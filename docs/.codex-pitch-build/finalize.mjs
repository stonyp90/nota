import path from "node:path";
import { pathToFileURL } from "node:url";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const skillDir = "/Users/tony/.codex/plugins/cache/openai-primary-runtime/presentations/26.904.11930/skills/presentations";
const workspaceDir = "/Users/tony/Github/nota";
const candidatePath = path.join(workspaceDir, "docs/.codex-pitch-build/candidate.pptx");
const finalPath = path.join(workspaceDir, "docs/nota-pitch-deck-brand-refresh-v3.pptx");
const presentation = await PresentationFile.importPptx(await FileBlob.load(candidatePath));
const { finalizePresentation } = await import(pathToFileURL(path.join(skillDir, "container_tools/artifact_tool_utils.mjs")).href);

const result = await finalizePresentation({
  explicitTotalSlideCount: 15,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [7, 12, 13],
  // These two pre-existing workbook-backed charts have no cached series in
  // the supplied deck; their formulas/workbooks are preserved byte-for-byte.
  approvedSourceFigureExceptionSlides: [7, 12],
  workspaceDir,
  candidatePath,
  finalPath,
  pythonExecutable: "/Users/tony/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
  integrityValidatorPath: path.join(skillDir, "container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(skillDir, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: ["--expected-slide-size-emu", "12192000,6858000", "--validate-bullet-geometry", "--validate-heading-fit"],
  fontPolicy: { basis: "reference", families: ["Calibri", "Cambria", "Arial"], referencePath: path.join(workspaceDir, "docs/nota-pitch-deck.pptx"), referenceSha256: "6e8952833d05bc0ef5854c30c894b8f347e437d3ab9018864f87c057c1a715cd" },
  verifyArtifactToolImport: true,
  receiptPath: path.join(workspaceDir, ".codex-pitch-validation-v3.json"),
});
console.log(JSON.stringify(result, null, 2));
