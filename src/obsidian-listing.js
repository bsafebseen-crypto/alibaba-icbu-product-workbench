import { readFile, readdir, realpath, stat } from 'node:fs/promises';
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

function managedSellingPointsByPlan(markdown) {
  const machineBlockStart = markdown.indexOf(START_MARKER);
  const humanMarkdown = machineBlockStart >= 0 ? markdown.slice(0, machineBlockStart) : markdown;
  const headings = [...humanMarkdown.matchAll(/^##\s+方案\s+(\d+)(?:[：:].*)?$/gm)];
  const values = new Map();

  headings.forEach((heading, index) => {
    const planId = `plan-${heading[1]}`;
    if (values.has(planId)) throw new Error(`${planId} 的正文方案标题不能重复`);
    const sectionEnd = headings[index + 1]?.index ?? humanMarkdown.length;
    const section = humanMarkdown.slice(heading.index + heading[0].length, sectionEnd);
    const starts = section.split(SELLING_POINTS_START_MARKER).length - 1;
    const ends = section.split(SELLING_POINTS_END_MARKER).length - 1;
    if (starts !== 1 || ends !== 1) throw new Error(`${planId} 必须包含一个正文卖点块`);

    const start = section.indexOf(SELLING_POINTS_START_MARKER);
    const end = section.indexOf(SELLING_POINTS_END_MARKER, start + SELLING_POINTS_START_MARKER.length);
    if (end < start) throw new Error(`${planId} 的正文卖点块顺序无效`);
    const block = section.slice(start + SELLING_POINTS_START_MARKER.length, end);
    const headingMatch = /^####\s+Selling Points\s*$/im.exec(block);
    if (!headingMatch) throw new Error(`${planId} 的正文卖点块缺少 Selling Points 标题`);
    const sellingPointLines = block
      .slice(headingMatch.index + headingMatch[0].length)
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = /^\s*•\s+(.+?)\s*$/.exec(line);
        return match ? [match[1]] : [];
      });
    if (sellingPointLines.length !== 5) {
      throw new Error(`${planId} 的正文卖点必须正好包含 5 条`);
    }
    values.set(planId, sellingPointLines.join('\n'));
  });

  return values;
}

function applyManagedSellingPoints(payload, markdown) {
  const values = managedSellingPointsByPlan(markdown);
  if (!Array.isArray(payload?.plans)) return payload;
  return {
    ...payload,
    plans: payload.plans.map((plan) => {
      const planId = String(plan?.id || '').trim();
      const sellingPoints = values.get(planId);
      if (!sellingPoints) throw new Error(`${planId || '未知方案'} 缺少有效的正文卖点`);
      return { ...plan, sellingPoints };
    }),
  };
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
  return validateListingBatch(applyManagedSellingPoints(extractListingPayload(markdown), markdown), {
    relativePath: portableRelativePath(realRoot, realFile),
    fileName: path.basename(realFile),
    modifiedAt: fileStat.mtime.toISOString(),
    size: fileStat.size,
  });
}
