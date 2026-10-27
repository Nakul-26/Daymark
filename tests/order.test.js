import test from "node:test";
import assert from "node:assert/strict";
import { moveToEdge, placeAfter } from "../web/order.js";

test("moveToEdge puts the id first or last, keeping the rest in order", () => {
  assert.deepEqual(moveToEdge([1, 2, 3, 4], 3, "top"), [3, 1, 2, 4]);
  assert.deepEqual(moveToEdge([1, 2, 3, 4], 2, "bottom"), [1, 3, 4, 2]);
  assert.deepEqual(moveToEdge([1, 2, 3], 1, "top"), [1, 2, 3]);
});

test("placeAfter puts the id right after the anchor", () => {
  assert.deepEqual(placeAfter([1, 2, 3, 4], 1, 4), [1, 4, 2, 3]);
  assert.deepEqual(placeAfter([1, 2, 3], 3, 1), [2, 3, 1]);
  assert.deepEqual(placeAfter([1, 2, 3], 9, 1), [2, 3, 1]); // unknown anchor: goes last
  assert.deepEqual(placeAfter([1, 2, 3], 2, 2), [1, 3, 2]);  // anchor is the id itself: harmless
});
