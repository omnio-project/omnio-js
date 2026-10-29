#!/usr/bin/env node
/**
 * Sort the `workspaces` array in the root `package.json` in topological order so that a workspace always comes after the workspaces it depends on.
 *
 * Runtime dependencies only (`dependencies` + `peerDependencies` + `optionalDependencies`). `devDependencies` are ignored because they would needlessly push leaf packages such as `@unikvs/testing` to the front.
 *
 * Glob patterns are not supported. Every `workspaces` entry must be an explicit directory.
 *
 * Usage: node scripts/sort-workspaces.mjs [--fix] [--root <dir>]
 *
 * - Without flags: check only. Exit 1 (without writing) when the order would change or a glob is present.
 *   This is what `mise run test:check` relies on.
 * - `--fix`: rewrite `package.json` in place when the order changes.
 *   This is what `mise run check` relies on.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const RUNTIME_DEP_KEYS = ["dependencies", "peerDependencies", "optionalDependencies"];

function printHelp() {
  console.log(`Sort package.json workspaces in topological order.

Usage:
  node scripts/sort-workspaces.mjs [--fix] [--root <dir>]

Options:
  --fix         Rewrite package.json when the order changes.
                Without this flag the script only checks and exits 1 on mismatch.
  --root <dir>  Repository root holding package.json (default: cwd).
  -h, --help    Show this help.

Notes:
  Glob patterns are not supported.
  Every workspaces entry must be an explicit directory such as "packages/core".`);
}

function compareNames(a, b) {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

/**
 * @param {string[]} argv
 *
 * @returns {{ fix: boolean, root: string }}
 */
function parseArgs(argv) {
  const args = {
    fix: false,
    root: process.cwd(),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--fix") {
      args.fix = true;
    } else if (arg === "--root") {
      const value = argv[++i];

      if (value === undefined || value === "") {
        throw new Error("Missing value for --root");
      }

      args.root = path.resolve(value);
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function main() {
  const { fix, root } = parseArgs(process.argv.slice(2));
  const rootPkgPath = path.join(root, "package.json");
  const rootPkg = JSON.parse(await fs.readFile(rootPkgPath, "utf8"));

  if (!Array.isArray(rootPkg.workspaces)) {
    throw new TypeError("Root package.json has no `workspaces` array.");
  }

  const original = [...rootPkg.workspaces];
  const nonStringIndex = original.findIndex((entry) => typeof entry !== "string");

  if (nonStringIndex !== -1) {
    throw new TypeError(
      `Root package.json workspaces[${nonStringIndex}] must be a string directory, got ${JSON.stringify(original[nonStringIndex])}.`,
    );
  }

  const globEntry = original.find((entry) => /[*?[\]{}!]/u.test(entry));

  // Fail before any package.json is written, including in --fix mode.
  if (globEntry !== undefined) {
    console.error(`error: unsupported glob workspace entry: ${JSON.stringify(globEntry)}`);
    console.error("Glob patterns are not supported by this sorter.");
    console.error("List every workspace directory explicitly and run again. Nothing was written.");
    process.exit(1);
  }

  const nameByDir = new Map();
  const depsByDir = new Map();

  for (const dir of new Set(original)) {
    let pkg;

    try {
      pkg = JSON.parse(await fs.readFile(path.join(root, dir, "package.json"), "utf8"));
    } catch {
      console.warn(`warning: cannot read ${dir}/package.json, kept as-is`);
      continue;
    }

    if (typeof pkg.name !== "string") {
      console.warn(`warning: ${dir}/package.json has no name, kept as-is`);
      continue;
    }

    nameByDir.set(dir, pkg.name);
    const depNames = new Set();

    for (const key of RUNTIME_DEP_KEYS) {
      const deps = pkg[key];

      if (typeof deps === "object" && deps !== null) {
        for (const name of Object.keys(deps)) {
          depNames.add(name);
        }
      }
    }

    depsByDir.set(dir, depNames);
  }

  const dirByName = new Map([...nameByDir].map(([dir, name]) => [name, dir]));

  // Build the graph: edge dep -> dependent.
  const indegree = new Map();
  const dependents = new Map();

  for (const dir of depsByDir.keys()) {
    indegree.set(dir, 0);
    dependents.set(dir, new Set());
  }

  for (const [dir, depNames] of depsByDir) {
    const internalDeps = new Set();

    for (const name of depNames) {
      const depDir = dirByName.get(name);

      if (depDir !== undefined && depDir !== dir) {
        internalDeps.add(depDir);
      }
    }

    indegree.set(dir, internalDeps.size);
    for (const depDir of internalDeps) {
      dependents.get(depDir).add(dir);
    }
  }

  // Kahn's algorithm with alphabetical tie-break for a stable result.
  const ready = [...indegree].filter(([, n]) => n === 0).map(([dir]) => dir);
  ready.sort(compareNames);

  const sorted = [];

  while (ready.length > 0) {
    const dir = ready.shift();
    sorted.push(dir);

    for (const dependent of dependents.get(dir)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) {
        ready.push(dependent);
        ready.sort(compareNames);
      }
    }
  }

  if (sorted.length !== depsByDir.size) {
    const remaining = [...indegree]
      .filter(([, n]) => n > 0)
      .map(([dir]) => `${dir} (${nameByDir.get(dir)})`)
      .toSorted();

    throw new Error(`Circular workspace dependency detected involving: ${remaining.join(", ")}`);
  }

  // Explicit entries we could not read are appended in deterministic name order.
  const sortedSet = new Set(sorted);
  const unsortedDirs = [...new Set(original)]
    .filter((dir) => !sortedSet.has(dir))
    .sort(compareNames);
  const next = [...sorted, ...unsortedDirs];

  const changed = next.length !== original.length || next.some((dir, i) => dir !== original[i]);

  if (!changed) {
    console.log("workspaces already sorted topologically.");

    return;
  }

  if (!fix) {
    console.error("workspaces are not topologically sorted.");
    console.error(`expected: ${JSON.stringify(next)}`);
    console.error("run with --fix to rewrite package.json.");
    process.exit(1);
  }

  rootPkg.workspaces = next;
  await fs.writeFile(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
  console.log("sorted workspaces topologically.");
}

await main();
