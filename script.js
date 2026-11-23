// ===== 1. נתונים ושמירה =====
// מאז המעבר לענן: הנתונים נשמרים ב-Firestore (דרך auth.js), לא בדפדפן.
// הפונקציות loadX() שקוראות מ-LocalStorage נשארו רק כדי להעביר נתונים ישנים לחשבון בכניסה הראשונה.

// "גשר" לענן: auth.js מכניס לכאן פונקציה ששומרת ב-Firestore, אחרי שהמשתמש מתחבר
let cloudSaver = null;
// האם הנתונים כבר נטענו מהענן (לפני כן לא מריצים תנועות קבועות ולא שומרים)
let dataReady = false;

// שולחת סוג נתונים אחד לענן ('transactions' / 'budgets' / 'recurring')
function saveToCloud(kind, value) {
  if (cloudSaver && dataReady) {
    cloudSaver(kind, value);
  }
}

// השם (המפתח) שתחתיו נשמרו הנתונים בדפדפן (לפני המעבר לענן)
const STORAGE_KEY = 'budget-transactions';

// נתוני ברירת המחדל – מה שמוצג כשאין עדיין שום דבר שמור (כרגע: רשימה ריקה)
const DEFAULT_TRANSACTIONS = [];

// טוענת את התנועות מה-LocalStorage
function loadTransactions() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY); // מחזיר טקסט, או null אם אין כלום
    if (saved === null) {
      return [...DEFAULT_TRANSACTIONS];
    }
    const parsed = JSON.parse(saved); // הופך את הטקסט בחזרה למערך
    return Array.isArray(parsed) ? parsed : [...DEFAULT_TRANSACTIONS];
  } catch (error) {
    // אם הנתונים פגומים או שהדפדפן חוסם אחסון – ממשיכים עם ברירת המחדל
    console.warn('לא ניתן לטעון נתונים שמורים:', error);
    return [...DEFAULT_TRANSACTIONS];
  }
}

// שומרת את כל התנועות – בענן
function saveTransactions() {
  saveToCloud('transactions', transactions);
}

// מערך (Array) שמחזיק את כל התנועות. כל תנועה היא אובייקט עם שדות.
// מתחיל ריק – הנתונים מגיעים מהענן אחרי ההתחברות
let transactions = [];

// קטגוריות לפי סוג התנועה
const categories = {
  income: ['משכורת', 'עבודה נוספת', 'מתנה', 'אחר'],
  expense: ['מזון', 'דיור', 'תחבורה', 'בילויים', 'חשבונות', 'בריאות', 'אחר'],
};

// ===== 2. הפניות לאלמנטים בדף =====
// document.getElementById מחפש אלמנט ב-HTML לפי ה-id שלו
const form = document.getElementById('transaction-form');
const descriptionInput = document.getElementById('description');
const amountInput = document.getElementById('amount');
const categorySelect = document.getElementById('category');
const dateInput = document.getElementById('date');
const typeRadios = document.querySelectorAll('input[name="type"]');
const tableBody = document.getElementById('transactions-body');
const emptyMessage = document.getElementById('empty-message');

// ===== 3. פונקציות עזר =====

// מעצבת מספר כסכום בשקלים, לדוגמה: 1234.5 → ₪1,234.50
function formatMoney(value) {
  return '₪' + value.toLocaleString('he-IL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// מעצבת תאריך מ-"2026-11-17" ל-"17/11/2026"
function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

// מחזירה את הסוג שנבחר כרגע: 'income' או 'expense'
function getSelectedType() {
  return document.querySelector('input[name="type"]:checked').value;
}

// ממלאת את רשימת הקטגוריות לפי הסוג שנבחר
function updateCategoryOptions() {
  const type = getSelectedType();
  categorySelect.innerHTML = '';
  categories[type].forEach(function (name) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    categorySelect.appendChild(option);
  });
}

// ===== 4. הצגת הנתונים במסך =====

// מחשבת ומציגה את סך ההכנסות, ההוצאות והיתרה – לפי התקופה שנבחרה למעלה
function renderSummary() {
  const period = getSelectedPeriod();
  let income = 0;
  let expense = 0;

  transactions.forEach(function (t) {
    if (!matchesPeriod(t, period)) {
      return; // תנועה מתקופה אחרת – מדלגים עליה
    }
    if (t.type === 'income') {
      income += t.amount;
    } else {
      expense += t.amount;
    }
  });

  // הכותרות של הכרטיסים מתאימות את עצמן לתקופה
  const all = isAllPeriod(period);
  document.querySelector('.card-income .card-label').textContent = all ? 'סך הכנסות' : 'הכנסות בחודש';
  document.querySelector('.card-expense .card-label').textContent = all ? 'סך הוצאות' : 'הוצאות בחודש';
  document.querySelector('.card-balance .card-label').textContent = all ? 'יתרה כוללת' : 'יתרה בחודש';

  const balance = income - expense;

  document.getElementById('total-income').textContent = formatMoney(income);
  document.getElementById('total-expense').textContent = formatMoney(expense);

  const balanceEl = document.getElementById('balance');
  balanceEl.textContent = (balance < 0 ? '-' : '') + formatMoney(Math.abs(balance));
  // יתרה שלילית תוצג באדום
  balanceEl.style.color = balance < 0 ? 'var(--expense)' : 'var(--text)';
}

// בונה מחדש את שורות הטבלה
function renderTable() {
  tableBody.innerHTML = '';

  // מציגים רק את התנועות שעוברות את הסינון (המערך המקורי לא משתנה)
  const visible = getFilteredTransactions();

  // מיון לפי תאריך – החדש ביותר למעלה
  const sorted = [...visible].sort(function (a, b) {
    return b.date.localeCompare(a.date);
  });

  sorted.forEach(function (t) {
    const row = document.createElement('tr');
    const sign = t.type === 'income' ? '+' : '-';

    // textContent (ולא innerHTML) לטקסט שהמשתמש הקליד – כך הוא מוצג כטקסט בלבד ולא כקוד
    const dateCell = document.createElement('td');
    dateCell.textContent = formatDate(t.date);

    const descCell = document.createElement('td');
    descCell.textContent = t.description;
    // תנועה שנוצרה אוטומטית מתנועה קבועה מקבלת סימון 🔁
    if (t.recurringId) {
      const mark = document.createElement('span');
      mark.className = 'recurring-mark';
      mark.textContent = '🔁';
      mark.title = 'נוספה אוטומטית מתנועה קבועה';
      descCell.appendChild(mark);
    }

    const catCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'category-badge';
    badge.textContent = t.category;
    catCell.appendChild(badge);

    const amountCell = document.createElement('td');
    amountCell.className = 'amount ' + t.type;
    amountCell.textContent = sign + formatMoney(t.amount);

    // כפתור מחיקה – לא מוחק מיד, אלא פותח חלון אישור
    const actionsCell = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = '🗑';
    deleteBtn.title = 'מחק תנועה';
    deleteBtn.setAttribute('aria-label', 'מחק את התנועה ' + t.description);
    deleteBtn.addEventListener('click', function () {
      askToDelete(t);
    });
    // כפתור עריכה – ממלא את הטופס בפרטי התנועה
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-edit';
    editBtn.textContent = '✏️';
    editBtn.title = 'ערוך תנועה';
    editBtn.setAttribute('aria-label', 'ערוך את התנועה ' + t.description);
    editBtn.addEventListener('click', function () {
      startEdit(t);
    });
    actionsCell.append(editBtn, deleteBtn);

    // השורה שנמצאת בעריכה מקבלת הדגשה
    if (t.id === editingId) {
      row.className = 'editing';
    }

    row.append(dateCell, descCell, catCell, amountCell, actionsCell);
    tableBody.appendChild(row);
  });

  // הודעה כשאין מה להציג – טקסט שונה אם אין תנועות בכלל או שהסינון לא מצא כלום
  if (transactions.length === 0) {
    emptyMessage.textContent = 'עדיין אין תנועות. הוסף את התנועה הראשונה שלך!';
    emptyMessage.style.display = 'block';
  } else if (visible.length === 0) {
    emptyMessage.textContent = 'לא נמצאו תנועות שמתאימות לסינון.';
    emptyMessage.style.display = 'block';
  } else {
    emptyMessage.style.display = 'none';
  }

  // מונה תוצאות, לדוגמה: "מוצגות 3 מתוך 10 תנועות"
  resultsCount.textContent = 'מוצגות ' + visible.length + ' מתוך ' + transactions.length + ' תנועות';
}

// מרעננת את כל המסך
function render() {
  updateMonthOptions(); // קודם מעדכנים את רשימת התקופות – כל השאר תלוי בה
  renderSummary();
  renderTable();
  renderCharts(); // הגרפים מתעדכנים יחד עם כל השאר
  renderBudgets(); // וגם התקציבים
  renderRecurring(); // וגם רשימת התנועות הקבועות
}

// ===== 5. חיפוש וסינון =====
const filterSearch = document.getElementById('filter-search');
const filterType = document.getElementById('filter-type');
const filterCategory = document.getElementById('filter-category');
const filterFrom = document.getElementById('filter-from');
const filterTo = document.getElementById('filter-to');
const resultsCount = document.getElementById('results-count');

// מחזירה מערך חדש עם התנועות שעוברות את כל המסננים יחד.
// חשוב: filter לא משנה את transactions – הוא יוצר מערך חדש.
function getFilteredTransactions() {
  const searchText = filterSearch.value.trim().toLowerCase();
  const type = filterType.value;
  const category = filterCategory.value;
  const from = filterFrom.value; // "" אם לא נבחר תאריך
  const to = filterTo.value;

  return transactions.filter(function (t) {
    // כל תנאי שלא מתקיים – מחזיר false והתנועה לא תוצג

    // 1. חיפוש: האם התיאור מכיל את הטקסט שהוקלד?
    if (searchText !== '' && !t.description.toLowerCase().includes(searchText)) {
      return false;
    }
    // 2. סוג
    if (type !== 'all' && t.type !== type) {
      return false;
    }
    // 3. קטגוריה
    if (category !== 'all' && t.category !== category) {
      return false;
    }
    // 4. טווח תאריכים (תאריכים בפורמט YYYY-MM-DD אפשר להשוות כמו טקסט)
    if (from !== '' && t.date < from) {
      return false;
    }
    if (to !== '' && t.date > to) {
      return false;
    }
    // עברה את כל התנאים – מציגים אותה
    return true;
  });
}

// ממלאת את רשימת הקטגוריות בסינון לפי הסוג שנבחר
function updateFilterCategoryOptions() {
  const previous = filterCategory.value;
  const type = filterType.value;

  let list;
  if (type === 'all') {
    // כל הקטגוריות משני הסוגים, בלי כפילויות ("אחר" מופיע בשניהם)
    list = [...new Set([...categories.income, ...categories.expense])];
  } else {
    list = categories[type];
  }

  filterCategory.innerHTML = '';
  ['all', ...list].forEach(function (name) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name === 'all' ? 'כל הקטגוריות' : name;
    filterCategory.appendChild(option);
  });

  // אם הקטגוריה שנבחרה קודם עדיין קיימת – משאירים אותה
  filterCategory.value = list.includes(previous) ? previous : 'all';
}

