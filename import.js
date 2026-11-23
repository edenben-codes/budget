// ===== ייבוא תנועות מקובץ אקסל / CSV =====
// הקובץ נקרא בתוך הדפדפן בלבד. רק התנועות שהמשתמש מאשר נשמרות – בדיוק כמו תנועה שהוספה ידנית.
// משתמשים בפונקציות ובנתונים של script.js (transactions, categories, render, ...), ולכן הקובץ נטען אחריו.

// ספריית SheetJS יודעת לקרוא קבצי אקסל. טוענים אותה רק כשצריך, מהאתר הרשמי שלה, בגרסה קבועה.
const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const IMPORT_MAPPINGS_KEY = 'budget-import-mappings'; // ההתאמות שנשמרו לכל מבנה קובץ
const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;        // 10MB
const MAX_IMPORT_AMOUNT = 10000000;                    // סכום גדול מזה – כנראה לא תנועה (למשל מספר אסמכתא)

// ----- אלמנטים -----
const importDialog = document.getElementById('import-dialog');
const importStepFile = document.getElementById('import-step-file');
const importStepMap = document.getElementById('import-step-map');
const importActions = document.getElementById('import-actions');
const importErrorBox = document.getElementById('import-error');
const importChooseBtn = document.getElementById('import-choose');
const importFileField = document.getElementById('import-excel-file');
const importPreviewBody = document.getElementById('import-preview');
const importSummary = document.getElementById('import-summary');
const importConfirmBtn = document.getElementById('import-confirm');
const importSelectAll = document.getElementById('import-select-all');
const mapSelects = {
  date: document.getElementById('map-date'),
  desc: document.getElementById('map-desc'),
  amount: document.getElementById('map-amount'),
  debit: document.getElementById('map-debit'),
  credit: document.getElementById('map-credit'),
};
const mapMode = document.getElementById('map-mode');

// ----- מצב הייבוא -----
let importRows = [];        // כל השורות מהקובץ (כל שורה = מערך של תאים)
let importHeaderIndex = -1; // באיזו שורה נמצאות הכותרות (1- = אין כותרות)
let importHeaders = [];     // שמות העמודות
let importParsed = [];      // התנועות המפוענחות לתצוגה המקדימה
let importSkipped = 0;      // כמה שורות דולגו (כותרות, סיכומים, שורות ריקות)

// ----- טעינת SheetJS (פעם אחת בלבד) -----
let sheetJsPromise = null;
function loadSheetJS() {
  if (window.XLSX) {
    return Promise.resolve(window.XLSX);
  }
  if (!sheetJsPromise) {
    // Promise – "הבטחה" שתתממש כשהסקריפט ייטען (או תיכשל אם אין אינטרנט)
    sheetJsPromise = new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = SHEETJS_URL;
      script.onload = function () {
        resolve(window.XLSX);
      };
      script.onerror = function () {
        sheetJsPromise = null; // כדי שאפשר יהיה לנסות שוב
        reject(new Error('sheetjs-load-failed'));
      };
      document.head.appendChild(script);
    });
  }
  return sheetJsPromise;
}

// ===== פענוח ערכים מהקובץ =====

// מנקה תא: הופך לטקסט, מוריד סימני כיווניות נסתרים ורווחים בקצוות
function cleanCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/[‎‏‪-‮ ]/g, ' ').trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// בונה תאריך YYYY-MM-DD ובודקת שהוא באמת קיים (לא 31 בפברואר)
function toIsoDate(year, month, day) {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const check = new Date(year, month - 1, day);
  if (check.getMonth() !== month - 1) {
    return null;
  }
  return year + '-' + pad2(month) + '-' + pad2(day);
}

// מפענחת תאריך בכל הפורמטים הנפוצים. בישראל היום בא לפני החודש (23/11/2026)
function parseImportDate(value) {
  // אקסל שומר תאריכים כמספר ימים מאז 1900 (למשל 46349)
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const parts = window.XLSX.SSF.parse_date_code(value);
    return parts ? toIsoDate(parts.y, parts.m, parts.d) : null;
  }
  const text = cleanCell(value);
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // 2026-11-23
  if (match) {
    return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  match = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/); // 23/11/2026, 23.11.26, 23-11-2026
  if (match) {
    let year = Number(match[3]);
    if (year < 100) {
      year += 2000;
    }
    return toIsoDate(year, Number(match[2]), Number(match[1]));
  }
  return null;
}

