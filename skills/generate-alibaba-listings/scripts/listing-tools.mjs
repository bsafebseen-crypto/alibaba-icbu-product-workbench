import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FUNCTION_WORDS = [
  "with",
  "for",
  "in",
  "on",
  "at",
  "by",
  "from",
  "to",
  "of",
  "as",
  "into",
  "over",
  "under",
  "and",
  "or",
];

export function normalizePhrase(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\bmen['’]s\b/g, "mens")
    .replace(/[-_/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseIsValid(tokens, functionWordSet) {
  const lowercaseWordSet = new Set([...functionWordSet, "a", "an", "the"]);
  return tokens.every((token) => {
    const lower = token.toLowerCase();
    if (lowercaseWordSet.has(lower)) return token === lower;
    if (/^\p{N}[\p{L}\p{N}]*$/u.test(token)) return true;
    const casedLetters = [...token].filter((character) =>
      /\p{L}/u.test(character) && character.toLowerCase() !== character.toUpperCase());
    if (casedLetters.length === 0) return /^[\p{L}\p{N}]+$/u.test(token);
    if (casedLetters[0] !== casedLetters[0].toUpperCase()) return false;
    const remaining = casedLetters.slice(1);
    const allLower = remaining.every((character) => character === character.toLowerCase());
    const allUpper = remaining.every((character) => character === character.toUpperCase());
    return allLower || allUpper;
  });
}

export function validateTitle(title, options = {}) {
  const text = String(title ?? "");
  const min = options.min ?? 120;
  const max = options.max ?? 128;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const loweredTokens = tokens.map((token) => token.toLowerCase());
  const additionalFunctionWords = (options.additionalFunctionWords ?? [])
    .flatMap((word) => normalizePhrase(word).split(" "))
    .filter(Boolean);
  const functionWordSet = new Set([...FUNCTION_WORDS, ...additionalFunctionWords]);
  const functionWords = loweredTokens.filter((token) => functionWordSet.has(token));
  const punctuation = [...text.matchAll(/[^\p{L}\p{N}\s]/gu)].map((match) => match[0]);
  const casingValid = titleCaseIsValid(tokens, functionWordSet);

  let coreBeforeFunctionWord = true;
  if (options.corePhrase && functionWords.length === 1) {
    const normalizedTitle = normalizePhrase(text);
    const normalizedCore = normalizePhrase(options.corePhrase);
    const functionIndex = normalizedTitle.split(" ").findIndex((token) => token === functionWords[0]);
    const coreIndex = normalizedTitle.split(" ").join(" ").indexOf(normalizedCore);
    const functionCharacterIndex = normalizedTitle
      .split(" ")
      .slice(0, functionIndex)
      .join(" ").length + (functionIndex > 0 ? 1 : 0);
    coreBeforeFunctionWord = coreIndex >= 0 && coreIndex < functionCharacterIndex;
  }

  const errors = [];
  if (text.length < min || text.length > max) errors.push("字符数必须为 120–128");
  if (punctuation.length > 0) errors.push("标题不得包含标点");
  if (functionWords.length !== 1) errors.push("标题必须只含一个介词或连词");
  if (!coreBeforeFunctionWord) errors.push("产品核心词必须位于唯一介词或连词之前");
  if (!casingValid) errors.push("标题大小写不符合规则");

  return {
    valid: errors.length === 0,
    charCount: text.length,
    punctuation,
    functionWords,
    coreBeforeFunctionWord,
    casingValid,
    errors,
  };
}

function containsStrictPhrase(normalizedTitle, normalizedKeyword) {
  if (!normalizedKeyword) return false;
  return ` ${normalizedTitle} `.includes(` ${normalizedKeyword} `);
}

export function findStrictCoverage(title, keywords) {
  const normalizedTitle = normalizePhrase(title);
  return keywords.filter((candidate) =>
    containsStrictPhrase(normalizedTitle, normalizePhrase(candidate.keyword)),
  );
}

function normalizeRootToken(token) {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function rootTokens(value) {
  return normalizePhrase(value).split(" ").filter(Boolean).map(normalizeRootToken);
}

function tokenCounts(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function containsRootMultiset(titleTokens, keywordTokens) {
  const titleCounts = tokenCounts(titleTokens);
  const keywordCounts = tokenCounts(keywordTokens);
  for (const [token, required] of keywordCounts) {
    if ((titleCounts.get(token) ?? 0) < required) return false;
  }
  return keywordTokens.length > 0;
}

export function findIndirectCoverage(title, keywords) {
  const normalizedTitle = normalizePhrase(title);
  const titleTokens = rootTokens(normalizedTitle);
  return keywords.filter((candidate) => {
    const normalizedKeyword = normalizePhrase(candidate.keyword);
    if (!normalizedKeyword || containsStrictPhrase(normalizedTitle, normalizedKeyword)) return false;
    return containsRootMultiset(titleTokens, rootTokens(normalizedKeyword));
  });
}

function coveredByRoots(title, keywords) {
  const titleTokens = rootTokens(title);
  return keywords.filter((candidate) => containsRootMultiset(titleTokens, rootTokens(candidate.keyword)));
}

function candidateKey(candidate, index) {
  return `${candidate.workbookPath ?? ""}|${candidate.sheetName ?? ""}|${candidate.rowNumber ?? ""}|${candidate.keyword ?? ""}|${index}`;
}

export function analyzeKeywordCompression(title, keywords, options = {}) {
  const candidates = Array.isArray(keywords) ? keywords : [];
  const strict = findStrictCoverage(title, candidates);
  const indirect = findIndirectCoverage(title, candidates);
  const covered = coveredByRoots(title, candidates);
  const coveredSet = new Set(covered);
  const titleTokens = rootTokens(title);
  const additionalFunctionWords = (options.additionalFunctionWords ?? [])
    .flatMap((word) => rootTokens(word));
  const analysisFunctionWordSet = new Set([...FUNCTION_WORDS, ...additionalFunctionWords]);
  const contentTokens = titleTokens.filter((token) =>
    !analysisFunctionWordSet.has(token) && !["a", "an", "the"].includes(token));
  const counts = tokenCounts(contentTokens);
  const repeatedRoots = Object.fromEntries([...counts].filter(([, count]) => count > 1));
  const baseKeys = new Set(covered.map(candidateKey));
  const avoidableRepeatedRoots = {};

  for (let index = 0; index < titleTokens.length; index += 1) {
    const token = titleTokens[index];
    if ((counts.get(token) ?? 0) < 2 || analysisFunctionWordSet.has(token)) continue;
    const reduced = titleTokens.filter((_, tokenIndex) => tokenIndex !== index).join(" ");
    const reducedKeys = new Set(coveredByRoots(reduced, candidates).map(candidateKey));
    if (reducedKeys.size === baseKeys.size && [...baseKeys].every((key) => reducedKeys.has(key))) {
      avoidableRepeatedRoots[token] = (avoidableRepeatedRoots[token] ?? 0) + 1;
    }
  }

  const coveredSearchIndexTotal = covered.reduce((sum, candidate) =>
    sum + (Number(candidate.searchIndex) || 0), 0);
  const coveredClickPotential = covered.reduce((sum, candidate) =>
    sum + (Number(candidate.searchIndex) || 0) * (Number(candidate.clickThroughRate) || 0), 0);
  const keywordRootTokenTotal = covered.reduce((sum, candidate) =>
    sum + rootTokens(candidate.keyword).length, 0);

  return {
    coveredKeywordCount: covered.length,
    coveredKeywords: covered.map((candidate) => candidate.keyword),
    strictKeywords: strict.map((candidate) => candidate.keyword),
    indirectKeywords: indirect.map((candidate) => candidate.keyword),
    uncoveredKeywords: candidates.filter((candidate) => !coveredSet.has(candidate)).map((candidate) => candidate.keyword),
    coveredSearchIndexTotal,
    coveredClickPotential,
    coverageEfficiency: title.length ? coveredSearchIndexTotal / title.length : 0,
    keywordRootTokenTotal,
    titleRootTokenCount: contentTokens.length,
    rootCompressionRatio: contentTokens.length ? keywordRootTokenTotal / contentTokens.length : 0,
    repeatedRoots,
    avoidableRepeatedRoots,
    avoidableRepeatedRootCount: Object.values(avoidableRepeatedRoots).reduce((sum, count) => sum + count, 0),
  };
}

async function listMarkdownFiles(rootDir) {
  const found = [];
  async function visit(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) found.push(entryPath);
    }
  }
  await visit(rootDir);
  return found;
}

export async function collectHistoricalModels(rootDir) {
  const models = new Set();
  for (const file of await listMarkdownFiles(rootDir)) {
    const content = await fs.readFile(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const matches = line.match(/YL-[A-Za-z0-9]+(?: [A-Za-z0-9]+)* [A-Z0-9]{3}\b/g) ?? [];
      for (const model of matches) models.add(model.trim());
    }
  }
  return models;
}

function randomSuffix() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(3);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export function createUniqueModel(coreKeyword, existing, suffixFactory = randomSuffix) {
  const normalizedCore = String(coreKeyword ?? "").replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalizedCore) throw new Error("型号核心关键词不能为空");
  for (let attempt = 0; attempt < 46656; attempt += 1) {
    const fallback = attempt.toString(36).toUpperCase().padStart(3, "0").slice(-3);
    const proposed = attempt === 0 ? suffixFactory(attempt) : fallback;
    const suffix = String(proposed).toUpperCase().replace(/[^A-Z0-9]/g, "").padEnd(3, "0").slice(0, 3);
    const model = `YL-${normalizedCore} ${suffix}`;
    if (!existing.has(model)) {
      existing.add(model);
      return model;
    }
  }
  throw new Error("无法生成唯一型号");
}

function safeFileName(value) {
  const cleaned = String(value ?? "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error("产品名称不能为空");
  return cleaned;
}

export async function resolveMarkdownPath(rootDir, date, productName) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期必须使用 YYYY-MM-DD 格式");
  const dayDir = path.join(rootDir, date);
  const base = safeFileName(productName);
  await fs.mkdir(dayDir, { recursive: true });
  for (let index = 1; index < 10000; index += 1) {
    const fileName = index === 1 ? `${base}.md` : `${base}-${index}.md`;
    const candidate = path.join(dayDir, fileName);
    try {
      await fs.access(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new Error("同名产品文件数量过多");
}

export async function writeMarkdownAtomic(outputPath, markdown) {
  try {
    await fs.access(outputPath);
    throw new Error(`目标文件已存在: ${outputPath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, markdown, { encoding: "utf8", flag: "wx" });
    const verified = await fs.readFile(tempPath, "utf8");
    if (verified !== markdown) throw new Error("Markdown 临时文件验证失败");
    await fs.rename(tempPath, outputPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
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

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runCli(argv) {
  const args = parseArgs(argv);
  if (args.command === "validate") {
    const input = JSON.parse(await fs.readFile(args.input, "utf8"));
    const reports = input.map((item) => ({ ...item, report: validateTitle(item.title, item) }));
    await writeJson(args.output, reports);
    return;
  }
  if (args.command === "analyze") {
    const input = JSON.parse(await fs.readFile(args.input, "utf8"));
    const reports = input.map((item) => ({
      ...item,
      compression: analyzeKeywordCompression(item.title, item.keywords, item),
    }));
    await writeJson(args.output, reports);
    return;
  }
  if (args.command === "history") {
    await writeJson(args.output, [...(await collectHistoricalModels(args.root))].sort());
    return;
  }
  if (args.command === "output-path") {
    process.stdout.write(`${await resolveMarkdownPath(args.root, args.date, args.product)}\n`);
    return;
  }
  if (args.command === "write-markdown") {
    await writeMarkdownAtomic(args.path, await fs.readFile(args.input, "utf8"));
    return;
  }
  throw new Error("命令必须是 validate analyze history output-path 或 write-markdown");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
