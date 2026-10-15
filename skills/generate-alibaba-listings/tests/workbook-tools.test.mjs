import assert from "node:assert/strict";
import test from "node:test";

import { buildUpdatePlan } from "../scripts/workbook-tools.mjs";

function record(overrides = {}) {
  return {
    workbookPath: "C:/tmp/keywords.xlsx",
    sheetName: "全部词",
    rowNumber: 2,
    status: "否",
    keyword: "reflective jacket women",
    ...overrides,
  };
}

test("本次选用且由标题词根间接覆盖的关键词进入回写计划", () => {
  const selected = record();
  const plan = buildUpdatePlan(["Women Reflective Bomber Jacket"], [selected], [selected]);

  assert.equal(plan.workbooks[0]?.updates.length, 1);
  assert.equal(plan.workbooks[0].updates[0].coverageType, "selected-root-coverage");
});

test("本次选用但标题未覆盖全部词根的关键词不进入回写计划", () => {
  const selected = record({ keyword: "reflective waterproof jacket women" });
  const plan = buildUpdatePlan(["Women Reflective Bomber Jacket"], [selected], [selected]);

  assert.equal(plan.workbooks.length, 0);
});

test("同一来源工作簿内相同关键词的复制行同步更新", () => {
  const selected = record();
  const copied = record({ sheetName: "筛选词", rowNumber: 8 });
  const plan = buildUpdatePlan(["Women Reflective Bomber Jacket"], [selected], [selected, copied]);

  assert.equal(plan.workbooks[0]?.updates.length, 2);
});