// כל שינוי בשדה סינון – מציג מחדש את הטבלה
filterSearch.addEventListener('input', renderTable);
filterCategory.addEventListener('change', renderTable);
filterFrom.addEventListener('change', renderTable);
filterTo.addEventListener('change', renderTable);
filterType.addEventListener('change', function () {
  updateFilterCategoryOptions();
  renderTable();
});

// כפתור איפוס – מנקה את כל המסננים
document.getElementById('filter-reset').addEventListener('click', function () {
  filterSearch.value = '';
  filterType.value = 'all';
  filterFrom.value = '';
  filterTo.value = '';
  updateFilterCategoryOptions();
  filterCategory.value = 'all';
  renderTable();
});

// ===== 6. מחיקה עם אישור =====
// חלון האישור משמש גם למחיקת תנועה וגם למחיקת תנועה קבועה.
const confirmDialog = document.getElementById('confirm-dialog');
const confirmText = document.getElementById('confirm-text');

// הפעולה שתתבצע אם המשתמש יאשר (פונקציה ששמורה במשתנה)
let pendingConfirmAction = null;
// הפעולה שתתבצע אם המשתמש יבטל (לא חובה)
let pendingCancelAction = null;

// פותחת את חלון האישור עם כותרת, טקסט והפעולה לביצוע
function askConfirm(options) {
  document.getElementById('confirm-title').textContent = options.title;
  // תחילת המשפט (ברירת מחדל: "האם למחוק את")
  document.getElementById('confirm-prefix').textContent = options.prefix || 'האם למחוק את';
  document.getElementById('confirm-kind').textContent = options.kind;
  confirmText.textContent = options.text;
  document.getElementById('confirm-note').textContent = options.note;
  // הכיתוב של כפתור האישור (ברירת מחדל: "מחק")
  document.getElementById('confirm-delete').textContent = options.confirmLabel || 'מחק';
  pendingConfirmAction = options.action;
  pendingCancelAction = options.onCancel || null;
  confirmDialog.showModal(); // showModal חוסם את שאר הדף עד שסוגרים את החלון
}

// פותחת את חלון האישור עבור תנועה מסוימת
function askToDelete(transaction) {
  askConfirm({
    title: 'מחיקת תנועה',
    kind: 'התנועה',
    text: '"' + transaction.description + '" (' + formatMoney(transaction.amount) + ')',
    note: 'אי אפשר לבטל את הפעולה הזו.',
    action: function () {
      deleteTransaction(transaction.id);
    },
  });
}

// מוחקת בפועל: filter יוצר מערך חדש בלי התנועה עם ה-id הזה
function deleteTransaction(id) {
  // אם מוחקים את התנועה שנמצאת בעריכה – מבטלים את העריכה
  if (id === editingId) {
    exitEditMode();
  }
  transactions = transactions.filter(function (t) {
    return t.id !== id;
  });
  saveTransactions(); // מעדכנים גם את הנתונים השמורים
  render();
}

// סוגרת את החלון ומריצה את הפעולה המתאימה: אישור או ביטול.
// מטפלים בזה ישירות בלחיצה (ולא באירוע close), כי close מגיע באיחור ולא בכל דפדפן באופן אמין.
function finishConfirm(confirmed) {
  const action = confirmed ? pendingConfirmAction : pendingCancelAction;
  pendingConfirmAction = null;
  pendingCancelAction = null;
  confirmDialog.close();
  if (action) {
    action();
  }
}

document.getElementById('confirm-delete').addEventListener('click', function () {
  finishConfirm(true);
});

document.getElementById('cancel-delete').addEventListener('click', function () {
  finishConfirm(false);
});

// מקש Esc: אירוע cancel מגיע לפני שהדפדפן סוגר את החלון – מטפלים בו כמו בכפתור "ביטול"
confirmDialog.addEventListener('cancel', function (event) {
  event.preventDefault();
  finishConfirm(false);
});

// ===== 6.5 עריכת תנועה =====
// הטופס עובד בשני מצבים:
//   editingId === null → מצב הוספה (כמו תמיד)
//   editingId === 'id כלשהו' → מצב עריכה של התנועה הזו
let editingId = null;

const formTitle = document.getElementById('form-title');
const submitBtn = document.getElementById('submit-btn');
const cancelEditBtn = document.getElementById('cancel-edit'); // כפתור "ביטול" בחלון
const transactionDialog = document.getElementById('transaction-dialog'); // החלון שמכיל את הטופס

// תאריך היום בפורמט YYYY-MM-DD
function getTodayString() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

// נכנסים למצב עריכה: ממלאים את הטופס בפרטי התנועה
function startEdit(transaction) {
  editingId = transaction.id;

  // 1. סוג – מסמנים את כפתור הרדיו המתאים ומעדכנים את רשימת הקטגוריות
  document.getElementById('type-' + transaction.type).checked = true;
  updateCategoryOptions();

  // אם הקטגוריה לא קיימת ברשימה (למשל מנתונים ישנים) – מוסיפים אותה זמנית
  if (!categories[transaction.type].includes(transaction.category)) {
    const option = document.createElement('option');
    option.value = transaction.category;
    option.textContent = transaction.category;
    categorySelect.appendChild(option);
  }

  // 2. שאר השדות
  descriptionInput.value = transaction.description;
  amountInput.value = transaction.amount;
  categorySelect.value = transaction.category;
  dateInput.value = transaction.date;

  // 3. הממשק משתנה למצב עריכה (אפשרות "תנועה קבועה" לא רלוונטית לעריכה)
  isRecurringInput.checked = false;
  recurringOption.hidden = true;
  updateRecurringHint();
  formTitle.textContent = 'עריכת תנועה';
  submitBtn.textContent = 'שמור שינויים';

  renderTable(); // כדי להדגיש את השורה שבעריכה

  // פותחים את החלון עם הטופס המלא
  transactionDialog.showModal();
  descriptionInput.focus();
}

