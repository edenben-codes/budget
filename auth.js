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
import { firebaseConfig } from './firebase-config.js';

// מתחברים לפרויקט שלנו ב-Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'he'; // מיילים מ-Firebase (כמו איפוס סיסמה) יישלחו בעברית

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

// ----- הלב: מה מציגים לפי מצב ההתחברות -----
// onAuthStateChanged רץ פעם אחת כשהדף נטען, ושוב בכל כניסה או יציאה.
// Firebase זוכר משתמש מחובר גם אחרי סגירת הדפדפן – כך שלא צריך להתחבר כל פעם.
onAuthStateChanged(auth, function (user) {
  loadingScreen.hidden = true;
  if (user) {
    document.getElementById('user-email').textContent = user.email;
    authScreen.hidden = true;
    appRoot.hidden = false;
  } else {
    appRoot.hidden = true;
    authScreen.hidden = false;
    setMode('login');
  }
});
