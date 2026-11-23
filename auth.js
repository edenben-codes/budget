// ===== התחברות והרשמה (Firebase Authentication) =====
// הקובץ הזה הוא "מודול" (type="module" ב-HTML), ולכן אפשר להשתמש בו ב-import.
// את Firebase טוענים ישירות מהשרתים של Google – בלי להתקין שום דבר.
// המספר 10.12.2 הוא הגרסה. מקבעים גרסה מדויקת, כדי שעדכון של Google לא ישבור לנו את האפליקציה.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  sendEmailVerification,
  reload,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// מתחברים לפרויקט שלנו ב-Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'he'; // מיילים מ-Firebase (כמו איפוס סיסמה) יישלחו בעברית

// מסד הנתונים. persistentLocalCache = עותק מקומי בדפדפן, כדי שאפשר יהיה לעבוד גם בלי אינטרנט
// (שינויים נשמרים מקומית ונשלחים לענן כשהחיבור חוזר). MultipleTab – עובד גם עם כמה לשוניות פתוחות.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const MIN_PASSWORD_LENGTH = 8;

// ----- אלמנטים -----
const loadingScreen = document.getElementById('auth-loading');
const authScreen = document.getElementById('auth-screen');
const appRoot = document.getElementById('app-root');
const verifyScreen = document.getElementById('verify-screen');
const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('auth-email');
const passwordInput = document.getElementById('auth-password');
const confirmField = document.getElementById('auth-confirm-field');
const confirmInput = document.getElementById('auth-password-confirm');
const errorBox = document.getElementById('auth-error');
const successBox = document.getElementById('auth-success');
const submitBtn = document.getElementById('auth-submit');
const subtitle = document.getElementById('auth-subtitle');
const tabLogin = document.getElementById('auth-tab-login');
const tabSignup = document.getElementById('auth-tab-signup');
const forgotBtn = document.getElementById('forgot-password');

// 'login' או 'signup'
let mode = 'login';

// ----- הודעות -----
function showError(message) {
  successBox.hidden = true;
  errorBox.textContent = message;
  errorBox.hidden = false;
}
function showSuccess(message) {
  errorBox.hidden = true;
  successBox.textContent = message;
  successBox.hidden = false;
}
function clearMessages() {
  errorBox.hidden = true;
  successBox.hidden = true;
}

// Firebase מחזיר קודי שגיאה באנגלית – מתרגמים אותם להודעות ברורות בעברית
function translateError(error) {
  const messages = {
    'auth/invalid-email': 'כתובת המייל לא תקינה.',
    'auth/missing-email': 'צריך להקליד מייל.',
    'auth/missing-password': 'צריך להקליד סיסמה.',
    'auth/invalid-credential': 'המייל או הסיסמה שגויים.',
    'auth/wrong-password': 'המייל או הסיסמה שגויים.',
    'auth/user-not-found': 'המייל או הסיסמה שגויים.',
    'auth/email-already-in-use': 'המייל הזה כבר רשום. נסה "כניסה" במקום "הרשמה".',
    'auth/weak-password': 'הסיסמה חלשה מדי. בחר סיסמה ארוכה יותר.',
    'auth/too-many-requests': 'יותר מדי ניסיונות. חכה כמה דקות ונסה שוב.',
    'auth/network-request-failed': 'אין חיבור לאינטרנט. בדוק את החיבור ונסה שוב.',
    'auth/user-disabled': 'החשבון הזה הושבת.',
  };
  return messages[error.code] || 'משהו השתבש. נסה שוב.';
}