// יוצאים ממצב עריכה וחוזרים לטופס הוספה ריק
function exitEditMode() {
  editingId = null;
  formTitle.textContent = 'הוספת תנועה';
  submitBtn.textContent = 'הוסף תנועה';

  descriptionInput.value = '';
  amountInput.value = '';
  dateInput.value = getTodayString();
  updateCategoryOptions();

  // אפשרות "תנועה קבועה" חוזרת להופיע, לא מסומנת
  isRecurringInput.checked = false;
  recurringOption.hidden = false;
  updateRecurringHint();
}

// שומרת את השינויים בתנועה שבעריכה
function saveEdit() {
  // findIndex מחזיר את המיקום של התנועה במערך (או 1- אם לא נמצאה)
  const index = transactions.findIndex(function (t) {
    return t.id === editingId;
  });

  if (index !== -1) {
    // מחליפים את התנועה באובייקט חדש עם אותו id והפרטים המעודכנים.
    // ...transactions[index] מעתיק קודם את כל השדות הקיימים (למשל recurringId),
    // והשדות שאחריו דורסים רק את מה שנערך בטופס.
    transactions[index] = {
      ...transactions[index],
      id: editingId,
      type: getSelectedType(),
      description: descriptionInput.value.trim(),
      amount: parseFloat(amountInput.value),
      category: categorySelect.value,
      date: dateInput.value,
    };
    saveTransactions();
  }

  exitEditMode();
  render();
}

// פותחת את החלון להוספת תנועה חדשה, עם הסוג שנבחר (הכנסה/הוצאה).
// recurring = true → תיבת "תנועה קבועה" כבר מסומנת
function openAddDialog(type, recurring) {
  exitEditMode(); // מתחילים מטופס ריק
  document.getElementById('type-' + type).checked = true;
  updateCategoryOptions();
  isRecurringInput.checked = recurring === true;
  updateRecurringHint();
  transactionDialog.showModal();
  descriptionInput.focus();
}

document.getElementById('add-income').addEventListener('click', function () {
  openAddDialog('income');
});
document.getElementById('add-expense').addEventListener('click', function () {
  openAddDialog('expense');
});

// סוגרת את החלון בלי לשמור. אם היינו בעריכה – מבטלים אותה מיד ומסירים את ההדגשה
function closeTransactionDialog() {
  if (editingId !== null) {
    exitEditMode();
    renderTable();
  }
  transactionDialog.close();
}

// "ביטול" ו-✕ סוגרים את החלון בלי לשמור
cancelEditBtn.addEventListener('click', closeTransactionDialog);
document.getElementById('close-dialog').addEventListener('click', closeTransactionDialog);

// מקש Esc: הדפדפן סוגר את החלון בעצמו, ואירוע cancel מגיע לפני הסגירה – כאן מבטלים את העריכה
transactionDialog.addEventListener('cancel', function () {
  if (editingId !== null) {
    exitEditMode();
    renderTable();
  }
});

// ===== 7. אירועים (Events) – תגובה לפעולות המשתמש =====

// כשמשנים בין הכנסה להוצאה – מעדכנים את הקטגוריות
typeRadios.forEach(function (radio) {
  radio.addEventListener('change', updateCategoryOptions);
});

// כששולחים את הטופס
form.addEventListener('submit', function (event) {
  // מונע מהדפדפן לרענן את הדף (זו ההתנהגות הרגילה של טופס)
  event.preventDefault();

  // במצב עריכה – מעדכנים את התנועה הקיימת במקום ליצור חדשה
  if (editingId !== null) {
    saveEdit();
    transactionDialog.close();
    return;
  }

  // תיבת "תנועה קבועה" מסומנת – יוצרים תנועה קבועה במקום תנועה רגילה
  if (isRecurringInput.checked) {
    if (createRecurringFromForm()) {
      transactionDialog.close();
    }
    return;
  }

  const transaction = {
    // מזהה ייחודי: הזמן הנוכחי + תווים אקראיים (כדי ששתי תנועות לא יקבלו אותו מזהה)
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    type: getSelectedType(),
    description: descriptionInput.value.trim(),
    amount: parseFloat(amountInput.value),
    category: categorySelect.value,
    date: dateInput.value,
  };

  transactions.push(transaction);
  saveTransactions(); // שמירה אוטומטית
  render();

  // סוגרים את החלון – התנועה כבר מופיעה בטבלה
  transactionDialog.close();
});

// ===== 8. גרפים וניתוח נתונים =====
// הגרפים מבוססים על כל התנועות (לא מושפעים מהסינון של הטבלה), לפי החודש שנבחר.
const chartMonth = document.getElementById('chart-month');
const MONTHS_IN_CHART = 6; // כמה חודשים מוצגים בגרף העמודות

// יוצרת אלמנט HTML עם class וטקסט – חוסכת שורות חוזרות
function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// "2026-11-05" → "2026-11" (מפתח החודש)
function getMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}

// מפתח החודש הנוכחי, לדוגמה "2026-11"
function getCurrentMonthKey() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

