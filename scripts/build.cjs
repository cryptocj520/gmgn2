const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const parts = [
  path.join(root, "src", "header.txt"),
  path.join(root, "src", "core.js"),
  path.join(root, "src", "userscript-app.js"),
];
const outputDir = path.join(root, "dist");
const outputFile = path.join(outputDir, "gmgn-monitor.user.js");

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  outputFile,
  `${parts.map((file) => fs.readFileSync(file, "utf8").trim()).join("\n\n")}\n`,
  "utf8",
);

console.log(`Built ${path.relative(root, outputFile)}`);
