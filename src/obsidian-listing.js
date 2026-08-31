import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const START_MARKER = '<!-- alibaba-listing-batch:start -->';
const END_MARKER = '<!-- alibaba-listing-batch:end -->';
const SELLING_POINTS_START_MARKER = '<!-- selling-points:start -->';
const SELLING_POINTS_END_MARKER = '<!-- selling-points:end -->';
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

export const OBSIDIAN_LISTING_SCHEMA_VERSION = 1;
export const DEFAULT_OBSIDIAN_ROOT = 'C:\\obsidian\\obsidian\\国际站发品';

export function extractListingPayload(markdown) {
  if (typeof markdown !== 'string') throw new Error('Markdown 内容必须是字符串');

  const start = markdown.indexOf(START_MARKER);
  const end = markdown.indexOf(END_MARKER, start + START_MARKER.length);
  if (start < 0 || end < 0) throw new Error('缺少阿里发品机器数据块');
  if (
    markdown.indexOf(START_MARKER, start + START_MARKER.length) >= 0
    || markdown.indexOf(END_MARKER, end + END_MARKER.length) >= 0
  ) {
    throw new Error('Markdown 只能包含一个阿里发品机器数据块');
  }

  const block = markdown.slice(start + START_MARKER.length, end).trim();
  const match = /^```json\s*\r?\n([\s\S]*?)\r?\n```$/.exec(block);
  if (!match) throw new Error('阿里发品机器数据块必须使用 json 代码块');

  return JSON.parse(match[1]);
}

function readLegacyPayload(markdown) {
  if (!markdown.includes(START_MARKER) && !markdown.includes(END_MARKER)) {
    return { payload: null, warnings: [] };
  }
  try {
    return { payload: extractListingPayload(markdown), warnings: [] };
  } catch (error) {
    return { payload: null, warnings: [`机器数据块无效，当前按正文读取：${error.message}`] };
  }
}

function sectionBetween(markdown, headingPattern, nextHeadingPattern = /^#{2,3}\s+.+$/gm) {
  const heading = headingPattern.exec(markdown);
  if (!heading) return null;
  const contentStart = heading.index + heading[0].length;
  const nextHeading = nextHeadingPattern;
  nextHeading.lastIndex = contentStart;
  const next = nextHeading.exec(markdown);
  const marker = markdown.indexOf(SELLING_POINTS_END_MARKER, contentStart);
  const contentEnd = [next?.index, marker >= 0 ? marker : undefined]
    .filter((value) => value !== undefined)
    .reduce((end, value) => Math.min(end, value), markdown.length);
  return markdown.slice(contentStart, contentEnd);
}