// "2026-11" → "נובמבר 2026"
function formatMonthLong(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

// "2026-11" → "נוב׳"
function formatMonthShort(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('he-IL', { month: 'short' });
}

// סכום מעוגל בלי אגורות, לתוויות בגרף: 1234.5 → "₪1,235"
function formatShortMoney(value) {
  return '₪' + Math.round(value).toLocaleString('he-IL');
}

// מחזירה רשימה של מפתחות חודשים שמסתיימת בחודש הנתון.
// לדוגמה: ("2026-11", 3) → ["2026-09", "2026-10", "2026-11"]
function getPreviousMonths(key, count) {
  const [year, month] = key.split('-').map(Number);
  const result = [];
  for (let i = count - 1; i >= 0; i--) {
    // Date מסדר לבד מעבר שנה: חודש 0- הופך לדצמבר של השנה הקודמת
    const d = new Date(year, month - 1 - i, 1);
    result.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  return result;
}

// ----- תקופה: חודש מסוים או "כל התקופה" -----
const ALL_PERIOD = 'all';         // הערך של האפשרות "כל התקופה"
const MONTHS_IN_ALL_CHART = 12;   // בתצוגת "כל התקופה" – כמה חודשים אחרונים בגרף העמודות

function isAllPeriod(key) {
  return key === ALL_PERIOD;
}

// התקופה שנבחרה כרגע (לפני שהרשימה מתמלאת – החודש הנוכחי)
function getSelectedPeriod() {
  return chartMonth.value || getCurrentMonthKey();
}

// "2026-11" → "נובמבר 2026", ו-"all" → "כל התקופה"
function formatPeriod(key) {
  return isAllPeriod(key) ? 'כל התקופה' : formatMonthLong(key);
}

// האם תנועה שייכת לתקופה? ב"כל התקופה" – כל תנועה שייכת
function matchesPeriod(transaction, key) {
  return isAllPeriod(key) || getMonthKey(transaction.date) === key;
}

// כל החודשים שיש בהם תנועות + החודש הנוכחי, ממוינים מהישן לחדש
function getAllMonthKeys() {
  // Set שומר כל ערך פעם אחת בלבד – כך אין חודשים כפולים
  const monthSet = new Set(transactions.map(function (t) {
    return getMonthKey(t.date);
  }));
  monthSet.add(getCurrentMonthKey());
  return [...monthSet].sort();
}

// סכום ההכנסות וההוצאות בתקופה (חודש מסוים או כל התקופה)
function getMonthTotals(key) {
  const totals = { income: 0, expense: 0 };
  transactions.forEach(function (t) {
    if (matchesPeriod(t, key)) {
      totals[t.type] += t.amount;
    }
  });
  return totals;
}

// ממלאת את רשימת התקופות: "כל התקופה" + כל חודש שיש בו תנועות + החודש הנוכחי
function updateMonthOptions() {
  const previous = chartMonth.value;
  const current = getCurrentMonthKey();

  // מיון מהחדש לישן
  const months = getAllMonthKeys().reverse();

  chartMonth.innerHTML = '';
  [ALL_PERIOD, ...months].forEach(function (key) {
    const option = createEl('option', null, formatPeriod(key));
    option.value = key;
    chartMonth.appendChild(option);
  });

  // אם התקופה שנבחרה קודם עדיין ברשימה – נשארים עליה, אחרת חוזרים לחודש הנוכחי
  chartMonth.value = (previous === ALL_PERIOD || months.includes(previous)) ? previous : current;
}

// גרף 1: עמודות הכנסות מול הוצאות
// חודש מסוים → 6 החודשים שמסתיימים בו. "כל התקופה" → עד 12 החודשים האחרונים שיש בהם נתונים
function renderIncomeExpenseChart(selectedKey) {
  const container = document.getElementById('income-expense-chart');
  container.innerHTML = '';

  let monthKeys;
  if (isAllPeriod(selectedKey)) {
    const allMonths = getAllMonthKeys();
    const first = allMonths[0];
    const last = allMonths[allMonths.length - 1];
    // כמה חודשים יש מהחודש הראשון עד האחרון (כולל חודשים ריקים באמצע)
    const [y1, m1] = first.split('-').map(Number);
    const [y2, m2] = last.split('-').map(Number);
    const span = (y2 - y1) * 12 + (m2 - m1) + 1;
    // לפחות 6 עמודות (כדי שהגרף לא ייראה ריק) ולכל היותר 12 (כדי שיהיה קריא)
    const count = Math.min(Math.max(span, MONTHS_IN_CHART), MONTHS_IN_ALL_CHART);
    monthKeys = getPreviousMonths(last, count);
    document.getElementById('bars-subtitle').textContent =
      'כל התקופה – ' + monthKeys.length + ' החודשים האחרונים';
  } else {
    monthKeys = getPreviousMonths(selectedKey, MONTHS_IN_CHART);
    document.getElementById('bars-subtitle').textContent =
      MONTHS_IN_CHART + ' החודשים שמסתיימים ב' + formatMonthLong(selectedKey);
  }

  // map הופך כל מפתח חודש לאובייקט עם הסכומים שלו
  const data = monthKeys.map(function (key) {
    const totals = getMonthTotals(key);
    return { key: key, income: totals.income, expense: totals.expense };
  });

  // הערך הגבוה ביותר קובע את גובה ה-100%
  const max = Math.max(...data.map(function (d) {
    return Math.max(d.income, d.expense);
  }));

  if (max === 0) {
    container.appendChild(createEl('p', 'chart-empty', 'אין תנועות בתקופה הזו.'));
    return;
  }

  const plot = createEl('div', 'bar-plot');

  // קווי רשת: 0, חצי ומקסימום
  [0, 0.5, 1].forEach(function (fraction) {
    const line = createEl('div', 'gridline');
    line.style.bottom = (fraction * 100) + '%';
    line.appendChild(createEl('span', null, formatShortMoney(max * fraction)));
    plot.appendChild(line);
  });

  const labels = createEl('div', 'bar-labels');

  data.forEach(function (d) {
    const isSelected = d.key === selectedKey;
    const group = createEl('div', 'bar-group' + (isSelected ? ' selected' : ''));

    // חלון מידע שמופיע במעבר עכבר + תיאור לקוראי מסך
    const info = formatMonthLong(d.key) +
      '\nהכנסות: ' + formatMoney(d.income) +
      '\nהוצאות: ' + formatMoney(d.expense);
    group.title = info;
    group.tabIndex = 0;
    group.setAttribute('aria-label', info.replace(/\n/g, ', '));

    // גובה כל עמודה = אחוז מהערך הגבוה ביותר
    const incomeBar = createEl('div', 'bar income');
    incomeBar.style.height = (d.income / max * 100) + '%';
    const expenseBar = createEl('div', 'bar expense');
    expenseBar.style.height = (d.expense / max * 100) + '%';

    group.append(incomeBar, expenseBar);
    plot.appendChild(group);

    labels.appendChild(createEl('span', isSelected ? 'selected' : null, formatMonthShort(d.key)));
  });

  container.append(plot, labels);
}

// סיכום מספרי של החודש הנבחר (מתחת לגרף העמודות)
function renderMonthStats(selectedKey) {
  const container = document.getElementById('month-stats');
  container.innerHTML = '';
  const totals = getMonthTotals(selectedKey);
  const diff = totals.income - totals.expense;
  const all = isAllPeriod(selectedKey);

  const items = [
    [all ? 'סך הכנסות' : 'הכנסות בחודש', formatMoney(totals.income)],
    [all ? 'סך הוצאות' : 'הוצאות בחודש', formatMoney(totals.expense)],
    ['הפרש', (diff < 0 ? '-' : '') + formatMoney(Math.abs(diff))],
  ];
  items.forEach(function (item) {
    const box = createEl('div', 'month-stat', item[0]);
    box.appendChild(createEl('strong', null, item[1]));
    container.appendChild(box);
  });
}

// גרף 2: התפלגות ההוצאות לפי קטגוריה בחודש הנבחר
function renderCategoryChart(selectedKey) {
  const container = document.getElementById('category-chart');
  container.innerHTML = '';
  document.getElementById('categories-subtitle').textContent = formatPeriod(selectedKey);

  // אובייקט שסוכם לכל קטגוריה את ההוצאות שלה: { "מזון": 600, "דלק": 300 }
  const byCategory = {};
  transactions.forEach(function (t) {
    if (t.type === 'expense' && matchesPeriod(t, selectedKey)) {
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    }
  });

  // הופכים לרשימה של זוגות [קטגוריה, סכום] וממיינים מהגדול לקטן
  const entries = Object.entries(byCategory).sort(function (a, b) {
    return b[1] - a[1];
  });

  if (entries.length === 0) {
    container.appendChild(createEl('p', 'chart-empty',
      isAllPeriod(selectedKey) ? 'עדיין אין הוצאות.' : 'אין הוצאות בחודש הזה.'));
    return;
  }

  const total = entries.reduce(function (sum, entry) {
    return sum + entry[1];
  }, 0);
  const max = entries[0][1]; // אחרי המיון – הראשון הוא הגדול ביותר

  const list = createEl('div', 'category-list');
  entries.forEach(function (entry) {
    const name = entry[0];
    const amount = entry[1];
    const percent = Math.round(amount / total * 100);

    const row = createEl('div', 'cat-row');
    row.title = name + ': ' + formatMoney(amount) + ' (' + percent + '% מההוצאות)';

    const track = createEl('div', 'cat-track');
    const bar = createEl('div', 'cat-bar');
    bar.style.width = (amount / max * 100) + '%';
    track.appendChild(bar);

    const value = createEl('span', 'cat-value', formatShortMoney(amount) + ' ');
    value.appendChild(createEl('small', null, percent + '%'));

    row.append(createEl('span', null, name), track, value);
    list.appendChild(row);
  });

  const totalRow = createEl('div', 'cat-total', isAllPeriod(selectedKey) ? 'סך כל ההוצאות' : 'סך הוצאות בחודש');
  totalRow.appendChild(createEl('strong', null, formatMoney(total)));

  container.append(list, totalRow);
}

// מרעננת את כל אזור הגרפים
function renderCharts() {
  updateMonthOptions();
  const selectedKey = chartMonth.value;
  renderIncomeExpenseChart(selectedKey);
  renderMonthStats(selectedKey);
  renderCategoryChart(selectedKey);
}

// בחירת תקופה אחרת – מעדכנים את הגרפים ואת כרטיסי הסיכום למעלה
chartMonth.addEventListener('change', renderCharts);
chartMonth.addEventListener('change', renderSummary);

// ===== 9. תקציב חודשי לפי קטגוריה =====
// התקציבים נשמרים בנפרד מהתנועות, תחת מפתח משלהם.
// מבנה: { "מזון": 3000, "דיור": 4500 } – סכום חודשי לכל קטגוריית הוצאה.
const BUDGETS_KEY = 'budget-category-limits';
const WARNING_PERCENT = 80; // מאיזה אחוז מציגים אזהרה

// טקסט הסטטוס – תמיד עם אייקון, כדי שהמידע לא יועבר רק בצבע
const BUDGET_STATUS_TEXT = {
  none: 'לא הוגדר תקציב',
  ok: '✓ בתקציב',
  warning: '⚠ מתקרב לתקציב',
  over: '⛔ חריגה מהתקציב',
};

// טוענת את התקציבים מה-LocalStorage
function loadBudgets() {
  try {
    const saved = localStorage.getItem(BUDGETS_KEY);
    if (saved === null) {
      return {};
    }
    const parsed = JSON.parse(saved);
    // בודקים שזה אובייקט רגיל (לא null ולא מערך)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch (error) {
    console.warn('לא ניתן לטעון תקציבים שמורים:', error);
    return {};
  }
}

// שומרת את התקציבים – בענן
function saveBudgets() {
  saveToCloud('budgets', budgets);
}

let budgets = {}; // מגיע מהענן אחרי ההתחברות

// מעדכנת תקציב של קטגוריה אחת. ערך ריק או 0 = מחיקת התקציב
function setBudget(category, value) {
  const amount = parseFloat(value);
  if (isNaN(amount) || amount <= 0) {
    delete budgets[category];
  } else {
    budgets[category] = amount;
  }
  saveBudgets();
  renderBudgets();
}

// סכום ההוצאות לכל קטגוריה בחודש מסוים: { "מזון": 2700, ... }
function getExpensesByCategory(key) {
  const result = {};
  transactions.forEach(function (t) {
    if (t.type === 'expense' && getMonthKey(t.date) === key) {
      result[t.category] = (result[t.category] || 0) + t.amount;
    }
  });
  return result;
}

// מחזירה את מצב התקציב: 'none' / 'ok' / 'warning' / 'over'
function getBudgetStatus(spent, limit) {
  if (!limit) {
    return 'none';
  }
  const percent = spent / limit * 100;
  if (percent > 100) {
    return 'over';
  }
  if (percent >= WARNING_PERCENT) {
    return 'warning';
  }
  return 'ok';
}

// סיכום כללי בראש האזור: סך התקציב, כמה נוצל, כמה נשאר
function renderBudgetOverview(spentByCategory) {
  const container = document.getElementById('budget-overview');
  container.innerHTML = '';

  // רק קטגוריות הוצאה שיש להן תקציב
  const budgeted = categories.expense.filter(function (name) {
    return budgets[name] > 0;
  });

  if (budgeted.length === 0) {
    container.className = 'budget-overview empty';
    container.textContent = 'עוד לא הגדרת תקציב. הקלד סכום ליד קטגוריה כדי להתחיל.';
    return;
  }
  container.className = 'budget-overview';

  let totalLimit = 0;
  let totalSpent = 0;
  budgeted.forEach(function (name) {
    totalLimit += budgets[name];
    totalSpent += spentByCategory[name] || 0;
  });
  const remaining = totalLimit - totalSpent;
  const percent = Math.round(totalSpent / totalLimit * 100);

  const items = [
    ['סך התקציב', formatMoney(totalLimit)],
    ['נוצל', formatMoney(totalSpent) + ' (' + percent + '%)'],
    remaining >= 0
      ? ['נשאר', formatMoney(remaining)]
      : ['חריגה כוללת', formatMoney(-remaining)],
  ];
  items.forEach(function (item) {
    const box = createEl('div', 'month-stat', item[0]);
    box.appendChild(createEl('strong', null, item[1]));
    container.appendChild(box);
  });
}

// בונה כרטיס תקציב לכל קטגוריית הוצאה
function renderBudgets() {
  // התקציב הוא חודשי – ב"כל התקופה" מציגים את החודש הנוכחי
  const selected = getSelectedPeriod();
  const key = isAllPeriod(selected) ? getCurrentMonthKey() : selected;
  document.getElementById('budgets-subtitle').textContent = isAllPeriod(selected)
    ? 'התקציב הוא חודשי, ולכן מוצג החודש הנוכחי (' + formatMonthLong(key) + '). לחודש אחר – בחר אותו ב"תקופה" למעלה.'
    : 'ההוצאות של ' + formatMonthLong(key) + '. התקציב חל על כל חודש.';

  const spentByCategory = getExpensesByCategory(key);
  renderBudgetOverview(spentByCategory);

  const list = document.getElementById('budget-list');
  list.innerHTML = '';

  categories.expense.forEach(function (name) {
    const limit = budgets[name] || 0;
    const spent = spentByCategory[name] || 0;
    const status = getBudgetStatus(spent, limit);
    const percent = limit ? Math.round(spent / limit * 100) : 0;

    const row = createEl('div', 'budget-row status-' + status);

    // שורה עליונה: שם הקטגוריה + תווית סטטוס
    const top = createEl('div', 'budget-top');
    top.append(
      createEl('span', 'budget-name', name),
      createEl('span', 'budget-status', BUDGET_STATUS_TEXT[status])
    );

    // פס התקדמות – לא עובר את 100% גם בחריגה
    const track = createEl('div', 'budget-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'ניצול התקציב של ' + name);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.min(percent, 100)));
    const fill = createEl('div', 'budget-fill');
    fill.style.width = Math.min(percent, 100) + '%';
    track.appendChild(fill);

    // שורה תחתונה: כמה הוצאת מתוך כמה + שדה להגדרת התקציב
    const bottom = createEl('div', 'budget-bottom');
    const spentText = createEl('span', 'budget-spent');
    spentText.appendChild(createEl('strong', null, formatShortMoney(spent)));
    if (limit) {
      spentText.append(' מתוך ' + formatShortMoney(limit) + ' · ');
      spentText.appendChild(createEl('strong', null, percent + '%'));
    } else {
      spentText.append(' הוצאות החודש');
    }

    const inputLabel = createEl('label', 'budget-input', 'תקציב:');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '10';
    input.placeholder = '₪';
    input.value = limit ? limit : '';
    input.setAttribute('aria-label', 'תקציב חודשי עבור ' + name);
    // change קורה כשמסיימים להקליד (Enter או יציאה מהשדה) – אז שומרים
    input.addEventListener('change', function () {
      setBudget(name, input.value);
    });
    inputLabel.appendChild(input);

    bottom.append(spentText, inputLabel);
    row.append(top, track, bottom);
    list.appendChild(row);
  });
}

// בחירת חודש אחר באזור הגרפים – מעדכנת גם את התקציבים
chartMonth.addEventListener('change', renderBudgets);

// ===== 9.5 לשוניות (Tabs) =====
const TAB_KEY = 'budget-active-tab'; // זוכרים את הלשונית האחרונה (נוחות בלבד)
const tabButtons = document.querySelectorAll('.tab');

// מציגה לשונית אחת ומסתירה את השאר
function showTab(name) {
  tabButtons.forEach(function (btn) {
    const isActive = btn.dataset.tab === name; // data-tab ב-HTML → dataset.tab ב-JS
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.tabIndex = isActive ? 0 : -1;
    document.getElementById('tab-' + btn.dataset.tab).hidden = !isActive;
  });

  try {
    localStorage.setItem(TAB_KEY, name);
  } catch (error) {
    // אם האחסון חסום – פשוט לא זוכרים, הכול ממשיך לעבוד
  }
}

tabButtons.forEach(function (btn) {
  btn.addEventListener('click', function () {
    showTab(btn.dataset.tab);
  });
});

// ניווט במקלדת: חצים ימינה/שמאלה עוברים בין הלשוניות (בעברית ← הוא "הבא")
document.querySelector('.tabs').addEventListener('keydown', function (event) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
    return;
  }
  const list = [...tabButtons];
  const current = list.indexOf(document.activeElement);
  if (current === -1) {
    return;
  }
  const step = event.key === 'ArrowLeft' ? 1 : -1;
  const next = list[(current + step + list.length) % list.length];
  showTab(next.dataset.tab);
  next.focus();
});

// הלשונית שנפתחת בהתחלה: האחרונה שנבחרה, או "תנועות"
function getSavedTab() {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved === 'transactions' || saved === 'charts' || saved === 'budget' || saved === 'recurring') {
      return saved;
    }
  } catch (error) {
    // מתעלמים
  }
  return 'transactions';
}