// ----- מעבר בין "כניסה" ל"הרשמה" -----
function setMode(newMode) {
  mode = newMode;
  const isSignup = mode === 'signup';
  tabLogin.setAttribute('aria-selected', isSignup ? 'false' : 'true');
  tabSignup.setAttribute('aria-selected', isSignup ? 'true' : 'false');
  confirmField.hidden = !isSignup;
  forgotBtn.hidden = isSignup;
  submitBtn.textContent = isSignup ? 'יצירת חשבון' : 'כניסה';
  subtitle.textContent = isSignup ? 'צור חשבון חדש' : 'היכנס לחשבון שלך';
  // autocomplete עוזר למנהל הסיסמאות של הדפדפן להציע סיסמה חדשה בהרשמה
  passwordInput.autocomplete = isSignup ? 'new-password' : 'current-password';
  clearMessages();
}

tabLogin.addEventListener('click', function () {
  setMode('login');
});
tabSignup.addEventListener('click', function () {
  setMode('signup');
});

// ----- שליחת הטופס -----
authForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  clearMessages();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  // בדיקות לפני שפונים לשרת
  if (email === '') {
    showError('צריך להקליד מייל.');
    return;
  }
  if (password === '') {
    showError('צריך להקליד סיסמה.');
    return;
  }
  if (mode === 'signup') {
    if (password.length < MIN_PASSWORD_LENGTH) {
      showError('הסיסמה צריכה להיות לפחות ' + MIN_PASSWORD_LENGTH + ' תווים.');
      return;
    }
    if (password !== confirmInput.value) {
      showError('הסיסמאות לא זהות.');
      return;
    }
  }

  submitBtn.disabled = true; // מונעים לחיצה כפולה בזמן שמחכים לשרת
  try {
    // "זכור אותי": Local = נשאר מחובר גם אחרי סגירת הדפדפן. Session = מתנתק כשהדפדפן נסגר.
    // חייבים לקבוע את זה לפני ההתחברות עצמה.
    const remember = document.getElementById('auth-remember').checked;
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    setRemembered(remember);
    markActivity(true); // מתחילים לספור 30 דקות מעכשיו

    // await – מחכים לתשובה מהשרת של Firebase. אם יש שגיאה, קופצים ל-catch
    if (mode === 'signup') {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await sendVerification(result.user); // שולחים מייל אימות מיד אחרי ההרשמה
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    // הצלחה: לא צריך לעשות כלום כאן – onAuthStateChanged (למטה) יציג את האפליקציה
    passwordInput.value = '';
    confirmInput.value = '';
  } catch (error) {
    showError(translateError(error));
  } finally {
    // finally רץ תמיד – גם אחרי הצלחה וגם אחרי שגיאה
    submitBtn.disabled = false;
  }
});

// ----- שכחתי סיסמה -----
forgotBtn.addEventListener('click', async function () {
  clearMessages();
  const email = emailInput.value.trim();
  if (email === '') {
    showError('הקלד את המייל שלך בשדה "מייל", ואז לחץ שוב על "שכחתי סיסמה".');
    emailInput.focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    // מייל לא תקין או בעיית רשת – כן מציגים שגיאה
    if (error.code === 'auth/invalid-email' || error.code === 'auth/network-request-failed' || error.code === 'auth/too-many-requests') {
      showError(translateError(error));
      return;
    }
    // שגיאות אחרות (כמו "המשתמש לא קיים") לא מגלים – כדי שאי אפשר יהיה לבדוק אילו מיילים רשומים
  }
  showSuccess('אם המייל רשום, נשלח אליו קישור לאיפוס הסיסמה. בדוק גם בתיקיית הספאם.');
});

// ----- התנתקות -----
document.getElementById('logout-btn').addEventListener('click', function () {
  signOut(auth);
});

// ===== שמירה וסנכרון בענן (Firestore) =====
// מבנה הנתונים בענן – לכל משתמש "תיקייה" משלו לפי ה-UID:
//   users/{uid}/data/transactions  → { items: [...] }
//   users/{uid}/data/budgets       → { items: {...} }
//   users/{uid}/data/recurring     → { items: [...] }
// חוקי האבטחה (firestore.rules) מבטיחים שכל משתמש ניגש רק לתיקייה שלו.
const KINDS = ['transactions', 'budgets', 'recurring'];
let unsubscribers = []; // פונקציות שמפסיקות את ההאזנה לענן (מפעילים אותן ביציאה)
let slowLoadingTimer = null;

