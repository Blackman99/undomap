import { build } from "esbuild";
import { chmodSync } from "node:fs";

const common = { bundle: true, platform: "node", target: "node18", format: "esm", legalComments: "none", logLevel: "warning" };
await build({ ...common, entryPoints: ["src/cli.ts"], outfile: "dist/cli.js", banner: { js: "#!/usr/bin/env node" } });
await build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/index.js" });
await build({ ...common, entryPoints: ["src/action.ts"], outfile: "dist/action.js", target: "node20" });
// Landing page: the real grader + the flood map (d3-contour), no Node APIs.
await build({ bundle: true, platform: "browser", format: "esm", target: "es2020", minify: true, entryPoints: ["site-src/app.js"], outfile: "site/app.js", legalComments: "none", logLevel: "warning" });
chmodSync("dist/cli.js", 0o755);
console.log("built dist/cli.js dist/index.js dist/action.js site/app.js");
