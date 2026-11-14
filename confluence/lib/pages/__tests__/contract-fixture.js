import { pageAdapter } from "../adapter.js";

/**
 * Runs Confluence pages through the action contract tests
 * (shared/__tests__/action-contract.test.js) against an in-memory
 * Confluence. Like Confluence, a page's title is unique, so --create finds
 * a duplicate by title.
 *
 * @type {import("../../../../shared/__tests__/action-contract.test.js").ContractFixture}
 */
export const pageContractFixture = {
  adapter: pageAdapter,
  sampleIds: ["100001", "100002"],

  createFakeRemote() {
    const pages = new Map();
    let editCount = 0;
    let createdCount = 0;

    function buildAdf(heading, body) {
      return {
        type: "doc",
        version: 1,
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: heading }],
          },
          { type: "paragraph", content: [{ type: "text", text: body }] },
        ],
      };
    }

    function getExisting(id) {
      if (!pages.has(id)) {
        throw Object.assign(
          new Error(`Confluence API GET /pages/${id} failed with 404`),
          { status: 404 }
        );
      }

      return pages.get(id);
    }

    function storePage(id, { title, adf, versionNumber }) {
      pages.set(id, {
        id,
        title,
        version: { number: versionNumber },
        body: { atlas_doc_format: { value: JSON.stringify(adf) } },
      });
    }

    return {
      client: {
        async getPage(id) {
          return structuredClone(getExisting(id));
        },
        async updatePage(id, { title, adf, currentVersionNumber }) {
          const existing = getExisting(id);

          // Like Confluence, reject an update that isn't exactly one
          // version ahead of the live page.
          if (currentVersionNumber !== existing.version.number) {
            throw Object.assign(
              new Error(`Confluence API PUT /pages/${id} failed with 409`),
              { status: 409 }
            );
          }

          storePage(id, {
            title,
            adf,
            versionNumber: currentVersionNumber + 1,
          });

          // Left out, as Confluence may, so the adapter must read it back.
          const updated = structuredClone(getExisting(id));
          delete updated.body;
          return updated;
        },
        async findPageIdByTitle(title) {
          const sameTitledPage = [...pages.values()].find(
            (page) => page.title === title
          );

          return sameTitledPage?.id ?? null;
        },
        // Like Confluence, the create response may leave out the body, so
        // the adapter must read it back.
        async createPage({ title, adf }) {
          createdCount += 1;
          const id = String(200000 + createdCount);
          storePage(id, { title, adf, versionNumber: 1 });

          const created = structuredClone(getExisting(id));
          delete created.body;
          return created;
        },
        async deletePage(id) {
          getExisting(id);
          pages.delete(id);
        },
      },
      addRemote(id) {
        storePage(id, {
          title: `Contract Page ${id}`,
          adf: buildAdf(`Contract page ${id}`, "Original body"),
          versionNumber: 1,
        });
      },
      changeRemote(id) {
        const existing = getExisting(id);
        editCount += 1;

        storePage(id, {
          title: existing.title,
          adf: buildAdf(
            `Contract page ${id}`,
            `Changed in Confluence ${editCount}`
          ),
          versionNumber: existing.version.number + 1,
        });
      },
      touchRemote(id) {
        const existing = getExisting(id);

        pages.set(id, {
          ...existing,
          version: { number: existing.version.number + 1 },
        });
      },
      renameRemote(id, title) {
        pages.set(id, { ...getExisting(id), title });
      },
      removeRemote(id) {
        pages.delete(id);
      },
    };
  },

  editLocalContent(content) {
    return `${content.trimEnd()}\n\nEdited locally.`;
  },

  // Titled like addRemote titles the remote with the same key.
  buildNewLocalContent(key) {
    return `# Contract Page ${key}\n\nNew body\n`;
  },
};