function stopSync() {
  unsubscribers.forEach(function (stop) {
    stop();
  });
  unsubscribers = [];
  clearTimeout(slowLoadingTimer);
}

function showApp() {
  loadingScreen.hidden = true;
  authScreen.hidden = true;
  verifyScreen.hidden = true;
  appRoot.hidden = false;
}

function showLoading(text) {
  loadingScreen.textContent = text;
  loadingScreen.hidden = false;
  authScreen.hidden = true;
  verifyScreen.hidden = true;
  appRoot.hidden = true;
}

function startSync(user) {
  stopSync();
  const budgetApp = window.budgetApp;

  // מה קורה כשהאפליקציה שומרת: כותבים את המסמך המתאים בענן
  budgetApp.setCloudSaver(function (kind, value) {
    const ref = doc(db, 'users', user.uid, 'data', kind);
    // setDoc מחליף את כל המסמך. serverTimestamp – השעה שבה השרת קיבל את השינוי
    setDoc(ref, { items: value, updatedAt: serverTimestamp() }).catch(function (error) {
      console.warn('השמירה בענן נכשלה:', error);
      budgetApp.showToast('⚠ השמירה בענן נכשלה. רענן את הדף ונסה שוב.');
    });
  });

  // טעינה ראשונה: מחכים שכל שלושת סוגי הנתונים יגיעו מהשרת
  const firstValues = {};
  let firstLoadDone = false;

  // אם הטעינה לוקחת זמן – כנראה אין אינטרנט
  slowLoadingTimer = setTimeout(function () {
    if (!firstLoadDone) {
      showLoading('⏳ טוען נתונים מהענן… אם זה לוקח זמן, בדוק את החיבור לאינטרנט.');
    }
  }, 6000);

  KINDS.forEach(function (kind) {
    const ref = doc(db, 'users', user.uid, 'data', kind);

    // onSnapshot – מאזין: Firebase קורא לפונקציה עכשיו, ושוב בכל פעם שהמסמך משתנה בענן
    // (למשל כשהוספת תנועה בטלפון – המחשב יקבל את השינוי לבד)
    const stop = onSnapshot(ref, { includeMetadataChanges: true }, function (snapshot) {
      const value = snapshot.exists() ? snapshot.data().items : undefined;

      if (!firstLoadDone) {
        // בטעינה הראשונה מקבלים רק מידע שאושר מהשרת, או נתונים שכבר שמורים בעותק המקומי.
        // "המסמך לא קיים" מהעותק המקומי לא מספיק – אולי פשוט עוד לא דיברנו עם השרת.
        if (snapshot.metadata.fromCache && !snapshot.exists()) {
          return;
        }
        firstValues[kind] = value;
        if (KINDS.every(function (k) { return k in firstValues; })) {
          firstLoadDone = true;
          clearTimeout(slowLoadingTimer);
          handleFirstLoad(firstValues);
        }
        return;
      }

      // אחרי הטעינה הראשונה: שינוי שהתחיל אצלנו (עוד לא אושר בשרת) – כבר מופיע על המסך
      if (snapshot.metadata.hasPendingWrites) {
        return;
      }
      // אם הנתונים זהים למה שכבר מוצג – לא צריך לצייר מחדש
      if (JSON.stringify(value) === JSON.stringify(budgetApp.getData(kind))) {
        return;
      }
      budgetApp.setData(kind, value); // שינוי ממכשיר אחר
    }, function (error) {
      console.warn('שגיאה בטעינה מהענן:', error);
      showLoading('⚠ לא הצלחנו לטעון את הנתונים מהענן. רענן את הדף כדי לנסות שוב.');
    });

    unsubscribers.push(stop);
  });
}

