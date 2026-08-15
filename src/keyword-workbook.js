import ExcelJS from 'exceljs';

const HEADER_PATTERN = /^(keyword|keywords|search\s*term|word|关键词(?:表)?|搜索词|词根)$/i;

function normalizeCellText(cell) {
  const value = cell.value;
  if (value === null || value === undefined || typeof value === 'number' || value instanceof Date) return '';
  return String(cell.text || value).trim();
}

function addUniqueWord(words, seen, value) {
  const word = String(value || '').trim();
  const key = word.toLowerCase();
  if (!word || HEADER_PATTERN.test(word) || seen.has(key)) return;
  seen.add(key);
  words.push(word);
}

export async function parseKeywordWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const words = [];
  const seen = new Set();
  const sheets = [];

  workbook.eachSheet((worksheet) => {
    sheets.push(worksheet.name);
    let keywordColumn = 0;
    let headerRow = 0;

    for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 12) && !keywordColumn; rowNumber += 1) {
      worksheet.getRow(rowNumber).eachCell((cell, columnNumber) => {
        if (!keywordColumn && HEADER_PATTERN.test(normalizeCellText(cell))) {
          keywordColumn = columnNumber;
          headerRow = rowNumber;
        }
      });
    }

    if (keywordColumn) {
      for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        addUniqueWord(words, seen, normalizeCellText(worksheet.getRow(rowNumber).getCell(keywordColumn)));
      }
      return;
    }

    worksheet.eachRow((row) => {
      row.eachCell((cell) => addUniqueWord(words, seen, normalizeCellText(cell)));
    });
  });

  return { words, sheets };
}
