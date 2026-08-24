import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const artifactRoot = path.join(repoRoot, "shortcuts/apple-pay-api");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("committed Apple Pay shortcut release is secret-free and matches its manifest", async () => {
  const manifest = JSON.parse(await readFile(path.join(artifactRoot, "manifest.json"), "utf8"));
  const source = await readFile(path.join(artifactRoot, manifest.sourceFile));
  const signedRelease = await readFile(path.join(artifactRoot, manifest.signedReleaseFile));
  const publicRelease = await readFile(path.join(artifactRoot, manifest.publicFile));
  const sourceText = source.toString("utf8");

  assert.equal(sha256(source), manifest.sourceSha256);
  assert.equal(sha256(signedRelease), manifest.signedReleaseSha256);
  assert.equal(signedRelease.byteLength, manifest.signedReleaseSize);
  assert.equal(sha256(publicRelease), manifest.signedReleaseSha256);
  assert.equal(publicRelease.byteLength, manifest.signedReleaseSize);
  assert.ok(["APPROVED", "SOURCE_UPDATED_NEEDS_SIGNING"].includes(manifest.appleSigningStatus));
  assert.equal(manifest.distribution, "self_hosted_apple_signed_file");

  if (manifest.appleSigningStatus === "APPROVED") {
    assert.equal(sha256(source), manifest.signedSourceSha256 ?? manifest.sourceSha256);
  }

  const actionIdentifiers = sourceText.match(/<string>is\.workflow\.actions\.[^<]+<\/string>/g) ?? [];
  assert.equal(actionIdentifiers.length, manifest.actionCount);
  assert.match(sourceText, /<key>WFHTTPMethod<\/key>\s*<string>POST<\/string>/);
  assert.match(sourceText, /<string>openUrl<\/string>/);
  assert.match(sourceText, /<string>accountName<\/string>/);
  assert.match(sourceText, /<string>requestId<\/string>/);
  assert.match(sourceText, /<string>clientVersion<\/string>/);
  assert.match(sourceText, /<string>yyyy-MM-dd<\/string>/);
  assert.match(sourceText, /<string>is\.workflow\.actions\.conditional<\/string>/);
  assert.match(sourceText, /<string>error<\/string>/);
  assert.match(
    sourceText,
    /<string>amount<\/string>[\s\S]*?<key>WFItemType<\/key>\s*<integer>0<\/integer>/
  );
  assert.match(
    sourceText,
    /<string>is\.workflow\.actions\.detect\.dictionary<\/string>[\s\S]*?<key>WFInput<\/key>[\s\S]*?<string>ExtensionInput<\/string>/
  );
  assert.match(sourceText, /<key>WFWorkflowImportQuestions<\/key>/);
  assert.match(sourceText, /<key>ActionIndex<\/key>\s*<integer>5<\/integer>/);
  assert.match(sourceText, /<key>ParameterKey<\/key>\s*<string>WFTextActionText<\/string>/);
  assert.match(sourceText, /<key>WFTextActionText<\/key>\s*<string><\/string>/);
  assert.match(sourceText, /Saved /);

  for (const forbidden of [
    /shortcut_token\s*=/i,
    /X-Monies-Shortcut-Token/i,
    /Authorization/i,
    /Bearer\s+/i,
    /monies-map-shortcuts\.[^<\s]+/i
  ]) {
    assert.doesNotMatch(sourceText, forbidden);
    assert.equal(forbidden.test(signedRelease.toString("latin1")), false);
  }
});

test("app install path and committed shortcut release stay aligned", async () => {
  const manifest = JSON.parse(await readFile(path.join(artifactRoot, "manifest.json"), "utf8"));
  const settingsSection = await readFile(path.join(repoRoot, "src/client/settings-sections.jsx"), "utf8");
  const browserTest = await readFile(path.join(repoRoot, "tests/e2e/settings-reference-data.spec.js"), "utf8");

  assert.match(manifest.installPath, /^\/shortcuts\/[a-z0-9-]+\.shortcut$/);
  assert.equal(settingsSection.includes(manifest.installPath), true);
  assert.equal(browserTest.includes(manifest.installPath), true);
});
