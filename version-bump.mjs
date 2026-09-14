import { readFileSync, writeFileSync } from "fs";

// Run by `npm version <patch|minor|major>`: copies the new version into the
// manifest and records which Obsidian version it needs, so the release
// workflow and Obsidian's updater agree on what shipped.
const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	throw new Error("npm_package_version is not set — run this via `npm version`.");
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, "\t")}\n`);

console.log(`Bumped to ${targetVersion} (requires Obsidian ${minAppVersion}).`);