// טעינה ראשונה: אם החשבון ריק ויש נתונים ישנים בדפדפן – מציעים להעלות אותם
function handleFirstLoad(values) {
  const budgetApp = window.budgetApp;
  const cloudIsEmpty = KINDS.every(function (kind) {
    return values[kind] === undefined;
  });
  const legacy = budgetApp.getLegacyData();
  const legacyCount = legacy.transactions.length + Object.keys(legacy.budgets).length + legacy.recurring.length;

  if (cloudIsEmpty && legacyCount > 0) {
    budgetApp.setAllData({ transactions: [], budgets: {}, recurring: [] });
    showApp();
    budgetApp.askConfirm({
      title: 'העברת הנתונים לחשבון',
      prefix: 'להעלות לחשבון שלך את',
      kind: 'הנתונים ששמורים בדפדפן הזה',
      text: '(' + legacy.transactions.length + ' תנועות, ' + Object.keys(legacy.budgets).length +
        ' תקציבים, ' + legacy.recurring.length + ' תנועות קבועות)',
      note: 'אחרי ההעלאה הנתונים יישמרו בענן – ותוכל לראות אותם מכל מכשיר. אם הנתונים האלה לא שלך (למשל, מישהו אחר השתמש בדפדפן), לחץ "ביטול" – החשבון יתחיל ריק והנתונים יישארו בדפדפן.',
      confirmLabel: 'העלה',
      action: function () {
        budgetApp.setAllData(legacy);
        budgetApp.saveAll();
        budgetApp.clearLegacyData();
        budgetApp.showToast('☁ הנתונים הועלו לחשבון שלך.');
      },
    });
    return;
  }

  budgetApp.setAllData(values);
  showApp();
}

// ===== מחיקת חשבון =====
// כל משתמש יכול למחוק את החשבון שלו ואת כל הנתונים שלו – בלי לבקש מאף אחד.
const deleteDialog = document.getElementById('delete-account-dialog');
const deletePassword = document.getElementById('delete-account-password');
const deleteError = document.getElementById('delete-account-error');
const deleteConfirmBtn = document.getElementById('delete-account-confirm');
let accountJustDeleted = false; // כדי להציג הודעה במסך הכניסה אחרי המחיקה

function closeDeleteDialog() {
  deletePassword.value = '';
  deleteError.hidden = true;
  deleteDialog.close();
}

document.getElementById('delete-account-btn').addEventListener('click', function () {
  deletePassword.value = '';
  deleteError.hidden = true;
  deleteConfirmBtn.disabled = false;
  deleteDialog.showModal();
  deletePassword.focus();
});

// "הורד גיבוי קודם" – משתמש בכפתור הגיבוי הקיים של האפליקציה
document.getElementById('delete-account-backup').addEventListener('click', function () {
  document.getElementById('export-backup').click();
});

document.getElementById('delete-account-cancel').addEventListener('click', closeDeleteDialog);
deleteDialog.addEventListener('cancel', function (event) {
  event.preventDefault(); // Esc – סוגרים בעצמנו, כדי לנקות את שדה הסיסמה
  closeDeleteDialog();
});