// מפענחת סכום: "1,234.50", "₪ 99", "100-", "(100)", "-50"
function parseImportAmount(value) {
  if (typeof value === 'number') {
    return isFinite(value) ? value : null;
  }
  let text = cleanCell(value).replace(/₪|ש"ח|ש״ח|NIS|ILS/gi, '').replace(/\s/g, '');
  if (text === '') {
    return null;
  }
  let negative = false;
  if (/^\(.*\)$/.test(text)) {      // (100) = מינוס בפורמט חשבונאי
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith('-')) {          // 100- = מינוס (נפוץ בבנקים בישראל)
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  }
  text = text.replace(/,/g, '');     // מפריד אלפים
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return null;
  }
  const number = parseFloat(text);
  return negative ? -number : number;
}

// ===== זיהוי מבנה הקובץ =====
const HEADER_WORDS = ['תאריך', 'תיאור', 'פרטים', 'סכום', 'חובה', 'זכות', 'בית עסק', 'בית העסק',
  'אסמכתא', 'יתרה', 'הפעולה', 'תנועה', 'date', 'description', 'details', 'note', 'amount', 'value',
  'debit', 'credit', 'balance'];

// מחפשת את שורת הכותרות בין 30 השורות הראשונות: השורה עם הכי הרבה מילים מוכרות
function findHeaderRow(rows) {
  let best = -1;
  let bestScore = 0;
  rows.slice(0, 30).forEach(function (row, index) {
    const score = row.filter(function (cell) {
      const text = cleanCell(cell).toLowerCase();
      return text !== '' && text.length < 40 && HEADER_WORDS.some(function (word) {
        return text.includes(word);
      });
    }).length;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return bestScore >= 2 ? best : -1;
}

// מוצאת עמודה לפי רשימת מילים, לפי סדר העדיפות של המילים.
// toLowerCase – כדי ש-"Date" ו-"date" ייחשבו אותו דבר
function findColumn(words, exclude) {
  for (const word of words) {
    const index = importHeaders.findIndex(function (header) {
      const text = header.toLowerCase();
      return text.includes(word) && !(exclude || []).some(function (bad) {
        return text.includes(bad);
      });
    });
    if (index !== -1) {
      return index;
    }
  }
  return -1;
}

// ניחוש אוטומטי של העמודות לפי שמות מקובלים
function guessMapping() {
  const debit = findColumn(['חובה', 'debit']);
  const credit = findColumn(['זכות', 'credit']);
  const amount = findColumn(['סכום חיוב', 'סכום החיוב', 'סכום העסקה', 'סכום עסקה', 'סכום', 'amount', 'value'], ['מקורי']);
  let mode = 'signed';
  if (debit !== -1 && credit !== -1) {
    mode = 'split';
  } else if (amount !== -1 && /חיוב|עסקה/.test(importHeaders[amount])) {
    mode = 'expense-positive'; // פירוט כרטיס אשראי: סכום חיובי = חיוב (הוצאה)
  }
  return {
    date: findColumn(['תאריך עסקה', 'תאריך העסקה', 'תאריך', 'date'], ['ערך', 'חיוב']),
    desc: findColumn(['שם בית העסק', 'שם בית עסק', 'בית עסק', 'תיאור', 'פרטים', 'הפעולה', 'תנועה', 'description', 'details', 'note']),
    amount: amount,
    debit: debit,
    credit: credit,
    mode: mode,
  };
}

// "חתימה" של מבנה הקובץ – לפיה זוכרים התאמה שהמשתמש תיקן
function getSignature() {
  return importHeaders.join('|');
}
function loadSavedMappings() {
  try {
    const saved = JSON.parse(localStorage.getItem(IMPORT_MAPPINGS_KEY) || '{}');
    return saved !== null && typeof saved === 'object' ? saved : {};
  } catch (error) {
    return {};
  }
}
function saveMapping(mapping) {
  try {
    const all = loadSavedMappings();
    all[getSignature()] = mapping;
    localStorage.setItem(IMPORT_MAPPINGS_KEY, JSON.stringify(all));
  } catch (error) {
    // אם האחסון חסום – פשוט לא זוכרים
  }
}

// ===== ניחוש קטגוריה לפי התיאור =====
// הסדר חשוב: "סופר-פארם" צריך להיתפס כבריאות לפני ש"סופר" יתפוס אותו כמזון
const CATEGORY_KEYWORDS = {
  expense: [
    ['בריאות', ['סופר-פארם', 'סופר פארם', 'superpharm', 'מכבי', 'כללית', 'מאוחדת', 'לאומית', 'בית מרקחת', 'רופא']],
    ['מזון', ['שופרסל', 'רמי לוי', 'יוחננוף', 'ויקטורי', 'מגה', 'טיב טעם', 'אושר עד', 'יינות ביתן', 'חצי חינם', 'מכולת', 'סופר', 'am:pm', 'am pm']],
    ['תחבורה', ['דלק', 'פז ', 'סונול', 'דור אלון', 'ten ', 'רב-קו', 'רב קו', 'חניה', 'חניון', 'פנגו', 'סלופארק', 'gett', 'yango', 'מונית', 'רכבת']],
    ['חשבונות', ['חשמל', 'מים', 'ארנונה', 'בזק', 'סלקום', 'פרטנר', 'הוט', 'yes', 'גולן', 'גז', 'עירייה', 'עיריית', 'ביטוח']],
    ['בילויים', ['נטפליקס', 'netflix', 'spotify', 'ספוטיפיי', 'סינמה', 'קולנוע', 'מסעדה', 'קפה', 'wolt', 'וולט', '10ביס', 'תן ביס']],
    ['דיור', ['שכר דירה', 'שכ"ד', 'משכנתא', 'ועד בית']],
  ],
  income: [
    ['משכורת', ['משכורת', 'שכר', 'salary']],
  ],
};

function guessCategory(description, type) {
  const text = description.toLowerCase();
  const rules = CATEGORY_KEYWORDS[type] || [];
  for (const rule of rules) {
    if (rule[1].some(function (word) { return text.includes(word); })) {
      return rule[0];
    }
  }
  return 'אחר';
}

// ===== בניית התצוגה =====

// ממלאת רשימת עמודות בכל אחת מרשימות הבחירה
function fillColumnSelects() {
  Object.values(mapSelects).forEach(function (select) {
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '-1';
    none.textContent = '— בחר עמודה —';
    select.appendChild(none);
    importHeaders.forEach(function (header, index) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = header;
      select.appendChild(option);
    });
  });
}

function applyMapping(mapping) {
  mapSelects.date.value = String(mapping.date);
  mapSelects.desc.value = String(mapping.desc);
  mapSelects.amount.value = String(mapping.amount);
  mapSelects.debit.value = String(mapping.debit);
  mapSelects.credit.value = String(mapping.credit);
  mapMode.value = mapping.mode;
}

function readMapping() {
  return {
    date: Number(mapSelects.date.value),
    desc: Number(mapSelects.desc.value),
    amount: Number(mapSelects.amount.value),
    debit: Number(mapSelects.debit.value),
    credit: Number(mapSelects.credit.value),
    mode: mapMode.value,
  };
}

// מפענחת את כל שורות הנתונים לפי ההתאמה הנוכחית
function computeParsed() {
  const map = readMapping();
  const split = map.mode === 'split';
  document.getElementById('map-amount-field').hidden = split;
  document.getElementById('map-debit-field').hidden = !split;
  document.getElementById('map-credit-field').hidden = !split;

  importParsed = [];
  importSkipped = 0;
  const dataRows = importRows.slice(importHeaderIndex + 1);

  dataRows.forEach(function (row) {
    if (row.every(function (cell) { return cleanCell(cell) === ''; })) {
      return; // שורה ריקה לגמרי – לא סופרים אותה
    }
    const date = map.date >= 0 ? parseImportDate(row[map.date]) : null;

    let value = null; // חיובי = הכנסה, שלילי = הוצאה
    if (split) {
      const debit = map.debit >= 0 ? parseImportAmount(row[map.debit]) : null;
      const credit = map.credit >= 0 ? parseImportAmount(row[map.credit]) : null;
      if (debit) {
        value = -Math.abs(debit);
      } else if (credit) {
        value = Math.abs(credit);
      }
    } else if (map.amount >= 0) {
      const amount = parseImportAmount(row[map.amount]);
      if (amount !== null) {
        value = map.mode === 'signed' ? amount : -amount;
      }
    }

    // שורה בלי תאריך תקין או בלי סכום – כנראה כותרת משנה או שורת סיכום
    if (!date || value === null || value === 0 || Math.abs(value) > MAX_IMPORT_AMOUNT) {
      importSkipped++;
      return;
    }

    const type = value < 0 ? 'expense' : 'income';
    const amount = Math.round(Math.abs(value) * 100) / 100;
    const description = (map.desc >= 0 ? cleanCell(row[map.desc]) : '').slice(0, 200) || 'ללא תיאור';

    // כפילות: אותה תנועה בדיוק כבר קיימת אצל המשתמש
    const duplicate = transactions.some(function (t) {
      return t.date === date && t.type === type && Math.abs(t.amount - amount) < 0.005 && t.description === description;
    });

    importParsed.push({
      date: date,
      description: description,
      amount: amount,
      type: type,
      category: guessCategory(description, type),
      include: !duplicate,
      duplicate: duplicate,
    });
  });
  renderImportPreview();
}

function updateImportSummary() {
  const selected = importParsed.filter(function (t) { return t.include; });
  const duplicates = importParsed.filter(function (t) { return t.duplicate; }).length;
  const incomeCount = importParsed.filter(function (t) { return t.type === 'income'; }).length;

  let text = 'נמצאו ' + importParsed.length + ' תנועות (' + incomeCount + ' הכנסות, ' +
    (importParsed.length - incomeCount) + ' הוצאות).';
  if (duplicates > 0) {
    text += ' ' + duplicates + ' כבר קיימות אצלך ולא סומנו.';
  }
  if (importSkipped > 0) {
    text += ' ' + importSkipped + ' שורות דולגו (כותרות, סיכומים או שורות בלי תאריך וסכום).';
  }
  if (importParsed.length === 0) {
    text = 'לא נמצאו תנועות. בדוק שבחרת את העמודות הנכונות למעלה.';
  }
  importSummary.textContent = text;
  importConfirmBtn.textContent = 'ייבא ' + selected.length + ' תנועות';
  importConfirmBtn.disabled = selected.length === 0;
  importSelectAll.checked = selected.length > 0 && selected.length === importParsed.length;
}

function renderImportPreview() {
  importPreviewBody.innerHTML = '';
  importParsed.forEach(function (t) {
    const row = document.createElement('tr');
    if (!t.include) {
      row.className = 'import-excluded';
    }

    const checkCell = document.createElement('td');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = t.include;
    check.setAttribute('aria-label', 'ייבא את ' + t.description);
    check.addEventListener('change', function () {
      t.include = check.checked;
      row.className = t.include ? '' : 'import-excluded';
      updateImportSummary();
    });
    checkCell.appendChild(check);

    const dateCell = document.createElement('td');
    dateCell.textContent = formatDate(t.date);

    const descCell = document.createElement('td');
    descCell.className = 'import-desc';
    descCell.textContent = t.description; // textContent – טקסט מהקובץ לעולם לא ירוץ כקוד
    if (t.duplicate) {
      descCell.appendChild(createEl('span', 'duplicate-badge', 'כבר קיימת'));
    }

    const amountCell = document.createElement('td');
    amountCell.className = 'amount ' + t.type;
    amountCell.textContent = (t.type === 'income' ? '+' : '-') + formatMoney(t.amount);

    const categoryCell = document.createElement('td');
    const select = document.createElement('select');
    categories[t.type].forEach(function (name) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    select.value = t.category;
    select.setAttribute('aria-label', 'קטגוריה עבור ' + t.description);
    select.addEventListener('change', function () {
      t.category = select.value;
    });
    categoryCell.appendChild(select);

    row.append(checkCell, dateCell, descCell, amountCell, categoryCell);
    importPreviewBody.appendChild(row);
  });
  updateImportSummary();
}

// ===== קריאת הקובץ =====

// קבצי CSV מבנקים בישראל מגיעים לפעמים בקידוד ישן (windows-1255) ולא ב-UTF-8
function decodeCsv(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch (error) {
    return new TextDecoder('windows-1255').decode(buffer);
  }
}

function showImportError(message) {
  importErrorBox.textContent = message;
  importErrorBox.hidden = false;
}

async function readImportFile(file) {
  importErrorBox.hidden = true;
  if (file.size > MAX_IMPORT_FILE_SIZE) {
    showImportError('הקובץ גדול מדי (יותר מ-10MB).');
    return;
  }

  importChooseBtn.disabled = true;
  importChooseBtn.textContent = '⏳ קורא את הקובץ…';
  try {
    const XLSX = await loadSheetJS();
    const buffer = await file.arrayBuffer();
    let workbook;
    if (/\.csv$/i.test(file.name)) {
      // raw: true – לא לתת לספרייה "לנחש" תאריכים בפורמט אמריקאי. אנחנו מפענחים בעצמנו
      workbook = XLSX.read(decodeCsv(buffer), { type: 'string', raw: true });
    } else {
      workbook = XLSX.read(buffer, { type: 'array' });
    }

    // הגיליון הראשון שיש בו נתונים
    let rows = [];
    for (const name of workbook.SheetNames) {
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '' });
      if (rows.length > 0) {
        break;
      }
    }
    if (rows.length === 0) {
      showImportError('הקובץ ריק.');
      return;
    }

    setupMapping(rows, file.name);
  } catch (error) {
    console.warn('שגיאה בקריאת הקובץ:', error);
    showImportError(error.message === 'sheetjs-load-failed'
      ? 'לא הצלחנו לטעון את כלי הקריאה של אקסל. בדוק את החיבור לאינטרנט ונסה שוב.'
      : 'לא הצלחנו לקרוא את הקובץ. ודא שזה קובץ אקסל או CSV.');
  } finally {
    importChooseBtn.disabled = false;
    importChooseBtn.textContent = 'בחר קובץ';
  }
}