// ===== 9.7 תנועות קבועות =====
// "חוק" (rule) לכל תנועה קבועה, למשל: משכורת 12,000 ₪ ב-10 לכל חודש.
// כשהאפליקציה נפתחת, היא בודקת לכל חוק אם הגיע מועד – ואם כן, מוסיפה תנועה רגילה.
// מבנה חוק:
// { id, type, description, amount, category,
//   day: 10,                  ← יום בחודש
//   startDate: '2026-11-10',  ← מתי מתחילים
//   active: true,             ← פעיל או מושהה
//   lastMonth: '2026-11' }    ← החודש האחרון שכבר טופל (כדי לא להוסיף פעמיים)
const RECURRING_KEY = 'budget-recurring';
const MAX_BACKFILL_MONTHS = 24; // לא מאפשרים להתחיל יותר משנתיים אחורה

const isRecurringInput = document.getElementById('is-recurring');
const recurringOption = document.getElementById('recurring-option');
const recurringHint = document.getElementById('recurring-hint');
const dateLabel = document.getElementById('date-label');
const toastEl = document.getElementById('toast');

function loadRules() {
  try {
    const saved = localStorage.getItem(RECURRING_KEY);
    if (saved === null) {
      return [];
    }
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('לא ניתן לטעון תנועות קבועות:', error);
    return [];
  }
}

