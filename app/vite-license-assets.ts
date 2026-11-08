// SPDX-FileCopyrightText: JR Lanteigne <root@dnim.dev>
// SPDX-License-Identifier: GPL-3.0-or-later
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Plugin } from "vite";

const run = promisify(execFile);

export function licenseAssets(web = false): Plugin {
  const root = path.resolve(import.meta.dirname, "..");
  const nodeModules = path.join(root, "app", "node_modules");
  return {
    name: "sharkfin-license-assets",
    apply: "build",
    generateBundle: {
      order: "post",
      async handler(_options, bundle) {
        const modules = new Set<string>();
        for (const entry of Object.values(bundle)) {
          if (entry.type !== "chunk") continue;
          for (const [id, { renderedLength }] of Object.entries(entry.modules)) {
            if (!renderedLength || !path.isAbsolute(id)) continue;
            const relative = path.relative(nodeModules, id);
            if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
              modules.add(relative.split(path.sep).join("/"));
            }
          }
        }

        const generation = run(process.platform === "win32" ? "python" : "python3", [
          path.join(root, "tools", "notices.py"),
        ]);
        const input = generation.child.stdin;
        // execFile reports the Python error if it exits before consuming stdin.
        input?.on("error", () => {});
        input?.end(JSON.stringify({ modules: [...modules], files: Object.keys(bundle), web }));
        const { stdout } = await generation;
        this.emitFile({ type: "asset", fileName: "THIRD-PARTY-NOTICES.md", source: stdout });
        this.emitFile({ type: "asset", fileName: "LICENSE", source: readFileSync(path.join(root, "LICENSE")) });
      },
    },
  };
}
