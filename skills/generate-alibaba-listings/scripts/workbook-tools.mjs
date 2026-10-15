import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findIndirectCoverage, findStrictCoverage, normalizePhrase } from "./listing-tools.mjs";

const REQUIRED_FIELDS = ["status", "keyword", "searchIndex", "clickThroughRate", "sellerScaleIndex"];
const HEADER_ALIASES = new Map([
  ["标题", "status"],
  ["关键词", "keyword"],
  ["搜索指数", "searchIndex"],
  ["点击率", "clickThroughRate"],
  ["卖家规模指数", "sellerScaleIndex"],
  ["关键词排名难度", "rankingDifficulty"],
  ["关键词难度", "rankingDifficulty"],
  ["关键词注释", "annotation"],
  ["行动方案", "actionPlan"],
]);

let artifactToolOverride = null;

export function configureArtifactTool(api) {
  artifactToolOverride = api;
}

async function getArtifactTool() {
  if (artifactToolOverride) return artifactToolOverride;
  return import("@oai/artifact-tool");
}

export async function discoverWorkbooks(inputDir) {
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".xlsx") && !entry.name.startsWith("~$"))
    .map((entry) => path.join(inputDir, entry.name))
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function mapHeaders(values) {
  if (!Array.isArray(values)) return null;
  const indexes = {};
  values.forEach((value, index) => {
    const field = HEADER_ALIASES.get(String(value ?? "").trim());
    if (field && indexes[field] === undefined) indexes[field] = index;
  });
  return REQUIRED_FIELDS.every((field) => indexes[field] !== undefined) ? indexes : null;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function scanWorkbook(workbookPath) {
  const { FileBlob, SpreadsheetFile } = await getArtifactTool();
  const absolutePath = path.resolve(workbookPath);
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(absolutePath));
  const records = [];
  const compatibleSheets = [];

  for (const sheet of workbook.worksheets) {
    const used = sheet.getUsedRange(true);
    const values = used?.values ?? [];
    const indexes = values.length ? mapHeaders(values[0]) : null;
    if (!indexes) continue;
    compatibleSheets.push(sheet.name);
    for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex] ?? [];
      const keyword = String(row[indexes.keyword] ?? "").trim();
      if (!keyword) continue;
      records.push({
        workbookPath: absolutePath,
        sheetName: sheet.name,
        rowNumber: rowIndex + 1,
        status: String(row[indexes.status] ?? "").trim(),
        keyword,
        searchIndex: numberOrZero(row[indexes.searchIndex]),
        clickThroughRate: numberOrZero(row[indexes.clickThroughRate]),
        sellerScaleIndex: numberOrZero(row[indexes.sellerScaleIndex]),
        rankingDifficulty: numberOrZero(indexes.rankingDifficulty === undefined ? 0 : row[indexes.rankingDifficulty]),
        annotation: String(indexes.annotation === undefined ? "" : row[indexes.annotation] ?? "").trim(),
        actionPlan: String(indexes.actionPlan === undefined ? "" : row[indexes.actionPlan] ?? "").trim(),
      });
    }
  }

  return { workbookPath: absolutePath, compatibleSheets, records };
}

export async function scanDirectory(inputDir) {
  const scans = [];
  for (const workbookPath of await discoverWorkbooks(inputDir)) {
    const scan = await scanWorkbook(workbookPath);
    if (scan.compatibleSheets.length > 0) scans.push(scan);
  }
  return scans;
}