function parseBodyPlan(section, planNumber) {
  const titleLines = [...section.matchAll(/^[ \t]*-[ \t]+\*\*Title:\*\*[ \t]*(.*?)[ \t]*$/gim)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  if (titleLines.length !== 1) throw new Error(`方案 ${planNumber} 缺少 Title`);

  const attributesSection = sectionBetween(section, /^###\s+10 Custom Attributes\s*$/im);
  if (attributesSection === null) throw new Error(`方案 ${planNumber} 缺少 Custom Attributes`);
  const attributes = [...attributesSection.matchAll(/^[ \t]*(\d+)\.[ \t]+([^:\r\n]+):[ \t]*(.*?)[ \t]*$/gm)]
    .map((match) => ({ name: match[2].trim(), value: match[3].trim() }))
    .filter(({ name, value }) => name && value);
  if (attributes.length !== 10) {
    throw new Error(`方案 ${planNumber} 的 Custom Attributes 必须正好包含 10 条，实际包含 ${attributes.length} 条`);
  }

  const faqsSection = sectionBetween(section, /^###\s+5 FAQs\s*$/im);
  if (faqsSection === null) throw new Error(`方案 ${planNumber} 缺少 FAQs`);
  const questionMatches = [...faqsSection.matchAll(/^[ \t]*(\d+)\.[ \t]+\*\*Q:\*\*[ \t]*(.*?)[ \t]*$/gim)];
  if (questionMatches.length !== 5) {
    throw new Error(`方案 ${planNumber} 的 FAQs 必须正好包含 5 条，实际包含 ${questionMatches.length} 条`);
  }
  const faqs = questionMatches.map((questionMatch, index) => {
    const answerStart = questionMatch.index + questionMatch[0].length;
    const answerEnd = questionMatches[index + 1]?.index ?? faqsSection.length;
    const answerSection = faqsSection.slice(answerStart, answerEnd);
    const answerMatch = /^[ \t]*\*\*A:\*\*[ \t]*(.*?)[ \t]*$/im.exec(answerSection);
    if (!answerMatch || !answerMatch[1].trim()) {
      throw new Error(`方案 ${planNumber} FAQ ${questionMatch[1]} 缺少 Answer`);
    }
    return { question: questionMatch[2].trim(), answer: answerMatch[1].trim() };
  });

  const sellingMarkerStarts = section.split(SELLING_POINTS_START_MARKER).length - 1;
  const sellingMarkerEnds = section.split(SELLING_POINTS_END_MARKER).length - 1;
  if (sellingMarkerStarts !== sellingMarkerEnds || sellingMarkerStarts > 1) {
    throw new Error(`方案 ${planNumber} 的 selling-points 标记必须成对出现`);
  }
  const sellingHeading = /^####\s+Selling Points\s*$/im.exec(section);
  if (sellingMarkerStarts === 1) {
    const start = section.indexOf(SELLING_POINTS_START_MARKER);
    const end = section.indexOf(SELLING_POINTS_END_MARKER);
    if (!sellingHeading || start > sellingHeading.index || end < sellingHeading.index + sellingHeading[0].length) {
      throw new Error(`方案 ${planNumber} 的 selling-points 标记必须包围 Selling Points 区段`);
    }
  }
  const sellingPointsSection = sectionBetween(
    section,
    /^####\s+Selling Points\s*$/im,
    /^#{1,6}\s+.+$/gm,
  );
  if (sellingPointsSection === null) throw new Error(`方案 ${planNumber} 缺少 Selling Points`);
  const points = [...sellingPointsSection.matchAll(/^[ \t]*[•*-][ \t]+(.+?)[ \t]*$/gm)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  if (points.length !== 5) {
    throw new Error(`方案 ${planNumber} 的 Selling Points 必须正好包含 5 条，实际包含 ${points.length} 条`);
  }

  return {
    id: `plan-${planNumber}`,
    title: titleLines[0],
    sellingPoints: points.join('\n'),
    faqs,
    customAttributes: attributes,
  };
}

export function parseListingBody(markdown, source = {}, legacyPayload = null) {
  if (typeof markdown !== 'string') throw new Error('Markdown 内容必须是字符串');
  const machineStart = markdown.indexOf(START_MARKER);
  const humanMarkdown = machineStart >= 0 ? markdown.slice(0, machineStart) : markdown;
  const matches = [...humanMarkdown.matchAll(/^##\s+方案\s+(\d+)(?:[：:].*)?$/gm)];
  const numbers = matches.map((match) => match[1]);
  if (matches.length !== 5 || numbers.join(',') !== '1,2,3,4,5') {
    throw new Error('方案编号必须恰好为 1、2、3、4、5');
  }
  const plans = matches.map((match, index) => {
    const end = matches[index + 1]?.index ?? humanMarkdown.length;
    return parseBodyPlan(humanMarkdown.slice(match.index, end), Number(match[1]));
  });
  const heading = /^#\s+(.+?)(?:\s+国际站发品方案)?\s*$/m.exec(humanMarkdown)?.[1]?.trim();
  const fallbackName = path.parse(source.fileName || 'Obsidian Listing').name;
  const pathKey = String(source.relativePath || source.fileName || fallbackName).replaceAll('\\', '/');
  const fallbackId = `obsidian-${createHash('sha256').update(pathKey).digest('hex').slice(0, 16)}`;
  return validateListingBatch({
    schemaVersion: OBSIDIAN_LISTING_SCHEMA_VERSION,
    batchId: legacyPayload?.batchId || fallbackId,
    batchName: heading || fallbackName,
    plans,
  }, source);
}

function requireRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} 必须是对象`);
  }
  return value;
}

function requireString(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} 不能为空`);
  return value.trim();
}

function normalizeFaq(faq, path) {
  requireRecord(faq, path);
  return {
    question: requireString(faq.question, `${path}.question`),
    answer: requireString(faq.answer, `${path}.answer`),
  };
}

function normalizeAttribute(attribute, path) {
  requireRecord(attribute, path);
  return {
    name: requireString(attribute.name, `${path}.name`),
    value: requireString(attribute.value, `${path}.value`),
  };
}

function normalizePlan(plan, index) {
  const path = `plans[${index}]`;
  requireRecord(plan, path);
  if (!Array.isArray(plan.faqs) || plan.faqs.length !== 5) {
    throw new Error(`${path}.faqs 必须正好包含 5 条`);
  }
  if (!Array.isArray(plan.customAttributes) || plan.customAttributes.length !== 10) {
    throw new Error(`${path}.customAttributes 必须正好包含 10 条`);
  }

  const customAttributes = plan.customAttributes.map((attribute, attributeIndex) => (
    normalizeAttribute(attribute, `${path}.customAttributes[${attributeIndex}]`)
  ));
  const attributeNames = customAttributes.map(({ name }) => name.toLocaleLowerCase());
  if (new Set(attributeNames).size !== attributeNames.length) {
    throw new Error(`${path}.customAttributes 属性名不能重复`);
  }

  return {
    id: requireString(plan.id, `${path}.id`),
    title: requireString(plan.title, `${path}.title`),
    sellingPoints: requireString(plan.sellingPoints, `${path}.sellingPoints`),
    faqs: plan.faqs.map((faq, faqIndex) => normalizeFaq(faq, `${path}.faqs[${faqIndex}]`)),
    customAttributes,
  };
}

export function validateListingBatch(payload, source = {}) {
  requireRecord(payload, '批次');
  if (payload.schemaVersion !== OBSIDIAN_LISTING_SCHEMA_VERSION) {
    throw new Error(`不支持 schemaVersion ${String(payload.schemaVersion)}`);
  }
  if (!Array.isArray(payload.plans) || payload.plans.length !== 5) {
    throw new Error('plans 必须正好包含 5 套方案');
  }

  const plans = payload.plans.map(normalizePlan);
  const planIds = plans.map(({ id }) => id.toLocaleLowerCase());
  if (new Set(planIds).size !== planIds.length) throw new Error('方案 id 不能重复');

  return {
    schemaVersion: OBSIDIAN_LISTING_SCHEMA_VERSION,
    batchId: requireString(payload.batchId, 'batchId'),
    batchName: requireString(payload.batchName, 'batchName'),
    plans,
    source: { ...source },
  };
}

function isInsideRoot(rootDir, candidate) {
  const relative = path.relative(rootDir, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function portableRelativePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

async function discoverMarkdownFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await discoverMarkdownFiles(rootDir, entryPath));
    } else if (entry.isFile() && path.extname(entry.name).toLocaleLowerCase() === '.md') {
      files.push(entryPath);
    }
  }
  return files;
}

export async function listObsidianBatches(rootDir = DEFAULT_OBSIDIAN_ROOT) {
  const resolvedRoot = path.resolve(rootDir);
  try {
    await stat(resolvedRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = await discoverMarkdownFiles(resolvedRoot);
  const results = [];
  for (const filePath of files) {
    const fileStat = await stat(filePath);
    const relativePath = portableRelativePath(resolvedRoot, filePath);
    const metadata = {
      relativePath,
      fileName: path.basename(filePath),
      modifiedAt: fileStat.mtime.toISOString(),
      size: fileStat.size,
    };
    try {
      const batch = await readObsidianBatch(resolvedRoot, relativePath);
      results.push({
        ...metadata,
        valid: true,
        error: '',
        batchId: batch.batchId,
        batchName: batch.batchName,
        warnings: Array.isArray(batch.source.warnings) ? [...batch.source.warnings] : [],
      });
    } catch (error) {
      results.push({ ...metadata, valid: false, error: error.message, batchId: '', batchName: '' });
    }
  }
  return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
}

export async function readObsidianBatch(rootDir = DEFAULT_OBSIDIAN_ROOT, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) throw new Error('必须提供 Markdown 相对路径');
  if (path.isAbsolute(relativePath)) throw new Error('必须使用相对路径');
  if (path.extname(relativePath).toLocaleLowerCase() !== '.md') throw new Error('只允许读取 Markdown 文件');

  const resolvedRoot = path.resolve(rootDir);
  const requestedPath = path.resolve(resolvedRoot, relativePath);
  if (!isInsideRoot(resolvedRoot, requestedPath)) throw new Error('文件必须位于 Obsidian 发品目录内');

  const [realRoot, realFile] = await Promise.all([realpath(resolvedRoot), realpath(requestedPath)]);
  if (!isInsideRoot(realRoot, realFile)) throw new Error('文件必须位于 Obsidian 发品目录内');

  const fileStat = await stat(realFile);
  if (!fileStat.isFile()) throw new Error('目标不是 Markdown 文件');
  if (fileStat.size > MAX_MARKDOWN_BYTES) throw new Error('Markdown 文件不能超过 2 MiB');

  const markdown = await readFile(realFile, 'utf8');
  const source = {
    relativePath: portableRelativePath(realRoot, realFile),
    fileName: path.basename(realFile),
    modifiedAt: fileStat.mtime.toISOString(),
    size: fileStat.size,
  };
  const legacy = readLegacyPayload(markdown);
  const warnings = [...legacy.warnings];
  let legacyIdentity = null;
  let comparableLegacyPlans = null;
  if (legacy.payload) {
    try {
      legacyIdentity = { batchId: requireString(legacy.payload.batchId, 'batchId') };
    } catch (error) {
      warnings.push(`机器数据块无效，当前按正文读取：${error.message}`);
    }
    try {
      comparableLegacyPlans = validateListingBatch(legacy.payload).plans;
    } catch (error) {
      if (!warnings.some((warning) => warning.includes(error.message))) {
        warnings.push(`机器数据块无效，当前按正文读取：${error.message}`);
      }
    }
  }

  const batch = parseListingBody(markdown, source, legacyIdentity);
  if (comparableLegacyPlans && JSON.stringify(comparableLegacyPlans) !== JSON.stringify(batch.plans)) {
    warnings.push('机器数据块内容已过期，当前按正文读取');
  }
  return {
    ...batch,
    source: { ...batch.source, warnings },
  };
}
