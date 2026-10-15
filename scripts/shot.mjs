// Headless Chrome screenshots for logo PNGs, OG images and QA. usage: node scripts/shot.mjs <url|file> <out.png> <w> <h> [--transparent]
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const [src, out, w, h, ...rest] = process.argv.slice(2);
const url = /^https?:|^file:/.test(src) ? src : "file://" + resolve(src);
const args = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox", "--force-device-scale-factor=1", `--window-size=${w},${h}`, `--screenshot=${resolve(out)}`, "--virtual-time-budget=6000", "--allow-file-access-from-files"];
if (rest.includes("--transparent")) args.push("--default-background-color=00000000");
execFileSync("google-chrome", [...args, url], { stdio: ["ignore", "ignore", "pipe"] });
console.log("wrote", out);