// שומרת את התנועות הקבועות – בענן
function saveRules() {
  saveToCloud('recurring', rules);
}

let rules = []; // מגיע מהענן אחרי ההתחברות

// מזהה ייחודי (אותה שיטה כמו בתנועות)
function generateId() {
  return Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

// "2026-11" + 2 → "2027-01"
function addMonths(monthKey, count) {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(year, month - 1 + count, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// התאריך של החוק בחודש מסוים. יום 31 בחודש קצר → היום האחרון של החודש
function getRuleDate(monthKey, day) {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate(); // יום 0 של החודש הבא = היום האחרון של החודש הזה
  return monthKey + '-' + String(Math.min(day, lastDay)).padStart(2, '0');
}

// הלב של המערכת: מוסיפה את כל התנועות הקבועות שהגיע זמנן. מחזירה כמה נוספו
function processRecurring() {
  const todayStr = getTodayString();
  const currentMonth = todayStr.slice(0, 7);
  let added = 0;
  let rulesChanged = false; // שומרים בענן רק אם באמת משהו השתנה

  rules.forEach(function (rule) {
    if (!rule.active) {
      return;
    }
    // מתחילים מהחודש שאחרי האחרון שטופל (או מחודש ההתחלה)
    let month = rule.lastMonth ? addMonths(rule.lastMonth, 1) : rule.startDate.slice(0, 7);

    while (month <= currentMonth) {
      const date = getRuleDate(month, rule.day);
      if (date > todayStr) {
        break; // היום בחודש עוד לא הגיע – ננסה שוב בפעם הבאה
      }
      if (date >= rule.startDate) {
        transactions.push({
          id: generateId(),
          type: rule.type,
          description: rule.description,
          amount: rule.amount,
          category: rule.category,
          date: date,
          recurringId: rule.id, // כדי לדעת שהתנועה נוצרה אוטומטית
        });
        added++;
      }
      rule.lastMonth = month; // החודש הזה טופל – לא נוסיף אותו שוב
      rulesChanged = true;
      month = addMonths(month, 1);
    }
  });

  if (added > 0) {
    saveTransactions();
  }
  if (rulesChanged) {
    saveRules();
  }
  return added;
}

// התאריך הבא שבו החוק יוסיף תנועה
function getNextRuleDate(rule) {
  let month = rule.lastMonth ? addMonths(rule.lastMonth, 1) : rule.startDate.slice(0, 7);
  let date = getRuleDate(month, rule.day);
  if (date < rule.startDate) {
    date = getRuleDate(addMonths(month, 1), rule.day);
  }
  return date;
}

// כמה תנועות יתווספו מיד, אם מתחילים בתאריך הזה (לחודשים שכבר עברו)
function countDueOccurrences(startDate) {
  const todayStr = getTodayString();
  const day = Number(startDate.slice(8, 10));
  let month = startDate.slice(0, 7);
  let count = 0;
  while (month <= todayStr.slice(0, 7)) {
    const date = getRuleDate(month, day);
    if (date >= startDate && date <= todayStr) {
      count++;
    }
    month = addMonths(month, 1);
  }
  return count;
}

// מעדכנת את ההסבר מתחת לתיבת הסימון (וגם את הכיתוב של התאריך והכפתור)
function updateRecurringHint() {
  const on = isRecurringInput.checked;
  dateLabel.textContent = on ? 'תאריך החיוב הראשון' : 'תאריך';
  if (editingId === null) {
    submitBtn.textContent = on ? 'הוסף תנועה קבועה' : 'הוסף תנועה';
  }
  recurringHint.hidden = !on;
  if (!on || !dateInput.value) {
    return;
  }

  const day = Number(dateInput.value.slice(8, 10));
  let text = 'תתווסף אוטומטית בכל חודש ב-' + day + ' לחודש';
  if (day > 28) {
    text += ' (בחודשים קצרים – ביום האחרון של החודש)';
  }
  text += '.';
  const due = countDueOccurrences(dateInput.value);
  if (due === 1) {
    text += ' התנועה הראשונה תתווסף מיד.';
  } else if (due > 1) {
    text += ' ' + due + ' תנועות יתווספו מיד – עבור החודשים שכבר עברו.';
  }
  recurringHint.textContent = text;
}

isRecurringInput.addEventListener('change', updateRecurringHint);
dateInput.addEventListener('change', updateRecurringHint);

// יוצרת חוק חדש מהטופס. מחזירה true אם הצליח
function createRecurringFromForm() {
  const startDate = dateInput.value;
  const oldest = addMonths(getTodayString().slice(0, 7), -MAX_BACKFILL_MONTHS);
  if (startDate.slice(0, 7) < oldest) {
    recurringHint.hidden = false;
    recurringHint.textContent = '⚠ תאריך ההתחלה רחוק מדי – אפשר להתחיל עד ' + MAX_BACKFILL_MONTHS + ' חודשים אחורה.';
    return false;
  }

  const rule = {
    id: generateId(),
    type: getSelectedType(),
    description: descriptionInput.value.trim(),
    amount: parseFloat(amountInput.value),
    category: categorySelect.value,
    day: Number(startDate.slice(8, 10)),
    startDate: startDate,
    active: true,
    lastMonth: null,
  };
  rules.push(rule);
  saveRules();

  const added = processRecurring(); // מוסיפה מיד את מה שכבר הגיע זמנו
  render();

  if (added > 0) {
    showToast('🔁 נוצרה תנועה קבועה. נוספו ' + added + ' תנועות עד היום.');
  } else {
    showToast('🔁 נוצרה תנועה קבועה. הראשונה תתווסף ב-' + formatDate(getNextRuleDate(rule)) + '.');
  }
  return true;
}

// ----- ניהול החוקים בלשונית "קבועות" -----
function findRule(id) {
  return rules.find(function (r) {
    return r.id === id;
  });
}

function toggleRule(id) {
  const rule = findRule(id);
  if (!rule) {
    return;
  }
  rule.active = !rule.active;

  // בהפעלה מחדש לא משלימים את החודשים שבהם החוק היה מושהה – ממשיכים מהחודש הנוכחי
  if (rule.active) {
    const previousMonth = addMonths(getTodayString().slice(0, 7), -1);
    if (rule.startDate.slice(0, 7) <= previousMonth && (!rule.lastMonth || rule.lastMonth < previousMonth)) {
      rule.lastMonth = previousMonth;
    }
  }
  saveRules();
  const added = processRecurring();
  render();
  if (added > 0) {
    showToast('🔁 נוספו ' + added + ' תנועות קבועות.');
  }
}

function updateRuleAmount(id, value) {
  const rule = findRule(id);
  const amount = parseFloat(value);
  if (rule && amount > 0) {
    rule.amount = amount; // חל רק מהפעם הבאה – תנועות שכבר נוספו לא משתנות
    saveRules();
  }
  renderRecurring();
}

function updateRuleDay(id, value) {
  const rule = findRule(id);
  const day = parseInt(value, 10);
  if (rule && day >= 1 && day <= 31) {
    rule.day = day;
    saveRules();
    const added = processRecurring(); // אם היום החדש כבר עבר החודש – התנועה תתווסף עכשיו
    render();
    if (added > 0) {
      showToast('🔁 נוספו ' + added + ' תנועות קבועות.');
    }
    return;
  }
  renderRecurring(); // ערך לא תקין – מחזירים את הערך הקודם
}

function askToDeleteRule(rule) {
  askConfirm({
    title: 'מחיקת תנועה קבועה',
    kind: 'התנועה הקבועה',
    text: '"' + rule.description + '" (' + formatMoney(rule.amount) + ')',
    note: 'תנועות שכבר נוספו יישארו בטבלה. רק התוספות העתידיות ייפסקו.',
    action: function () {
      rules = rules.filter(function (r) {
        return r.id !== rule.id;
      });
      saveRules();
      render();
    },
  });
}

// בונה את רשימת החוקים בלשונית
function renderRecurring() {
  const list = document.getElementById('recurring-list');
  list.innerHTML = '';

  if (rules.length === 0) {
    list.appendChild(createEl('p', 'recurring-empty',
      'עדיין אין תנועות קבועות. לחץ "+ תנועה קבועה" או סמן 🔁 בחלון ההוספה.'));
    return;
  }

  rules.forEach(function (rule) {
    const card = createEl('div', 'rule-card ' + rule.type + (rule.active ? '' : ' paused'));

    // שורה עליונה: שם + סכום
    const top = createEl('div', 'rule-top');
    const sign = rule.type === 'income' ? '+' : '-';
    top.append(
      createEl('span', 'rule-name', rule.description),
      createEl('span', 'rule-amount ' + rule.type, sign + formatMoney(rule.amount))
    );

    // פרטים: קטגוריה, מתי, סטטוס
    const info = createEl('div', 'rule-info');
    info.append(
      createEl('span', 'category-badge', rule.category),
      createEl('span', null, 'כל חודש ב-' + rule.day + ' לחודש'),
      createEl('span', null, rule.active ? '· הבא: ' + formatDate(getNextRuleDate(rule)) : '· מושהית'),
      createEl('span', 'rule-status', rule.active ? 'פעילה' : 'מושהית')
    );

    // עריכה מהירה: סכום, יום, השהיה ומחיקה
    const edit = createEl('div', 'rule-edit');

    const amountLabel = createEl('label', null, 'סכום:');
    const amountField = document.createElement('input');
    amountField.type = 'number';
    amountField.min = '0.01';
    amountField.step = '0.01';
    amountField.value = rule.amount;
    amountField.className = 'rule-amount-input';
    amountField.setAttribute('aria-label', 'סכום עבור ' + rule.description);
    amountField.addEventListener('change', function () {
      updateRuleAmount(rule.id, amountField.value);
    });
    amountLabel.appendChild(amountField);

    const dayLabel = createEl('label', null, 'יום בחודש:');
    const dayField = document.createElement('input');
    dayField.type = 'number';
    dayField.min = '1';
    dayField.max = '31';
    dayField.value = rule.day;
    dayField.className = 'rule-day-input';
    dayField.setAttribute('aria-label', 'יום בחודש עבור ' + rule.description);
    dayField.addEventListener('change', function () {
      updateRuleDay(rule.id, dayField.value);
    });
    dayLabel.appendChild(dayField);

    const actions = createEl('div', 'rule-actions');
    const toggleBtn = createEl('button', null, rule.active ? '⏸ השהה' : '▶ הפעל');
    toggleBtn.type = 'button';
    toggleBtn.addEventListener('click', function () {
      toggleRule(rule.id);
    });
    const deleteBtn = createEl('button', 'rule-delete', '🗑');
    deleteBtn.type = 'button';
    deleteBtn.title = 'מחק תנועה קבועה';
    deleteBtn.setAttribute('aria-label', 'מחק את התנועה הקבועה ' + rule.description);
    deleteBtn.addEventListener('click', function () {
      askToDeleteRule(rule);
    });
    actions.append(toggleBtn, deleteBtn);

    edit.append(amountLabel, dayLabel, actions);
    card.append(top, info, edit);
    list.appendChild(card);
  });
}

document.getElementById('add-recurring').addEventListener('click', function () {
  openAddDialog('expense', true);
});

// ----- הודעה קופצת -----
let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toastEl.hidden = true;
  }, 4500);
}

