import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";
import { pageAdapter } from "../adapter.js";
import { adfToMarkdown } from "../../markdown.js";
import { createOne, fetchOne, pushOne } from "../../../../shared/actions.js";
import {
  listManifestEntries,
  updateManifestEntry,
} from "../../../../shared/manifest.js";

const PAGE_ID = "123";

// A fenced code block followed on the same line by its "wrap" metadata
// comment: the parser can't reconstruct this from markdown, so converting it
// to ADF and back produces different text.
const NON_ROUND_TRIPPING_MARKDOWN =
  "```\ngit clone https://example.com/repo\n```<!-- adf:codeblock attrs='{\"wrap\":true}' -->\n";

// Each test gets its own folder here, so tests never write to the real
// confluence/ folder.
const TEMP_BASE_DIR = path.join(os.tmpdir(), "page-adapter-test");

after(() => rm(TEMP_BASE_DIR, { recursive: true, force: true }));

let adapter;
let document;

beforeEach(async () => {
  await mkdir(TEMP_BASE_DIR, { recursive: true });
  const rootDir = await mkdtemp(path.join(TEMP_BASE_DIR, "page-"));

  adapter = { ...pageAdapter, rootDir };
  document = parseDocument("{}");
});

afterEach(() => rm(adapter.rootDir, { recursive: true, force: true }));

function resolve(artifactPath) {
  return path.join(adapter.rootDir, artifactPath);
}

/** A fake Confluence holding one page at version 4. */
function createFakeConfluence() {
  const fake = {
    page: {
      id: PAGE_ID,
      title: "Live Title",
      version: { number: 4 },
      body: {
        atlas_doc_format: {
          value: JSON.stringify({
            type: "doc",
            version: 1,
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Body" }] },
            ],
          }),
        },
      },
    },
    updateCalls: [],
    createCalls: [],
    client: {
      async findPageIdByTitle() {
        return null;
      },
      // Replaces the one page, like a create would add one.
      async createPage(options) {
        fake.createCalls.push(options);
        fake.page = {
          id: PAGE_ID,
          title: options.title,
          version: { number: 1 },
          body: {
            atlas_doc_format: { value: JSON.stringify(options.adf) },
          },
        };
        return { id: PAGE_ID };
      },
      async getPage() {
        return structuredClone(fake.page);
      },
      async updatePage(pageId, options) {
        fake.updateCalls.push({ pageId, ...options });
        fake.page.version = { number: options.currentVersionNumber + 1 };
        return { id: pageId, version: fake.page.version };
      },
    },
  };

  return fake;
}

/** Writes a new page's file at synced/new-page.md, then creates it. */
async function writeAndCreate(fake, content) {
  await mkdir(resolve("synced"), { recursive: true });
  await writeFile(resolve("synced/new-page.md"), content, "utf8");

  const [result] = await createOne(adapter, fake.client, document, {
    fileName: "new-page",
  });

  return result;
}

/** Fetches the page, then writes `content` over its local file. */
async function trackAndEditLocally(fake, content) {
  const [fetched] = await fetchOne(adapter, fake.client, document, PAGE_ID);
  assert.equal(fetched.status, "success", fetched.message);
  await writeFile(resolve(fetched.path), content, "utf8");

  return listManifestEntries(document)[0];
}

test("pageAdapter names a fetched file from the page title", () => {
  const artifactPath = pageAdapter.buildFetchPath({
    client: null,
    document: parseDocument("{}"),
    id: PAGE_ID,
    remote: { title: "Dynamic Rendering: Overview" },
  });

  assert.equal(artifactPath, "synced/dynamic-rendering-overview.md");
});

