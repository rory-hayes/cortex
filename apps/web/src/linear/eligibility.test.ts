import { describe, expect, test } from "vitest";

import {
  DEFAULT_LINEAR_ISSUE_ELIGIBILITY,
  filterReadyLinearIssueCandidates,
  isLinearIssueReadyForAi,
  type LinearIssueEligibilityConfig,
} from "./eligibility";

type Candidate = {
  id: string;
  labels: string[];
  status: string;
  title?: string;
};

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "candidate_1",
  labels: [],
  status: "Todo",
  title: "Safe metadata title",
  ...overrides,
});

describe("Linear issue Ready-for-AI eligibility", () => {
  test("default config matches status Ready for AI", () => {
    expect(isLinearIssueReadyForAi(candidate({ status: "Ready for AI" }))).toBe(true);
  });

  test("default config matches label Ready for AI", () => {
    expect(isLinearIssueReadyForAi(candidate({ labels: ["Ready for AI"] }))).toBe(true);
  });

  test("matching is trimmed and case-insensitive", () => {
    expect(
      isLinearIssueReadyForAi(
        candidate({
          labels: ["  READY FOR AI  "],
          status: " todo ",
        }),
      ),
    ).toBe(true);
  });

  test("status OR label qualifies an issue", () => {
    expect(
      filterReadyLinearIssueCandidates([
        candidate({ id: "ready_by_status", labels: [], status: "Ready for AI" }),
        candidate({ id: "ready_by_label", labels: ["Ready for AI"], status: "Backlog" }),
      ]).map((readyCandidate) => readyCandidate.id),
    ).toEqual(["ready_by_status", "ready_by_label"]);
  });

  test("unrelated status and labels are excluded", () => {
    expect(
      filterReadyLinearIssueCandidates([
        candidate({ id: "todo", labels: ["bug"], status: "Todo" }),
        candidate({ id: "review", labels: ["needs human"], status: "Review" }),
      ]),
    ).toEqual([]);
  });

  test("custom configured statuses and labels work", () => {
    const config: LinearIssueEligibilityConfig = {
      labels: ["AI Candidate"],
      statuses: ["Selected for Agent"],
    };

    expect(
      filterReadyLinearIssueCandidates(
        [
          candidate({ id: "custom_status", labels: [], status: "selected for agent" }),
          candidate({ id: "custom_label", labels: [" ai candidate "], status: "Todo" }),
          candidate({ id: "default_status", labels: [], status: "Ready for AI" }),
        ],
        config,
      ).map((readyCandidate) => readyCandidate.id),
    ).toEqual(["custom_status", "custom_label"]);
  });

  test("empty configured statuses and labels return no candidates", () => {
    expect(
      filterReadyLinearIssueCandidates(
        [
          candidate({ id: "ready_by_status", status: "Ready for AI" }),
          candidate({ id: "ready_by_label", labels: ["Ready for AI"] }),
        ],
        {
          labels: [],
          statuses: [],
        },
      ),
    ).toEqual([]);
  });

  test("candidate order is preserved", () => {
    expect(
      filterReadyLinearIssueCandidates([
        candidate({ id: "first", labels: ["Ready for AI"], status: "Todo" }),
        candidate({ id: "second", labels: [], status: "Ready for AI" }),
        candidate({ id: "third", labels: ["Ready for AI"], status: "Review" }),
      ]).map((readyCandidate) => readyCandidate.id),
    ).toEqual(["first", "second", "third"]);
  });

  test("eligibility output stays candidate metadata only and does not add queue or run fields", () => {
    const candidates = [
      candidate({
        id: "ready_candidate",
        labels: [...DEFAULT_LINEAR_ISSUE_ELIGIBILITY.labels],
        status: "Todo",
      }),
    ];

    const result = filterReadyLinearIssueCandidates(candidates);

    expect(result).toEqual(candidates);
    expect(JSON.stringify(result)).not.toMatch(
      /\b(?:approval|approvedAt|jobId|queue|runId|taskPacket)\b/u,
    );
  });
});