function setupMapping(rows, fileName) {
  importRows = rows;
  importHeaderIndex = findHeaderRow(rows);

  const columnCount = Math.max.apply(null, rows.slice(0, 50).map(function (row) { return row.length; }));
  const headerRow = importHeaderIndex >= 0 ? rows[importHeaderIndex] : [];
  importHeaders = [];
  for (let i = 0; i < columnCount; i++) {
    importHeaders.push(cleanCell(headerRow[i]) || 'עמודה ' + (i + 1));
  }

  fillColumnSelects();
  // אם כבר ייבאת קובץ באותו מבנה – משתמשים בהתאמה ששמרת. אחרת – ניחוש
  const saved = loadSavedMappings()[getSignature()];
  const valid = saved && ['date', 'desc', 'amount', 'debit', 'credit'].every(function (key) {
    return Number.isInteger(saved[key]) && saved[key] >= -1 && saved[key] < importHeaders.length;
  }) && ['signed', 'expense-positive', 'split'].includes(saved.mode);
  applyMapping(valid ? saved : guessMapping());

  document.getElementById('import-file-name').textContent = fileName;
  importStepFile.hidden = true;
  importStepMap.hidden = false;
  importActions.hidden = false;
  computeParsed();
}

// ===== אירועים =====
function resetImport() {
  importRows = [];
  importParsed = [];
  importPreviewBody.innerHTML = '';
  importErrorBox.hidden = true;
  importStepFile.hidden = false;
  importStepMap.hidden = true;
  importActions.hidden = true;
}

