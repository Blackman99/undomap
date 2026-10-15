// Library entry: map a directory end to end.
import { collect, type CollectOptions } from "./collect.js";
import { loadConfig } from "./config.js";
import { grade, type Config } from "./grade.js";
import type { Report } from "./types.js";

export interface MapOptions extends CollectOptions {
  thresholdBytes?: number;
  config?: Config;
  configFile?: string;
}

export function mapPath(path: string, opts: MapOptions = {}): Report {
  const inv = collect(path, opts);
  const config = opts.config ?? loadConfig(inv.root, opts.configFile).config;
  return grade(inv, { thresholdBytes: opts.thresholdBytes, config });
}