export function buildUpdatePlan(titles, selectedRecords, allRecordsFromSelectedWorkbooks) {
  const selectedPaths = new Set(selectedRecords.map((record) => path.resolve(record.workbookPath)));
  const normalizedRecords = allRecordsFromSelectedWorkbooks.flatMap((item) =>
    Array.isArray(item?.records) ? item.records : [item],
  );
  const eligible = normalizedRecords.filter(
    (record) => selectedPaths.has(path.resolve(record.workbookPath)) && record.status === "否",
  );
  const selectedEligible = selectedRecords.filter((record) => record.status === "否");
  const strictCoveredKeys = new Set();
  const selectedRootCoveredKeywords = new Set();
  for (const title of titles) {
    for (const record of findStrictCoverage(title, eligible)) {
      strictCoveredKeys.add(`${path.resolve(record.workbookPath)}\u0000${record.sheetName}\u0000${record.rowNumber}`);
    }
    const selectedCovered = [
      ...findStrictCoverage(title, selectedEligible),
      ...findIndirectCoverage(title, selectedEligible),
    ];
    for (const record of selectedCovered) {
      selectedRootCoveredKeywords.add(`${path.resolve(record.workbookPath)}\u0000${normalizePhrase(record.keyword)}`);
    }
  }

  const grouped = new Map();
  for (const record of eligible) {
    const workbookPath = path.resolve(record.workbookPath);
    const key = `${workbookPath}\u0000${record.sheetName}\u0000${record.rowNumber}`;
    const selectedKeywordKey = `${workbookPath}\u0000${normalizePhrase(record.keyword)}`;
    const coverageType = strictCoveredKeys.has(key)
      ? "strict-coverage"
      : selectedRootCoveredKeywords.has(selectedKeywordKey)
        ? "selected-root-coverage"
        : null;
    if (!coverageType) continue;
    if (!grouped.has(workbookPath)) grouped.set(workbookPath, []);
    grouped.get(workbookPath).push({
      sheetName: record.sheetName,
      rowNumber: record.rowNumber,
      keyword: record.keyword,
      from: "否",
      to: "是",
      coverageType,
    });
  }

  return {
    approvedForWrite: false,
    titles: [...titles],
    workbooks: [...grouped.entries()].map(([workbookPath, updates]) => ({ workbookPath, updates })),
  };
}

function targetKey(sheetName, rowNumber) {
  return `${sheetName}\u0000${rowNumber}`;
}

function snapshotWorkbook(workbook) {
  const sheets = {};
  for (const sheet of workbook.worksheets) {
    const used = sheet.getUsedRange(false);
    sheets[sheet.name] = {
      address: used?.address ?? null,
      values: used?.values ?? [],
      formulas: used?.formulas ?? [],
    };
  }
  return sheets;
}

export function numericValuesEqual(actual, expected) {
  if (typeof actual === "number" && typeof expected === "number") {
    const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
    return Math.abs(actual - expected) <= Number.EPSILON * scale * 64;
  }
  return Object.is(actual, expected);
}

function assertWorkbookValuesPreserved(before, after, updates) {
  const targets = new Set(updates.map((update) => targetKey(update.sheetName, update.rowNumber)));
  assertSameKeys(before, after, "工作表集合发生变化");
  for (const [sheetName, beforeSheet] of Object.entries(before)) {
    const afterSheet = after[sheetName];
    if (beforeSheet.address !== afterSheet.address) throw new Error(`工作表使用范围发生变化: ${sheetName}`);
    if (JSON.stringify(beforeSheet.formulas) !== JSON.stringify(afterSheet.formulas)) {
      throw new Error(`公式发生变化: ${sheetName}`);
    }
    for (let rowIndex = 0; rowIndex < beforeSheet.values.length; rowIndex += 1) {
      for (let colIndex = 0; colIndex < (beforeSheet.values[rowIndex] ?? []).length; colIndex += 1) {
        const rowNumber = rowIndex + 1;
        const isTarget = colIndex === 0 && targets.has(targetKey(sheetName, rowNumber));
        const expected = isTarget ? "是" : beforeSheet.values[rowIndex][colIndex];
        const actual = afterSheet.values[rowIndex]?.[colIndex];
        const equal = numericValuesEqual(actual, expected);
        if (!equal) {
          throw new Error(`非目标值或目标状态验证失败: ${sheetName}!${rowNumber}:${colIndex + 1}`);
        }
      }
    }
  }
}

function assertSameKeys(left, right, message) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) throw new Error(message);
}

async function styleSnapshot(workbook, updates) {
  const styles = {};
  for (const update of updates) {
    const address = `A${update.rowNumber}`;
    const result = await workbook.inspect({
      kind: "computedStyle",
      sheetId: update.sheetName,
      range: address,
      maxChars: 5000,
    });
    const firstLine = result.ndjson.trim().split(/\r?\n/)[0];
    styles[targetKey(update.sheetName, update.rowNumber)] = firstLine ? JSON.parse(firstLine).style : null;
  }
  return styles;
}

async function verifyPreparedWorkbook(filePath, beforeSnapshot, beforeStyles, updates) {
  const { FileBlob, SpreadsheetFile } = await getArtifactTool();
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
  assertWorkbookValuesPreserved(beforeSnapshot, snapshotWorkbook(workbook), updates);
  const afterStyles = await styleSnapshot(workbook, updates);
  if (JSON.stringify(beforeStyles) !== JSON.stringify(afterStyles)) {
    throw new Error(`目标单元格格式发生变化: ${filePath}`);
  }
}