function closeImportDialog() {
  importDialog.close();
  resetImport();
}

document.getElementById('open-import').addEventListener('click', function () {
  resetImport();
  importDialog.showModal();
});
importChooseBtn.addEventListener('click', function () {
  importFileField.click();
});
document.getElementById('import-other-file').addEventListener('click', function () {
  resetImport();
  importFileField.click();
});
importFileField.addEventListener('change', function () {
  const file = importFileField.files[0];
  importFileField.value = ''; // כדי שאפשר יהיה לבחור שוב את אותו קובץ
  if (file) {
    readImportFile(file);
  }
});

// כל שינוי בהתאמת העמודות – מפענחים מחדש
Object.values(mapSelects).concat([mapMode]).forEach(function (select) {
  select.addEventListener('change', computeParsed);
});

importSelectAll.addEventListener('change', function () {
  importParsed.forEach(function (t) {
    t.include = importSelectAll.checked;
  });
  renderImportPreview();
});

document.getElementById('import-close').addEventListener('click', closeImportDialog);
document.getElementById('import-cancel').addEventListener('click', closeImportDialog);
importDialog.addEventListener('cancel', function (event) {
  event.preventDefault();
  closeImportDialog();
});

importConfirmBtn.addEventListener('click', function () {
  const selected = importParsed.filter(function (t) { return t.include; });
  if (selected.length === 0) {
    return;
  }
  selected.forEach(function (t) {
    transactions.push({
      id: generateId(),
      type: t.type,
      description: t.description,
      amount: t.amount,
      category: t.category,
      date: t.date,
    });
  });
  saveMapping(readMapping()); // בפעם הבאה – אותה התאמה אוטומטית
  saveTransactions();
  render();
  closeImportDialog();
  showToast('📥 יובאו ' + selected.length + ' תנועות.');
});
