import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const sourcePath = "/Users/tony/Github/nota/docs/nota-pitch-deck.pptx";
const outputPath = "/Users/tony/Github/nota/docs/.codex-pitch-build/candidate.pptx";

const presentation = await PresentationFile.importPptx(await FileBlob.load(sourcePath));
const proto = presentation.toProto();

// The source deck used a blue/orange Office-like palette. Replace the visible
// palette in the imported artifact while retaining neutral black/white and
// the deck's editable charts, tables, geometry and copy.
const palette = new Map([
  ["10233F", "101B26"],
  ["0A1628", "0B1924"],
  ["33415C", "274A62"],
  ["66748A", "5B6B78"],
  ["E5A13A", "407598"],
  ["B87A17", "386888"],
  ["1B3A63", "386888"],
  ["46536B", "477593"],
  ["DDE5EF", "CBD8E2"],
  ["EEF2F7", "F3F5F7"],
  ["C6D5E8", "EBF1F5"],
  ["27456F", "274A62"],
  ["2E7D6B", "386888"],
  ["888888", "7C8D98"],
  ["A8453B", "B87569"],
  ["6B3029", "8E5B53"],
  ["23524A", "274A62"],
  ["AEC0D8", "9EB6B2"],
  ["9FB3CC", "9EB6B2"],
  ["D2802A", "407598"],
  ["FBEDEB", "F6E6E2"],
  ["7A2E26", "8E5B53"],
  ["E9F3EF", "E9F1F5"],
  ["1D5648", "274A62"],
  ["1E4A3F", "274A62"],
  ["7FC9B0", "7D93A2"],
  ["3A2C12", "1C3547"],
  ["F0DCB8", "8FB8D0"],
  ["FDF4E6", "EBF1F5"],
  ["E4EAF2", "EBF1F5"],
  ["F9F9F9", "FCFBF8"],
  ["4E6E96", "386888"],
  ["9AAABF", "8FA5B3"],
  ["C3CEDC", "CBD8E2"],
]);

function replaceColors(value) {
  if (typeof value === "string") return palette.get(value.toUpperCase()) ?? value;
  if (Array.isArray(value)) return value.map(replaceColors);
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) value[key] = replaceColors(child);
  }
  return value;
}

replaceColors(proto);
const refreshed = PresentationFile.importPptx
  ? await PresentationFile.importPptx(await FileBlob.load(sourcePath))
  : null;
void refreshed;

// Rehydrate the edited proto through Artifact Tool's public presentation
// facade, then add the exact favicon PNG as an editable deck image on the cover.
const { Presentation } = await import("@oai/artifact-tool");
const edited = Presentation.load(proto);
edited.theme.colorScheme = {
  name: "Nota Editorial",
  themeColors: {
    accent1: "#386888", accent2: "#407598", accent3: "#B87569",
    accent4: "#7D93A2", accent5: "#477593", accent6: "#274A62",
    bg1: "#F3F5F7", bg2: "#FBFCFD", tx1: "#101B26", tx2: "#5B6B78",
    dk1: "#0B1924", dk2: "#274A62", lt1: "#FBFCFD", lt2: "#EBF1F5",
    hlink: "#386888", folHlink: "#274A62",
  },
};

const favicon = new Uint8Array(await fs.readFile("/Users/tony/Github/nota/apps/web/public/icon-192.png"));
edited.slides.getItem(0).images.add({
  blob: favicon,
  contentType: "image/png",
  alt: "Nota logo",
  fit: "contain",
  position: { left: 72, top: 145, width: 48, height: 48 },
  geometry: "roundRect",
  borderRadius: 6,
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await (await PresentationFile.exportPptx(edited)).save(outputPath);
