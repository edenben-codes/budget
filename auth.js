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
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  setDoc,
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
    // await – מחכים לתשובה מהשרת של Firebase. אם יש שגיאה, קופצים ל-catch
    if (mode === 'signup') {
      await createUserWithEmailAndPassword(auth, email, password);
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
  appRoot.hidden = false;
}

function showLoading(text) {
  loadingScreen.textContent = text;
  loadingScreen.hidden = false;
  authScreen.hidden = true;
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

// ----- הלב: מה מציגים לפי מצב ההתחברות -----
// onAuthStateChanged רץ פעם אחת כשהדף נטען, ושוב בכל כניסה או יציאה.
// Firebase זוכר משתמש מחובר גם אחרי סגירת הדפדפן – כך שלא צריך להתחבר כל פעם.
onAuthStateChanged(auth, function (user) {
  if (user) {
    document.getElementById('user-email').textContent = user.email;
    showLoading('⏳ טוען את הנתונים שלך…');
    startSync(user);
  } else {
    stopSync();
    window.budgetApp.clearData(); // מנקים את הנתונים של המשתמש הקודם מהמסך
    loadingScreen.hidden = true;
    appRoot.hidden = true;
    authScreen.hidden = false;
    setMode('login');
  }
});