// בודקת תנועות קבועות ומציגה הודעה אם נוספו
function runRecurringCheck() {
  if (!dataReady) {
    return; // הנתונים עוד לא נטענו מהענן – אין עדיין מה לבדוק
  }
  const added = processRecurring();
  if (added > 0) {
    render();
    showToast('🔁 נוספו ' + added + ' תנועות קבועות.');
  }
}

// אם האפליקציה נשארה פתוחה ברקע (למשל בטלפון) – בודקים שוב כשחוזרים אליה
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    runRecurringCheck();
  }
});

// ===== 9.8 גיבוי, שחזור וייצוא לאקסל =====
const BACKUP_APP_ID = 'budget-app'; // "חתימה" שמזהה שהקובץ שייך לאפליקציה הזו
const BACKUP_VERSION = 1;
const MAX_BACKUP_SIZE = 5 * 1024 * 1024; // 5MB – קובץ גדול מזה כנראה לא גיבוי שלנו

// מורידה קובץ למחשב: יוצרים "קישור" זמני לתוכן ולוחצים עליו בקוד
function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType }); // Blob = "חתיכת נתונים" בזיכרון
  const url = URL.createObjectURL(blob);                // כתובת זמנית לנתונים האלה
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName; // download אומר לדפדפן להוריד במקום לפתוח
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () {
    URL.revokeObjectURL(url); // משחררים את הזיכרון
  }, 1000);
}

// כל הנתונים באובייקט אחד
function buildBackup() {
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    transactions: transactions,
    budgets: budgets,
    recurring: rules,
  };
}

document.getElementById('export-backup').addEventListener('click', function () {
  // JSON.stringify(..., null, 2) – טקסט עם רווחים, קריא גם לבני אדם
  const json = JSON.stringify(buildBackup(), null, 2);
  downloadFile(json, 'budget-backup-' + getTodayString() + '.json', 'application/json');
  showToast('💾 הגיבוי ירד – ' + transactions.length + ' תנועות.');
});

// ----- ייצוא לאקסל (CSV) -----
// תא בטבלה: עוטפים במירכאות, ומכפילים מירכאות שבתוך הטקסט
function csvCell(value) {
  let text = String(value);
  // הגנה: טקסט שמתחיל ב- = + - @ אקסל עלול להריץ כנוסחה – מוסיפים לפניו גרש
  if (/^[=+\-@]/.test(text)) {
    text = "'" + text;
  }
  return '"' + text.replace(/"/g, '""') + '"';
}

document.getElementById('export-csv').addEventListener('click', function () {
  const header = ['תאריך', 'סוג', 'תיאור', 'קטגוריה', 'סכום'];
  const sorted = [...transactions].sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });
  const lines = [header.map(csvCell).join(',')];
  sorted.forEach(function (t) {
    // הוצאה כמספר שלילי – כך אפשר לסכם באקסל ישירות
    const signed = t.type === 'income' ? t.amount : -t.amount;
    lines.push([
      csvCell(formatDate(t.date)),
      csvCell(t.type === 'income' ? 'הכנסה' : 'הוצאה'),
      csvCell(t.description),
      csvCell(t.category),
      signed, // מספר – בלי מירכאות, כדי שאקסל יזהה אותו כמספר
    ].join(','));
  });
  // ﻿ (BOM) בתחילת הקובץ – בלעדיו אקסל מציג עברית כג'יבריש
  downloadFile('﻿' + lines.join('\r\n'), 'budget-' + getTodayString() + '.csv', 'text/csv;charset=utf-8');
  showToast('📄 הקובץ לאקסל ירד – ' + transactions.length + ' תנועות.');
});

// ----- שחזור מגיבוי -----
// בדיקות תקינות: מקבלים רק נתונים שנראים בדיוק כמו שהאפליקציה יוצרת
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;   // 2026-11-23
const MONTH_PATTERN = /^\d{4}-\d{2}$/;        // 2026-11

