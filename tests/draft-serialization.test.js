import { test } from "node:test";
import assert from "node:assert/strict";
import { CatalogDrafts } from "../admin/catalog-drafts.js";

function fixture() {
  return {
    categories: [
      { id: "cat-b", slug: "b", sort_order: 1, status: "published" },
      { id: "cat-a", slug: "a", sort_order: 0, status: "published" }
    ],
    products: [
      { id: "prod-b", legacy_key: "b", category_id: "cat-b", sort_order: 1, status: "published", price_cents: 2150, variants: [], image_url: "b", image_path: null },
      { id: "prod-a", legacy_key: "a", category_id: "cat-a", sort_order: 0, status: "published", price_cents: 2200, variants: [], image_url: "a", image_path: null }
    ]
  };
}

test("draft reads sort only the UI view and preserve raw array order for saves", async () => {
  const calls = [];
  let catalog = fixture();
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'chefduo_catalog_capabilities') return { data: { product_editing: true, image_editing: false, new_items: false } };
      if (args.p_action === "read") return { data: { version: 1, sequence: 1, catalog } };
      if (args.p_action === "save") {
        catalog = args.p_payload;
        return { data: { version: 2 } };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }
  };
  const drafts = new CatalogDrafts(client, { capabilityRead: true });
  const view = await drafts.read();
  assert.deepEqual(view.products.map(row => row.id), ["prod-a", "prod-b"]);
  assert.deepEqual(drafts.catalog.products.map(row => row.id), ["prod-b", "prod-a"]);

  await drafts.save("menu_products", { price_cents: 2100 }, "prod-a");
  const saved = calls.find(call => call.args?.p_action === "save").args.p_payload;
  assert.deepEqual(saved.products.map(row => row.id), ["prod-b", "prod-a"]);
  assert.equal(saved.products.find(row => row.id === "prod-a").price_cents, 2100);
  assert.equal(Object.hasOwn(saved.products.find(row => row.id === "prod-a"), "available"), false);
  assert.deepEqual(drafts.view().products.map(row => row.id), ["prod-a", "prod-b"]);
});
