import { createHash } from "node:crypto";

/** Computes a "sha256:<hex>" digest of the given string content, matching the
 * format stored in sync-manifest.yaml's content-hash fields. */
export function hashContent(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
