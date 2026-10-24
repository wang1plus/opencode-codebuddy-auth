import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("package scripts do not trigger npm git-dependency preparation", () => {
  // pacote runs `npm install` inside a cloned git dependency when the package
  // declares any of these scripts. OpenCode's embedded npm cannot self-exec,
  // so a `build` script breaks `opencode plugin add github:...`.
  const triggers = [
    "build",
    "prepare",
    "prepack",
    "preinstall",
    "install",
    "postinstall",
  ];
  assert.deepEqual(
    Object.keys(pkg.scripts).filter((name) => triggers.includes(name)),
    [],
  );
});

test("the committed dist is the install entrypoint", () => {
  assert.equal(pkg.main, "./dist/index.js");
  assert.equal(pkg.types, "./dist/index.d.ts");
  assert.ok(pkg.files.includes("dist"));
});
