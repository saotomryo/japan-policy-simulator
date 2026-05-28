import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const outputDir = "_site";
const entries = ["index.html", "src", "data", "assets", ".nojekyll"];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const entry of entries) {
  await cp(entry, `${outputDir}/${entry}`, { recursive: true });
}

await writeFile(`${outputDir}/404.html`, await readFile("index.html", "utf8"));