function isText(value) {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 200;
}
function isPositiveNumber(value) {
  return typeof value === 'number' && isFinite(value) && value > 0;
}
function isValidTransaction(t) {
  return t !== null && typeof t === 'object' &&
    isText(String(t.id)) &&
    (t.type === 'income' || t.type === 'expense') &&
    isText(t.description) && isText(t.category) &&
    isPositiveNumber(t.amount) &&
    typeof t.date === 'string' && DATE_PATTERN.test(t.date);
}
function isValidRule(r) {
  return r !== null && typeof r === 'object' &&
    isText(String(r.id)) &&
    (r.type === 'income' || r.type === 'expense') &&
    isText(r.description) && isText(r.category) &&
    isPositiveNumber(r.amount) &&
    Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 &&
    typeof r.startDate === 'string' && DATE_PATTERN.test(r.startDate) &&
    typeof r.active === 'boolean' &&
    (r.lastMonth === null || (typeof r.lastMonth === 'string' && MONTH_PATTERN.test(r.lastMonth)));
}

// בודקת קובץ גיבוי ומחזירה רק את מה שתקין (או null אם זה לא גיבוי שלנו)
function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return null;
  }
  if (data === null || typeof data !== 'object' || data.app !== BACKUP_APP_ID || !Array.isArray(data.transactions)) {
    return null;
  }

  const result = { transactions: [], budgets: {}, recurring: [], skipped: 0, exportedAt: data.exportedAt };

  data.transactions.forEach(function (t) {
    if (isValidTransaction(t)) {
      // לוקחים רק את השדות המוכרים – שום דבר נוסף לא נכנס
      const clean = { id: String(t.id), type: t.type, description: t.description, amount: t.amount, category: t.category, date: t.date };
      if (t.recurringId) {
        clean.recurringId = String(t.recurringId);
      }
      result.transactions.push(clean);
    } else {
      result.skipped++;
    }
  });

  if (data.budgets !== null && typeof data.budgets === 'object' && !Array.isArray(data.budgets)) {
    Object.keys(data.budgets).forEach(function (name) {
      if (isText(name) && isPositiveNumber(data.budgets[name])) {
        result.budgets[name] = data.budgets[name];
      }
    });
  }

  if (Array.isArray(data.recurring)) {
    data.recurring.forEach(function (r) {
      if (isValidRule(r)) {
        result.recurring.push({
          id: String(r.id), type: r.type, description: r.description, amount: r.amount,
          category: r.category, day: r.day, startDate: r.startDate, active: r.active, lastMonth: r.lastMonth,
        });
      } else {
        result.skipped++;
      }
    });
  }
  return result;
}

const importFileInput = document.getElementById('import-file');

// הכפתור הגלוי פותח את בחירת הקובץ המוסתרת
document.getElementById('import-backup').addEventListener('click', function () {
  importFileInput.click();
});

importFileInput.addEventListener('change', async function () {
  const file = importFileInput.files[0];
  importFileInput.value = ''; // כדי שאפשר יהיה לבחור שוב את אותו קובץ
  if (!file) {
    return;
  }
  if (file.size > MAX_BACKUP_SIZE) {
    showToast('⚠ הקובץ גדול מדי – זה לא נראה כמו גיבוי של האפליקציה.');
    return;
  }

  // await – מחכים שהדפדפן יסיים לקרוא את הקובץ, ורק אז ממשיכים
  const text = await file.text();
  const backup = parseBackup(text);
  if (backup === null) {
    showToast('⚠ זה לא קובץ גיבוי של האפליקציה. שום דבר לא השתנה.');
    return;
  }

  const when = backup.exportedAt && DATE_PATTERN.test(String(backup.exportedAt).slice(0, 10))
    ? ' מ-' + formatDate(String(backup.exportedAt).slice(0, 10))
    : '';
  askConfirm({
    title: 'שחזור מגיבוי',
    kind: 'הנתונים הנוכחיים ולהחליף אותם בגיבוי' + when,
    text: '(' + backup.transactions.length + ' תנועות, ' + Object.keys(backup.budgets).length +
      ' תקציבים, ' + backup.recurring.length + ' תנועות קבועות)',
    note: 'כל הנתונים שיש עכשיו בדפדפן יוחלפו. אם אתה לא בטוח – הורד קודם גיבוי של המצב הנוכחי.' +
      (backup.skipped > 0 ? ' ' + backup.skipped + ' רשומות לא תקינות בקובץ ידולגו.' : ''),
    confirmLabel: 'שחזר',
    action: function () {
      if (editingId !== null) {
        exitEditMode();
      }
      transactions = backup.transactions;
      budgets = backup.budgets;
      rules = backup.recurring;
      saveTransactions();
      saveBudgets();
      saveRules();
      const added = processRecurring(); // משלימים תנועות קבועות מאז תאריך הגיבוי
      render();
      showToast('✅ הנתונים שוחזרו – ' + transactions.length + ' תנועות' +
        (added > 0 ? ' (כולל ' + added + ' תנועות קבועות חדשות)' : '') + '.');
    },
  });
});

// ===== 10. הפעלה ראשונית =====
showTab(getSavedTab());
updateFilterCategoryOptions();
// תאריך היום כברירת מחדל (לפי השעון המקומי, בפורמט YYYY-MM-DD)
const today = new Date();
dateInput.value = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, '0'),
  String(today.getDate()).padStart(2, '0'),
].join('-');
updateCategoryOptions();
updateRecurringHint();
render(); // בהתחלה ריק – הנתונים מגיעים מהענן אחרי ההתחברות (ראו budgetApp למטה)

// ===== 11. הגשר בין האפליקציה לענן (auth.js משתמש בו) =====
// window.budgetApp הוא אובייקט עם פונקציות ש-auth.js (המודול של Firebase) קורא להן.
// ככה הקוד של Firebase נשאר בקובץ אחד, והקוד של האפליקציה – בקובץ אחר.
function toArray(value) {
  return Array.isArray(value) ? value : [];
}
function toObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

window.budgetApp = {
  // auth.js מעביר פונקציה ששומרת ב-Firestore
  setCloudSaver: function (saver) {
    cloudSaver = saver;
  },

  // טעינה ראשונה אחרי התחברות: כל הנתונים בבת אחת
  setAllData: function (data) {
    if (editingId !== null) {
      exitEditMode();
    }
    transactions = toArray(data.transactions);
    budgets = toObject(data.budgets);
    rules = toArray(data.recurring);
    dataReady = true;
    render();
    runRecurringCheck(); // עכשיו אפשר להוסיף תנועות קבועות שהגיע זמנן
  },

  // שינוי שהגיע מהענן (למשל ממכשיר אחר) – סוג נתונים אחד
  setData: function (kind, value) {
    if (kind === 'transactions') {
      transactions = toArray(value);
    } else if (kind === 'budgets') {
      budgets = toObject(value);
    } else if (kind === 'recurring') {
      rules = toArray(value);
    }
    render();
  },

  // הנתונים הנוכחיים (כדי לבדוק אם שינוי מהענן באמת חדש)
  getData: function (kind) {
    if (kind === 'transactions') return transactions;
    if (kind === 'budgets') return budgets;
    return rules;
  },

  // שומרת הכול בענן (משמש בהעברת נתונים ישנים)
  saveAll: function () {
    saveTransactions();
    saveBudgets();
    saveRules();
  },

  // התנתקות: מנקים הכול מהמסך ומהזיכרון
  clearData: function () {
    dataReady = false;
    cloudSaver = null;
    if (transactionDialog.open) {
      transactionDialog.close();
    }
    if (confirmDialog.open) {
      confirmDialog.close();
    }
    if (editingId !== null) {
      exitEditMode();
    }
    transactions = [];
    budgets = {};
    rules = [];
    render();
  },

  // נתונים שנשמרו בדפדפן לפני המעבר לענן
  getLegacyData: function () {
    return { transactions: loadTransactions(), budgets: loadBudgets(), recurring: loadRules() };
  },
  clearLegacyData: function () {
    try {
      [STORAGE_KEY, BUDGETS_KEY, RECURRING_KEY].forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch (error) {
      // אם האחסון חסום – אין מה למחוק
    }
  },

  askConfirm: askConfirm,
  showToast: showToast,
};
