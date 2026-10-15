// Best-effort probes for local snapshot coverage. A missing tool never fails the run: it is "unknown".
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type { Probe } from "./types.js";

export interface SnapshotInfo {
  probes: Probe[];
  /** Label of the snapshot that covers this absolute path, if any. */
  covers(abs: string): string | undefined;
}

type Run = (cmd: string, args: string[]) => { ok: boolean; out: string };
const defaultRun: Run = (cmd, args) => {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 8000, windowsHide: true });
    return { ok: r.status === 0, out: (r.stdout || "") + (r.status === 0 ? "" : r.stderr || "") };
  } catch {
    return { ok: false, out: "" };
  }
};

const count = (dir: string) => {
  try {
    return readdirSync(dir).length;
  } catch {
    return -1;
  }
};
const under = (abs: string, prefix: string) => abs === prefix || abs.startsWith(prefix.endsWith(sep) ? prefix : prefix + sep);

export interface ProbeOptions {
  platform?: string;
  home?: string;
  run?: Run;
  /** "off" skips probes; "fake:<label>:<abs prefix>" is a test hook. */
  mode?: string;
}

export function probeSnapshots(rootAbs: string, opts: ProbeOptions = {}): SnapshotInfo {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? (process.env.HOME || process.env.USERPROFILE || "");
  const run = opts.run ?? defaultRun;
  const mode = opts.mode ?? process.env.UNDOMAP_SNAPSHOTS ?? "";
  const probes: Probe[] = [];
  if (mode === "off") {
    probes.push({ name: "snapshots", status: "unknown", detail: "not probed (--no-probe)", counts: true });
    return { probes, covers: () => undefined };
  }
  if (mode.startsWith("fake:")) {
    const rest = mode.slice(5);
    const i = rest.indexOf(":");
    const label = i < 0 ? rest : rest.slice(0, i);
    const raw = i < 0 ? "" : rest.slice(i + 1);
    // Same resolution as the mapped root (Windows 8.3 short names, macOS /private/var).
    const prefix = raw && existsSync(raw) ? realpathSync.native(raw) : raw;
    probes.push({ name: "snapshots", status: "ok", detail: `${label} (test hook)`, counts: true });
    return { probes, covers: (abs) => (prefix && under(abs, prefix) ? label : undefined) };
  }

  let covers: SnapshotInfo["covers"] = () => undefined;

  if (platform === "darwin") {
    const dest = run("tmutil", ["destinationinfo"]);
    const local = run("tmutil", ["listlocalsnapshots", "/"]);
    if (!dest.ok && !local.ok && !dest.out && !local.out) {
      probes.push({ name: "time machine", status: "unknown", detail: "tmutil not available", counts: true });
    } else {
      const hasDest = dest.ok && /Name\s*:/i.test(dest.out);
      const n = local.ok ? (local.out.match(/com\.apple\.TimeMachine\./g) ?? []).length : 0;
      if (hasDest || n > 0) {
        const label = n > 0 ? `Time Machine (${n} local snapshot${n === 1 ? "" : "s"})` : "Time Machine backups";
        probes.push({ name: "time machine", status: "ok", detail: label, counts: true });
        const cache = new Map<string, boolean>();
        let calls = 0;
        covers = (abs) => {
          let excluded = cache.get(abs);
          if (excluded === undefined) {
            excluded = calls++ < 60 ? /\[Excluded\]/i.test(run("tmutil", ["isexcluded", abs]).out) : false;
            cache.set(abs, excluded);
          }
          return excluded ? undefined : label;
        };
      } else probes.push({ name: "time machine", status: "absent", detail: "no Time Machine destination, no local snapshots", counts: true });
    }
    probes.push(trashProbe(join(home, ".Trash"), "Trash"));
  } else if (platform === "linux") {
    const fm = run("findmnt", ["-n", "-o", "TARGET,FSTYPE", "-T", rootAbs]);
    const m = fm.ok ? /^(\S+)\s+(\S+)/.exec(fm.out.trim()) : null;
    if (!m) probes.push({ name: "snapshots", status: "unknown", detail: "findmnt not available", counts: true });
    else {
      const [, mount, fstype] = m;
      const snapper = fstype === "btrfs" ? count(join(mount, ".snapshots")) : -1;
      const zfs = fstype === "zfs" ? count(join(mount, ".zfs", "snapshot")) : -1;
      const ts = Math.max(count("/timeshift/snapshots"), count("/run/timeshift/backup/timeshift/snapshots"));
      if (snapper > 0 || zfs > 0) {
        const label = snapper > 0 ? `snapper (${snapper} btrfs snapshots of ${mount})` : `ZFS (${zfs} snapshots of ${mount})`;
        probes.push({ name: "snapshots", status: "ok", detail: label, counts: true });
        covers = (abs) => (under(abs, mount) ? label : undefined);
      } else if (ts > 0 && !under(rootAbs, "/home") && !under(rootAbs, "/root")) {
        const label = `Timeshift (${ts} snapshots)`;
        probes.push({ name: "snapshots", status: "ok", detail: label, counts: true });
        covers = (abs) => (under(abs, "/home") || under(abs, "/root") ? undefined : label);
      } else {
        const why = ts > 0 ? "Timeshift skips /home by default" : `no btrfs/ZFS/Timeshift snapshots on ${mount} (${fstype})`;
        probes.push({ name: "snapshots", status: "absent", detail: why, counts: true });
      }
    }
    probes.push(trashProbe(join(home, ".local", "share", "Trash"), "Trash"));
  } else if (platform === "win32") {
    probes.push({ name: "shadow copies", status: "unknown", detail: "VSS needs an admin shell to list (vssadmin list shadows)", counts: true });
    probes.push({ name: "recycle bin", status: "ok", detail: "present; rm, del and fs.rm skip it", counts: false });
  } else {
    probes.push({ name: "snapshots", status: "unknown", detail: `no probe for ${platform}`, counts: true });
  }
  return { probes, covers };
}

function trashProbe(dir: string, name: string): Probe {
  return existsSync(dir)
    ? { name: name.toLowerCase(), status: "ok", detail: "present; rm, rimraf and fs.rm skip it", counts: false }
    : { name: name.toLowerCase(), status: "absent", detail: "no trash folder", counts: false };
}
