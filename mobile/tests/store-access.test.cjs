const assert = require("node:assert/strict");
const test = require("node:test");
const { canAccessStore } = require("../src/auth/store-access.ts");

const manager = { permissions: ["manage_inventory"], store_ids: [1] };
const appAdmin = { permissions: ["manage_all_stores"], store_ids: [] };

test("store-specific screens check the current assignment", () => {
  assert.equal(canAccessStore(manager, 1), true);
  assert.equal(canAccessStore(manager, 2), false);
  assert.equal(canAccessStore({ ...manager, store_ids: [] }, 1), false);
  assert.equal(canAccessStore(null, 1), false);
});

test("app admins can open any valid store, but still need a store ID", () => {
  assert.equal(canAccessStore(appAdmin, 2), true);
  for (const id of [NaN, 0, -1, 1.5, Infinity]) {
    assert.equal(canAccessStore(appAdmin, id), false);
  }
});
