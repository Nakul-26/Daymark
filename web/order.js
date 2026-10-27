// Pure helpers for reordering a list of task ids (keyboard shortcuts use these; see tests/order.test.js).
export const moveToEdge = (ids, id, edge) => {
  const rest = ids.filter(x => x !== id);
  return edge === "top" ? [id, ...rest] : [...rest, id];
};

// `id` removed from wherever it was and put right after `anchor` (at the end if anchor isn't in the list).
export const placeAfter = (ids, anchor, id) => {
  const rest = ids.filter(x => x !== id);
  const i = rest.indexOf(anchor);
  rest.splice(i < 0 ? rest.length : i + 1, 0, id);
  return rest;
};