test("push sends the live title, not the manifest title, at the live version plus one", async () => {
  const fake = createFakeConfluence();
  const entry = await trackAndEditLocally(fake, "Edited body");
  updateManifestEntry(document, entry.path, { title: "Stale Manifest Title" });

  const [result] = await pushOne(adapter, fake.client, document, {
    ...entry,
    title: "Stale Manifest Title",
  });

  assert.equal(result.status, "success", result.message);
  assert.equal(fake.updateCalls.length, 1);
  assert.equal(fake.updateCalls[0].title, "Live Title");
  assert.equal(fake.updateCalls[0].currentVersionNumber, 4);
  assert.equal(result.remoteVersion, 5);

  const updated = listManifestEntries(document)[0];
  assert.equal(updated.remoteVersion, 5);
  assert.equal(updated.title, "Live Title");
});

test("push fails when the markdown doesn't round-trip; --force pushes anyway", async () => {
  const fake = createFakeConfluence();
  const entry = await trackAndEditLocally(fake, NON_ROUND_TRIPPING_MARKDOWN);

  const [failed] = await pushOne(adapter, fake.client, document, entry);

  assert.equal(failed.status, "failed");
  assert.match(failed.message, /doesn't round-trip/);
  assert.equal(fake.updateCalls.length, 0);
  assert.deepEqual(listManifestEntries(document)[0], entry);

  const [forced] = await pushOne(adapter, fake.client, document, entry, {
    force: true,
  });

  assert.equal(forced.status, "success", forced.message);
  assert.equal(fake.updateCalls.length, 1);
});

test("push normalizes a bare URL before the round-trip check, sends the normalized form, and rewrites the local file to match", async () => {
  const fake = createFakeConfluence();
  const entry = await trackAndEditLocally(
    fake,
    "See https://example.com for details."
  );

  const [result] = await pushOne(adapter, fake.client, document, entry);

  assert.equal(result.status, "success", result.message);
  assert.equal(fake.updateCalls.length, 1);

  const normalizedBody = adfToMarkdown(fake.updateCalls[0].adf);
  assert.equal(
    normalizedBody,
    "See [https://example.com](https://example.com) for details."
  );
  assert.equal(
    await readFile(resolve(entry.path), "utf8"),
    "See [https://example.com](https://example.com) for details."
  );
});

test("create titles the page from the leading # heading and leaves it out of the body", async () => {
  const fake = createFakeConfluence();

  const result = await writeAndCreate(fake, "# New Page Title\n\nNew body\n");

  assert.equal(result.status, "success", result.message);
  assert.equal(fake.createCalls.length, 1);
  assert.equal(fake.createCalls[0].title, "New Page Title");
  assert.equal(
    await readFile(resolve("synced/new-page.md"), "utf8"),
    "New body"
  );
  assert.equal(listManifestEntries(document)[0].title, "New Page Title");
});

test("create normalizes a bare URL in the body before the round-trip check and before creating", async () => {
  const fake = createFakeConfluence();

  const result = await writeAndCreate(
    fake,
    "# New Page Title\n\nSee https://example.com for details.\n"
  );

  assert.equal(result.status, "success", result.message);
  assert.equal(
    adfToMarkdown(fake.createCalls[0].adf),
    "See [https://example.com](https://example.com) for details."
  );
  assert.equal(
    await readFile(resolve("synced/new-page.md"), "utf8"),
    "See [https://example.com](https://example.com) for details."
  );
});

test("create fails when the file doesn't start with a # heading", async () => {
  const fake = createFakeConfluence();

  const result = await writeAndCreate(fake, "## Not a title\n\nNew body");

  assert.equal(result.status, "failed");
  assert.match(result.message, /"# " heading/);
  assert.equal(fake.createCalls.length, 0);
  assert.equal(listManifestEntries(document).length, 0);
});

test("create fails when the body doesn't round-trip", async () => {
  const fake = createFakeConfluence();

  const result = await writeAndCreate(
    fake,
    `# New Page Title\n\n${NON_ROUND_TRIPPING_MARKDOWN}`
  );

  assert.equal(result.status, "failed");
  assert.match(result.message, /doesn't round-trip/);
  assert.doesNotMatch(result.message, /--force/);
  assert.equal(fake.createCalls.length, 0);
  assert.equal(listManifestEntries(document).length, 0);
});
