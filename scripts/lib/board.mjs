// Shared project-board plumbing for the maintainer-workflow scripts (#2558):
// `board-card-status.mjs`, `board-card-add.mjs`, `board-card-delete.mjs`,
// `board-draft-find.mjs`, `board-snapshot.mjs`, `board-sweep.mjs`,
// `board-audit.mjs` and `board-recover.mjs`. The invariants the board-ops and
// issue-triage skills could previously only state in prose next to their
// inline blocks are enforced here once, under test:
//
//  - Every id is resolved BY NAME at run time. Single-select option ids are
//    regenerated whenever a field's option list is edited (board-ops' hazard),
//    so nothing here hardcodes one.
//  - An issue's card is found FROM THE ISSUE (`projectItems`), selected by the
//    board's node id — project numbers are per-owner, and the issue-side
//    lookup has no exposure to board size.
//  - A whole-board listing is trusted only when COMPLETE: `gh project
//    item-list --limit N` truncates silently past N, so `itemListComplete`
//    compares `.items | length` against `.totalCount` and throws rather than
//    letting a truncated dump read as a smaller board (#2451's defect class).

import { OWNER, REPO, gh, ghGraphql, ghJson } from "./gh.mjs";

export const DEFAULT_BOARD = 28;

/** Default `--limit` for whole-board dumps — headroom over the board's size. */
export const ITEM_LIST_LIMIT = 2000;

/** Resolve a board's project node id by number. */
export function projectId(spawn, board) {
  const id = ghJson(spawn, [
    "project",
    "view",
    String(board),
    "--owner",
    OWNER,
    "--format",
    "json",
  ]).id;
  if (!id) {
    throw new Error(`could not resolve project id for board #${board}`);
  }
  return id;
}

/** A board's fields (names, ids, options), for name-based resolution. */
export function boardFields(spawn, board) {
  return (
    ghJson(spawn, [
      "project",
      "field-list",
      String(board),
      "--owner",
      OWNER,
      "--format",
      "json",
    ]).fields ?? []
  );
}

/** Resolve a single-select field's id and one option's id, both by name. */
export function fieldOption(fields, fieldName, optionName) {
  const field = fields.find((candidate) => candidate.name === fieldName);
  if (!field) {
    throw new Error(`board has no "${fieldName}" field`);
  }
  const option = (field.options ?? []).find(
    (candidate) => candidate.name === optionName,
  );
  if (!option) {
    const known = (field.options ?? []).map((o) => o.name).join(", ");
    throw new Error(
      `"${fieldName}" has no option "${optionName}" (has: ${known})`,
    );
  }
  return { fieldId: field.id, optionId: option.id };
}

/** The issue-side card query, parameterized by the field to read back. */
export function cardQuery(fieldName) {
  return `query($n:Int!){repository(owner:"${OWNER}",name:"${REPO}"){issue(number:$n){projectItems(first:100){nodes{id project{id} fieldValueByName(name:"${fieldName}"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}`;
}

/** The issue's card on the given project, from a `projectItems` response. */
export function cardOnProject(response, project) {
  const nodes = response?.data?.repository?.issue?.projectItems?.nodes;
  if (!Array.isArray(nodes)) {
    throw new Error(
      `unexpected projectItems response shape: ${JSON.stringify(response)}`,
    );
  }
  return nodes.find((node) => node?.project?.id === project);
}

/** Find an issue's card on a project, reading back one field's value. */
export function findCard(spawn, issue, project, fieldName = "Status") {
  return cardOnProject(
    ghGraphql(spawn, cardQuery(fieldName), { n: issue }),
    project,
  );
}

/**
 * A whole-board dump, trusted only when complete. Returns the parsed
 * `{ items, totalCount }` object so callers that persist it (the snapshot)
 * write exactly what was verified.
 */
export function itemListComplete(spawn, board, limit = ITEM_LIST_LIMIT) {
  const dump = ghJson(spawn, [
    "project",
    "item-list",
    String(board),
    "--owner",
    OWNER,
    "--format",
    "json",
    "--limit",
    String(limit),
  ]);
  if (
    !Array.isArray(dump.items) ||
    typeof dump.totalCount !== "number" ||
    dump.items.length !== dump.totalCount
  ) {
    throw new Error(
      `board #${board} listing INCOMPLETE or malformed ` +
        `(${dump.items?.length ?? "?"} of ${dump.totalCount ?? "?"}) — raise --limit`,
    );
  }
  return dump;
}

/** Edit one single-select field on a card, throwing on a non-zero exit. */
export function editItemField(spawn, project, itemId, fieldId, optionId) {
  const edit = gh(spawn, [
    "project",
    "item-edit",
    "--project-id",
    project,
    "--id",
    itemId,
    "--field-id",
    fieldId,
    "--single-select-option-id",
    optionId,
    "--format",
    "json",
  ]);
  if (edit.status !== 0) {
    throw new Error(`item-edit failed: ${(edit.stderr ?? "").trim()}`);
  }
}