deleteConfirmBtn.addEventListener('click', async function () {
  if (deletePassword.value === '') {
    deleteError.textContent = 'צריך להקליד את הסיסמה.';
    deleteError.hidden = false;
    return;
  }
  const user = auth.currentUser;
  if (!user) {
    closeDeleteDialog();
    return;
  }

  deleteConfirmBtn.disabled = true;
  deleteError.hidden = true;
  try {
    // 1. אימות מחדש: Firebase מוחק חשבון רק אם הסיסמה הוקלדה זה עתה
    const credential = EmailAuthProvider.credential(user.email, deletePassword.value);
    await reauthenticateWithCredential(user, credential);

    // 2. מפסיקים להאזין לענן ולשמור – כדי ששום דבר לא ייכתב מחדש אחרי המחיקה
    stopSync();
    window.budgetApp.setCloudSaver(null);

    // 3. מוחקים את כל הנתונים מהענן (חייבים לעשות את זה לפני מחיקת החשבון – אחריה אין הרשאה)
    // Promise.all – מריץ את שלוש המחיקות במקביל ומחכה שכולן יסתיימו
    await Promise.all(KINDS.map(function (kind) {
      return deleteDoc(doc(db, 'users', user.uid, 'data', kind));
    }));

    // 4. מוחקים את החשבון עצמו. onAuthStateChanged יחזיר אותנו למסך הכניסה
    accountJustDeleted = true;
    await deleteUser(user);
    closeDeleteDialog();
  } catch (error) {
    accountJustDeleted = false;
    deleteConfirmBtn.disabled = false;
    const messages = {
      'auth/invalid-credential': 'הסיסמה שגויה.',
      'auth/wrong-password': 'הסיסמה שגויה.',
      'auth/too-many-requests': 'יותר מדי ניסיונות. חכה כמה דקות ונסה שוב.',
      'auth/network-request-failed': 'אין חיבור לאינטרנט. בדוק את החיבור ונסה שוב.',
    };
    deleteError.textContent = messages[error.code] || 'המחיקה נכשלה. רענן את הדף ונסה שוב.';
    deleteError.hidden = false;
    // אם הספקנו להפסיק את הסנכרון אבל המחיקה נכשלה – מחזירים אותו
    if (auth.currentUser && unsubscribers.length === 0) {
      startSync(auth.currentUser);
    }
  }
});

// ===== ניתוק אוטומטי אחרי 30 דקות בלי פעילות =====
// חל רק כש"זכור אותי" לא סומן. זמן הפעילות האחרונה נשמר בדפדפן,
// כך שהבדיקה עובדת גם אם הדף היה סגור או ברקע (למשל בטלפון).
const IDLE_LIMIT_MS = 30 * 60 * 1000;      // 30 דקות במילישניות
const ACTIVITY_KEY = 'budget-last-activity';
const REMEMBER_KEY = 'budget-remember';
let lastActivityWrite = 0;
let idleSignedOut = false; // כדי להציג הודעה במסך הכניסה

function isRemembered() {
  try {
    return localStorage.getItem(REMEMBER_KEY) === '1';
  } catch (error) {
    return false;
  }
}
function setRemembered(value) {
  try {
    localStorage.setItem(REMEMBER_KEY, value ? '1' : '0');
  } catch (error) {
    // אם האחסון חסום – פשוט לא זוכרים
  }
}

// שומרת "עכשיו" כזמן הפעילות האחרונה. כדי לא לכתוב על כל תזוזה – לכל היותר פעם ב-10 שניות
function markActivity(force) {
  const now = Date.now();
  if (!force && now - lastActivityWrite < 10000) {
    return;
  }
  lastActivityWrite = now;
  try {
    localStorage.setItem(ACTIVITY_KEY, String(now));
  } catch (error) {
    // מתעלמים
  }
}

function isIdleExpired() {
  let last = 0;
  try {
    last = Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch (error) {
    return false;
  }
  return last > 0 && Date.now() - last > IDLE_LIMIT_MS;
}

// בודקת אם צריך לנתק – ומנתקת
function checkIdle() {
  if (auth.currentUser && !isRemembered() && isIdleExpired()) {
    idleSignedOut = true;
    signOut(auth);
  }
}

// כל פעולה של המשתמש = פעילות. passive: true – לא מאט את הגלילה
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (eventName) {
  document.addEventListener(eventName, function () {
    if (auth.currentUser) {
      markActivity(false);
    }
  }, { passive: true });
});

setInterval(checkIdle, 30 * 1000); // בודקים כל 30 שניות
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    checkIdle(); // חזרנו לאפליקציה אחרי שהייתה ברקע – בודקים מיד
  }
});

// ===== אימות מייל =====
const verifyError = document.getElementById('verify-error');
const verifySuccess = document.getElementById('verify-success');

function showVerifyScreen(user) {
  document.getElementById('verify-email').textContent = user.email;
  loadingScreen.hidden = true;
  authScreen.hidden = true;
  appRoot.hidden = true;
  verifyScreen.hidden = false;
}

