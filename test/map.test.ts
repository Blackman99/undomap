import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mapPath } from "../src/run.ts";
import { git, materialize } from "./helpers.ts";

const byPath = (r: ReturnType<typeof mapPath>) => Object.fromEntries(r.findings.map((f) => [f.path, f]));

test("textures-app (cline#15023 shape): gitignored originals are Zone VE, ranked first", () => {
  const fx = materialize("textures-app");
  try {
    const r = mapPath(fx.dir, { noProbe: true });
    const f = byPath(r);
    assert.equal(r.findings[0].path, "textures_sorted/");
    assert.equal(f["textures_sorted/"].zone, "VE");
    assert.equal(f["textures_sorted/"].kind, "ignored");
    assert.equal(f["textures_sorted/"].bytes, 40960 + 24576);
    assert.equal(f["textures_sorted/"].files, 2);
    assert.equal(f[".env"].zone, "VE");
    assert.equal(f[".env"].secret, true);
    assert.equal(f["notes/"].kind, "untracked");
    assert.equal(f["build.log"].zone, "VE");
    assert.equal(f["node_modules/"].zone, "AE");
    assert.equal(f["dist/"].zone, "AE");
    assert.equal(f["src/app.js"].kind, "dirty");
    assert.equal(f["./"].zone, "X");
    assert.equal(f["./"].files, 3); // .gitignore, package.json, src/index.js (app.js is dirty)
    assert.equal(f["./.git/"].kind, "no-remote");
    assert.equal(r.exitCode, 1);
    assert.equal(r.repos.length, 1);
  } finally {
    fx.cleanup();
  }
});

test("mapping is read-only: git's index is not rewritten", () => {
  const fx = materialize("textures-app");
  try {
    const idx = join(fx.dir, ".git", "index");
    const before = statSync(idx).mtimeMs;
    // make the index stale so a normal `git status` would want to refresh it
    writeFileSync(join(fx.dir, "src", "index.js"), "export const sort = (xs) => [...xs].sort();\n");
    mapPath(fx.dir, { noProbe: true });
    assert.equal(statSync(idx).mtimeMs, before);
  } finally {
    fx.cleanup();
  }
});

test("snapshot coverage moves fragile paths to Zone AE", () => {
  const fx = materialize("textures-app");
  try {
    const prev = process.env.UNDOMAP_SNAPSHOTS;
    process.env.UNDOMAP_SNAPSHOTS = `fake:test snapshot:${join(fx.dir, "textures_sorted")}`;
    try {
      const f = byPath(mapPath(fx.dir));
      assert.equal(f["textures_sorted/"].zone, "AE");
      assert.equal(f["textures_sorted/"].kind, "snapshot");
      assert.equal(f[".env"].zone, "VE");
    } finally {
      if (prev === undefined) delete process.env.UNDOMAP_SNAPSHOTS;
      else process.env.UNDOMAP_SNAPSHOTS = prev;
    }
  } finally {
    fx.cleanup();
  }
});

test("a pushed repo has no no-remote finding; a new local commit shows as unpushed", () => {
  const fx = materialize("textures-app", { remote: true });
  try {
    let f = byPath(mapPath(fx.dir, { noProbe: true }));
    assert.equal(f["./.git/"], undefined);
    git(fx.dir, "commit", "-qam", "local only");
    f = byPath(mapPath(fx.dir, { noProbe: true }));
    assert.equal(f["./.git/"].kind, "unpushed");
    assert.equal(f["./.git/"].zone, "AE");
    assert.equal(f["./.git/"].unpushed, 1);
  } finally {
    fx.cleanup();
  }
});

test("config: .undomap.json marks paths as backed up or regenerable", () => {
  const fx = materialize("textures-app");
  try {
    writeFileSync(join(fx.dir, ".undomap.json"), JSON.stringify({ backedUp: ["textures_sorted/"], regenerable: ["*.log"] }));
    const f = byPath(mapPath(fx.dir, { noProbe: true }));
    assert.equal(f["textures_sorted/"].kind, "backed-up");
    assert.equal(f["build.log"].zone, "AE");
    writeFileSync(join(fx.dir, ".undomap.json"), JSON.stringify({ backedup: [] }));
    assert.throws(() => mapPath(fx.dir, { noProbe: true }), /unknown key "backedup"/);
  } finally {
    fx.cleanup();
  }
});

test("scanning a subdirectory of a repo keeps git context", () => {
  const fx = materialize("textures-app");
  try {
    const r = mapPath(join(fx.dir, "src"), { noProbe: true });
    const f = byPath(r);
    assert.equal(f["app.js"].kind, "dirty");
    assert.equal(f["./"].files, 1);
  } finally {
    fx.cleanup();
  }
});

test("plain folder: repos inside are mapped with git, the rest is outside git", () => {
  const fx = materialize("workspace");
  try {
    const r = mapPath(fx.dir, { noProbe: true });
    const f = byPath(r);
    assert.equal(f["scratch/"].kind, "no-git");
    assert.equal(f["*"].kind, "no-git");
    assert.equal(f["project/"].zone, "X");
    assert.equal(f["project/"].files, 2);
    assert.equal(r.repos.length, 1);
    assert.equal(r.repos[0].remote, "origin");
    if (process.platform !== "win32") {
      assert.equal(f["shared"].kind, "symlink-escape");
      assert.equal(f["shared"].target, join(fx.base, "outside"));
      assert.equal(f["shared"].bytes, "token: fake\n".length);
    }
  } finally {
    fx.cleanup();
  }
});
