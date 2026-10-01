#!/usr/bin/env node
// Link a PR to the issue it closes (#2558) — `npm run pr:link -- --pr <N>
// --issue <M>`. Step 6 of the pr-flow skill, which previously transcribed
// this as a three-call GraphQL block.
//
// Closing keywords only auto-link for PRs targeting the DEFAULT branch, and
// v2 PRs target `v2/main` — so `Closes #N` there is only a cross-reference.
// The `addCloseIssueReferences` mutation adds the manual closing reference
// (the UI's Development sidebar), which is what puts the PR in the card's
// Linked pull requests field. The link is VERIFIED by reading the PR's
// `closingIssuesReferences` back; `linked: …` prints only on a confirmed
// match, so an unconfirmed mutation fails loudly instead of leaving a card
// with no PR.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  OWNER,
  REPO,
  REPO_SLUG,
  ghGraphql,
  ghJson,
  requirePositiveInt,
} from "./lib/gh.mjs";

const ISSUE_ID_QUERY = `query($n:Int!){repository(owner:"${OWNER}",name:"${REPO}"){issue(number:$n){id}}}`;
const LINK_MUTATION = `mutation($i:ID!,$p:[ID!]!){addCloseIssueReferences(input:{issueId:$i, pullRequestIds:$p}){clientMutationId}}`;
// `first:100` is the connection's maximum page — with `first:10` a PR already
// linked to ten issues would verify the wrong page and report a successful
// mutation as a failure.
const VERIFY_QUERY = `query($n:Int!){repository(owner:"${OWNER}",name:"${REPO}"){pullRequest(number:$n){closingIssuesReferences(first:100){nodes{number}}}}}`;

export function parseLinkArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { pr: { type: "string" }, issue: { type: "string" } },
  });
  return {
    pr: requirePositiveInt(values.pr, "--pr"),
    issue: requirePositiveInt(values.issue, "--issue"),
  };
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { pr, issue } = parseLinkArgs(argv);

  const issueId = ghGraphql(spawn, ISSUE_ID_QUERY, { n: issue })?.data
    ?.repository?.issue?.id;
  if (!issueId) {
    throw new Error(`could not resolve issue #${issue}`);
  }
  const prId = ghJson(spawn, [
    "pr",
    "view",
    String(pr),
    "--repo",
    REPO_SLUG,
    "--json",
    "id",
  ]).id;
  if (!prId) {
    throw new Error(`could not resolve PR #${pr}`);
  }

  ghGraphql(spawn, LINK_MUTATION, { i: issueId, p: prId });

  // Verify: the PR must now list the issue — never report an unconfirmed link.
  const linked = (
    ghGraphql(spawn, VERIFY_QUERY, { n: pr })?.data?.repository?.pullRequest
      ?.closingIssuesReferences?.nodes ?? []
  ).map((node) => node.number);
  if (!linked.includes(issue)) {
    throw new Error(
      `PR #${pr} closingIssuesReferences reads [${linked.join(", ")}] — #${issue} is not in it`,
    );
  }
  console.log(`linked: PR #${pr} closes #${issue}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