function verifyMessage(text, isError) {
  verifyError.hidden = !isError;
  verifySuccess.hidden = isError;
  (isError ? verifyError : verifySuccess).textContent = text;
}

// שולחת מייל אימות. הקישור במייל יחזיר את המשתמש לאפליקציה
async function sendVerification(user) {
  try {
    await sendEmailVerification(user, { url: window.location.origin + window.location.pathname });
    verifyMessage('📧 שלחנו מייל אימות אל ' + user.email + '. בדוק גם בתיקיית הספאם.', false);
  } catch (error) {
    if (error.code === 'auth/too-many-requests') {
      verifyMessage('כבר שלחנו כמה מיילים. חכה כמה דקות ונסה שוב.', true);
    } else {
      verifyMessage('שליחת המייל נכשלה. נסה שוב בעוד רגע.', true);
    }
  }
}

document.getElementById('verify-resend').addEventListener('click', function () {
  if (auth.currentUser) {
    sendVerification(auth.currentUser);
  }
});

document.getElementById('verify-continue').addEventListener('click', async function () {
  const user = auth.currentUser;
  if (!user) {
    return;
  }
  try {
    // reload – מושך מהשרת את המצב העדכני של המשתמש (האם המייל כבר אומת)
    await reload(user);
    if (!auth.currentUser.emailVerified) {
      verifyMessage('המייל עדיין לא אומת. לחץ על הקישור במייל, ואז נסה שוב.', true);
      return;
    }
    // מבקשים "כרטיס כניסה" (token) חדש – כדי שגם חוקי האבטחה בשרת יראו שהמייל אומת
    await auth.currentUser.getIdToken(true);
    enterApp(auth.currentUser);
  } catch (error) {
    verifyMessage('משהו השתבש. בדוק את החיבור לאינטרנט ונסה שוב.', true);
  }
});

document.getElementById('verify-logout').addEventListener('click', function () {
  signOut(auth);
});

// נכנסים לאפליקציה: טוענים את הנתונים מהענן
function enterApp(user) {
  document.getElementById('user-email').textContent = user.email;
  showLoading('⏳ טוען את הנתונים שלך…');
  startSync(user);
}

// ----- הלב: מה מציגים לפי מצב ההתחברות -----
// onAuthStateChanged רץ פעם אחת כשהדף נטען, ושוב בכל כניסה או יציאה.
onAuthStateChanged(auth, function (user) {
  if (user) {
    // 1. אם עברו 30 דקות בלי פעילות (וזכור אותי לא סומן) – מנתקים לפני שמציגים משהו
    if (!isRemembered() && isIdleExpired()) {
      idleSignedOut = true;
      signOut(auth);
      return;
    }
    markActivity(true);

    // 2. מייל לא מאומת – מסך אימות, בלי גישה לנתונים
    if (!user.emailVerified) {
      showVerifyScreen(user);
      return;
    }

    // 3. הכול תקין – נכנסים
    enterApp(user);
  } else {
    stopSync();
    window.budgetApp.clearData(); // מנקים את הנתונים של המשתמש הקודם מהמסך
    loadingScreen.hidden = true;
    appRoot.hidden = true;
    verifyScreen.hidden = true;
    verifyError.hidden = true;    // מנקים הודעות ממסך האימות, לקראת המשתמש הבא
    verifySuccess.hidden = true;
    authScreen.hidden = false;
    setMode('login');
    document.getElementById('auth-remember').checked = isRemembered();
    if (accountJustDeleted) {
      accountJustDeleted = false;
      showSuccess('✅ החשבון וכל הנתונים שלו נמחקו.');
    } else if (idleSignedOut) {
      idleSignedOut = false;
      showSuccess('🔒 נותקת אוטומטית אחרי 30 דקות בלי פעילות. היכנס שוב כדי להמשיך.');
    }
  }
});
