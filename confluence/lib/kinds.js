import { pageAdapter } from "./pages/adapter.js";

/**
 * Per-kind operations, keyed by manifest `kind`. Every kind runs through
 * the shared action engine (shared/actions.js) and the shared CLI runner
 * (shared/cli.js): `flag` is its CLI kind flag, and its adapter's `actions`
 * lists what it supports.
 */
export const KINDS = {
  page: {
    flag: "pages",
    adapter: pageAdapter,
  },
};