async function prepareWorkbook(item, tempDir) {
  const { FileBlob, SpreadsheetFile } = await getArtifactTool();
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(item.workbookPath));
  const beforeSnapshot = snapshotWorkbook(workbook);
  const beforeStyles = await styleSnapshot(workbook, item.updates);

  for (const update of item.updates) {
    const sheet = workbook.worksheets.getItem(update.sheetName);
    const cell = sheet.getRange(`A${update.rowNumber}`);
    const current = String(cell.values?.[0]?.[0] ?? "").trim();
    if (current !== update.from) {
      throw new Error(`源状态不匹配: ${update.sheetName}!A${update.rowNumber} 预期 ${update.from} 实际 ${current}`);
    }
    cell.values = [[update.to]];
  }

  const id = crypto.randomUUID();
  const candidatePath = path.join(tempDir, `${id}.candidate.xlsx`);
  const backupPath = path.join(tempDir, `${id}.backup.xlsx`);
  const displacedPath = path.join(tempDir, `${id}.displaced.xlsx`);
  const exported = await SpreadsheetFile.exportXlsx(workbook);
  await exported.save(candidatePath);
  await verifyPreparedWorkbook(candidatePath, beforeSnapshot, beforeStyles, item.updates);
  await fs.copyFile(item.workbookPath, backupPath);
  return { ...item, candidatePath, backupPath, displacedPath };
}

async function restorePrepared(prepared) {
  try {
    await fs.rm(prepared.workbookPath, { force: true });
    await fs.copyFile(prepared.backupPath, prepared.workbookPath);
    return { workbookPath: prepared.workbookPath, restored: true };
  } catch (error) {
    return { workbookPath: prepared.workbookPath, restored: false, error: error.message };
  }
}

export async function applyUpdatePlan(plan, options) {
  const dryRun = options?.dryRun !== false;
  const tempDir = path.resolve(options?.tempDir ?? "");
  if (!tempDir) throw new Error("tempDir 不能为空");
  if (!dryRun && plan.approvedForWrite !== true) {
    throw new Error("写入模式要求更新计划包含 approvedForWrite: true");
  }
  if (dryRun) {
    return {
      dryRun: true,
      success: true,
      workbookCount: plan.workbooks?.length ?? 0,
      updateCount: (plan.workbooks ?? []).reduce((sum, item) => sum + item.updates.length, 0),
    };
  }

  await fs.mkdir(tempDir, { recursive: true });
  const prepared = [];
  for (const item of plan.workbooks ?? []) prepared.push(await prepareWorkbook(item, tempDir));

  const committed = [];
  try {
    for (const item of prepared) {
      await fs.rename(item.workbookPath, item.displacedPath);
      try {
        await fs.rename(item.candidatePath, item.workbookPath);
      } catch (error) {
        await fs.rename(item.displacedPath, item.workbookPath);
        throw error;
      }
      committed.push(item);
    }
    for (const item of prepared) {
      await verifyPreparedWorkbook(
        item.workbookPath,
        snapshotWorkbook(await (await getArtifactTool()).SpreadsheetFile.importXlsx(await (await getArtifactTool()).FileBlob.load(item.backupPath))),
        await styleSnapshot(await (await getArtifactTool()).SpreadsheetFile.importXlsx(await (await getArtifactTool()).FileBlob.load(item.backupPath)), item.updates),
        item.updates,
      );
    }
  } catch (error) {
    const rollbacks = [];
    for (const item of committed.reverse()) rollbacks.push(await restorePrepared(item));
    throw new Error(`${error.message}; 回滚结果: ${JSON.stringify(rollbacks)}`);
  } finally {
    for (const item of prepared) {
      await fs.rm(item.candidatePath, { force: true });
      await fs.rm(item.displacedPath, { force: true });
      await fs.rm(item.backupPath, { force: true });
    }
  }

  return {
    dryRun: false,
    success: true,
    workbookCount: prepared.length,
    updateCount: prepared.reduce((sum, item) => sum + item.updates.length, 0),
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`无法识别的参数: ${token}`);
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runCli(argv) {
  const args = parseArgs(argv);
  if (args.command === "scan") {
    await writeJson(args.output, await scanDirectory(args["input-dir"]));
    return;
  }
  if (args.command === "plan") {
    const titles = await readJson(args.titles);
    const selected = await readJson(args.selected);
    const candidates = await readJson(args.candidates);
    await writeJson(args.output, buildUpdatePlan(titles, selected, candidates));
    return;
  }
  if (args.command === "apply") {
    const plan = await readJson(args.plan);
    const report = await applyUpdatePlan(plan, {
      dryRun: args["dry-run"] === true,
      tempDir: args["temp-dir"],
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  throw new Error("命令必须是 scan plan 或 apply");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
