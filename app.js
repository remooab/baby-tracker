import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    deleteDoc,
    onSnapshot,
    enableIndexedDbPersistence,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ===== Baby Progress Tracker - Firebase Edition =====

// ===== Firebase Configuration =====
const firebaseConfig = {
    apiKey: "AIzaSyDHthWbsBeFfS3P60gNFEH30hqP3LbTx68",
    authDomain: "baby-tracker-446c1.firebaseapp.com",
    projectId: "baby-tracker-446c1",
    storageBucket: "baby-tracker-446c1.firebasestorage.app",
    messagingSenderId: "823716453083",
    appId: "1:823716453083:web:313e5745f99eda872d8afe"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Enable Offline Persistence
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.log('Persistence failed: Multiple tabs open');
    } else if (err.code == 'unimplemented') {
        console.log('Persistence not available in this browser');
    }
});

// ===== Constants =====
const COLLECTIONS = {
    baby: 'baby',
    feedings: 'feedings',
    sleeps: 'sleeps',
    settings: 'settings'
};

// ===== State =====
// We keep a local copy of data synced from Firestore
const state = {
    user: null,
    baby: null,
    settings: { volumeUnit: 'ml' },
    feedings: [],
    sleeps: [],
    activeTimer: null,
    activeSleep: null,
    currentFeedingDate: new Date(),
    currentSleepDate: new Date(),
    editingId: null
};

// ===== Database Helpers (Firebase Wrappers) =====
function getUserRef(collectionName, docId) {
    if (!state.user) throw new Error("User not authenticated");
    // Path: users/{userId}/{collectionName}/{docId}
    return doc(db, 'users', state.user.uid, collectionName, docId);
}

// Add or Update a document
async function saveDoc(collectionName, data) {
    try {
        if (!state.user) {
            showToast("Please log in first");
            return;
        }
        await setDoc(getUserRef(collectionName, data.id), data);
        return data; // Success
    } catch (e) {
        console.error("Error adding document: ", e);
        showToast("Error saving. Check internet?");
        throw e;
    }
}

// Delete a document
async function removeDoc(collectionName, id) {
    try {
        if (!state.user) return;
        await deleteDoc(getUserRef(collectionName, id));
    } catch (e) {
        console.error("Error removing document: ", e);
        showToast("Error deleting.");
        throw e;
    }
}

// Clear all data (for Settings -> Clear Data)
async function clearCollection(collectionName) {
    if (!state.user) return;

    // In a real app, do this via a Cloud Function. For MVP, we iterate local state.
    const items = collectionName === COLLECTIONS.feedings ? state.feedings : state.sleeps;
    const promises = items.map(item => deleteDoc(getUserRef(collectionName, item.id)));
    await Promise.all(promises);
}

// ===== Utility Functions =====
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatTime(date) {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date) {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
}

function formatTimerDuration(ms) {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / 60000) % 60;
    const hours = Math.floor(ms / 3600000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    return formatDate(timestamp);
}

function calculateBabyAge(birthDate) {
    const birth = new Date(birthDate);
    const now = new Date();
    const diffTime = now - birth;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    const months = Math.floor(diffDays / 30);
    const weeks = Math.floor((diffDays % 30) / 7);
    const days = diffDays % 7;

    let age = '';
    if (months > 0) age += `${months} month${months > 1 ? 's' : ''} `;
    if (weeks > 0) age += `${weeks} week${weeks > 1 ? 's' : ''} `;
    if (months === 0 && weeks === 0) age = `${days} day${days !== 1 ? 's' : ''} old`;
    else age += 'old';

    return age.trim();
}

function getStartOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getEndOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

function getLocalDateTimeString(date = new Date()) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

// ===== Toast Notification =====
function showToast(message) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 250);
    }, 2500);
}

// ===== Real-time Listeners =====
// ===== Real-time Listeners =====
let unsubBaby, unsubSettings, unsubFeedings, unsubSleeps;

function initListeners() {
    // Clean up existing listeners if any
    if (unsubBaby) unsubBaby();
    if (unsubSettings) unsubSettings();
    if (unsubFeedings) unsubFeedings();
    if (unsubSleeps) unsubSleeps();

    if (!state.user) {
        console.log("No user, clearing data...");
        state.baby = null;
        state.settings = { volumeUnit: 'ml' };
        state.feedings = [];
        state.sleeps = [];
        updateDashboard();
        renderFeedingLog();
        renderSleepLog();
        updateBabyUI();
        updateSettingsUI();
        return;
    }

    console.log("Initializing Firestore listeners for user:", state.user.uid);
    const userId = state.user.uid;

    // Baby Info Listener
    // Path: users/{uid}/baby/main
    unsubBaby = onSnapshot(doc(db, 'users', userId, COLLECTIONS.baby, 'main'), (doc) => {
        if (doc.exists()) {
            state.baby = doc.data();
            updateBabyUI();
        }
    });

    // Settings Listener
    // Path: users/{uid}/settings/main
    unsubSettings = onSnapshot(doc(db, 'users', userId, COLLECTIONS.settings, 'main'), (doc) => {
        if (doc.exists()) {
            state.settings = doc.data();
            updateSettingsUI();
        }
    });

    // Feedings Listener
    // Path: users/{uid}/feedings
    const qFeedings = query(
        collection(db, 'users', userId, COLLECTIONS.feedings),
        orderBy("startTime", "desc")
    );
    unsubFeedings = onSnapshot(qFeedings, (snapshot) => {
        state.feedings = [];
        snapshot.forEach((doc) => {
            state.feedings.push(doc.data());
        });

        // Refresh UI whenever data changes
        updateDashboard();
        renderFeedingLog();
    });

    // Sleep Listener
    // Path: users/{uid}/sleeps
    const qSleeps = query(
        collection(db, 'users', userId, COLLECTIONS.sleeps),
        orderBy("startTime", "desc")
    );
    unsubSleeps = onSnapshot(qSleeps, (snapshot) => {
        state.sleeps = [];
        snapshot.forEach((doc) => {
            state.sleeps.push(doc.data());
        });

        // Refresh UI whenever data changes
        updateDashboard();
        renderSleepLog();
    });
}

// ===== Navigation =====
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const screens = document.querySelectorAll('.screen');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const screenId = item.dataset.screen;

            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            screens.forEach(s => s.classList.remove('active'));
            document.getElementById(`${screenId}Screen`).classList.add('active');

            if (screenId === 'home') updateDashboard();
            if (screenId === 'feeding') renderFeedingLog();
            if (screenId === 'sleep') renderSleepLog();
        });
    });
}

// ===== Modal Handling =====
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function initModals() {
    document.querySelectorAll('.modal-close, .cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.modal;
            if (modalId) closeModal(modalId);
        });
    });

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal.id);
        });
    });
}

// ===== Side/Type Selectors =====
function initSelectors() {
    document.querySelectorAll('.side-selector').forEach(selector => {
        selector.querySelectorAll('.side-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selector.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    });

    document.querySelectorAll('.sleep-type-selector').forEach(selector => {
        selector.querySelectorAll('.sleep-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selector.querySelectorAll('.sleep-type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    });

    document.querySelectorAll('.choice-buttons').forEach(container => {
        container.querySelectorAll('.choice-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    });
}

// ===== Amount Buttons =====
function initAmountButtons() {
    document.querySelectorAll('.amount-input').forEach(container => {
        const input = container.querySelector('input');
        const minusBtn = container.querySelector('.minus');
        const plusBtn = container.querySelector('.plus');

        minusBtn.addEventListener('click', () => {
            const step = parseInt(input.step) || 10;
            input.value = Math.max(0, parseInt(input.value) - step);
        });

        plusBtn.addEventListener('click', () => {
            const step = parseInt(input.step) || 10;
            input.value = parseInt(input.value) + step;
        });
    });
}

// ===== Dashboard & Updates =====

function updateBabyUI() {
    const babyInfo = document.getElementById('babyInfo');
    if (state.baby && state.baby.name) {
        babyInfo.querySelector('.baby-name').textContent = `Hello, ${state.baby.name}`;
        babyInfo.querySelector('.baby-age').textContent = state.baby.birthDate ? calculateBabyAge(state.baby.birthDate) : '';
    } else {
        babyInfo.querySelector('.baby-name').textContent = 'Hello, Baby';
        babyInfo.querySelector('.baby-age').textContent = 'Set up your baby\'s info in settings';
    }
}

function updateSettingsUI() {
    if (state.settings && state.settings.volumeUnit) {
        document.getElementById('volumeUnit').value = state.settings.volumeUnit;
    }
}

function updateDashboard() {
    // This is called automatically by listeners when data changes
    updateQuickStats();
    updateTodaySummary();
    checkActiveTimers();
}

function updateQuickStats() {
    const feedings = state.feedings; // Already sorted desc by listener
    const sleeps = state.sleeps;     // Already sorted desc by listener

    // Last feeding
    const lastFeeding = feedings[0];
    const lastFeedingEl = document.getElementById('lastFeedingTime');
    lastFeedingEl.textContent = lastFeeding ? formatTimeAgo(lastFeeding.startTime) : 'No data yet';

    // Last sleep / current awake time
    // First check if there's any sleep that hasn't ended
    const activeSleep = sleeps.find(s => !s.endTime);
    // Otherwise look for the most recently ended sleep
    const lastEndedSleep = sleeps.filter(s => s.endTime).sort((a, b) => b.endTime - a.endTime)[0];

    const lastSleepEl = document.getElementById('lastSleepTime');

    if (activeSleep) {
        lastSleepEl.textContent = 'Currently sleeping';
    } else if (lastEndedSleep) {
        lastSleepEl.textContent = `Awake for ${formatTimeAgo(lastEndedSleep.endTime).replace(' ago', '')}`;
    } else {
        lastSleepEl.textContent = 'No data yet';
    }
}

function updateTodaySummary() {
    const today = new Date();
    const startOfDay = getStartOfDay(today).getTime();
    const endOfDay = getEndOfDay(today).getTime();

    // Today's feedings
    const todayFeedings = state.feedings.filter(f => f.startTime >= startOfDay && f.startTime <= endOfDay);
    document.getElementById('todayFeedings').textContent = todayFeedings.length;

    // Total amount (bottle + formula)
    const totalAmount = todayFeedings
        .filter(f => f.type !== 'breast' && f.amount)
        .reduce((sum, f) => sum + f.amount, 0);
    document.getElementById('todayAmount').textContent = totalAmount;

    // Today's sleep
    const todaySleeps = state.sleeps.filter(s => s.startTime >= startOfDay && s.startTime <= endOfDay);
    const totalSleepMs = todaySleeps.reduce((sum, s) => {
        const end = s.endTime || Date.now();
        const duration = end - s.startTime - (s.totalPausedMs || 0);
        return sum + Math.max(0, duration);
    }, 0);
    const sleepHours = Math.floor(totalSleepMs / 3600000);
    const sleepMins = Math.floor((totalSleepMs % 3600000) / 60000);
    document.getElementById('todaySleep').textContent = `${sleepHours}h${sleepMins > 0 ? sleepMins + 'm' : ''}`;

    // Nap count
    const napCount = todaySleeps.filter(s => s.type === 'nap').length;
    document.getElementById('todayNaps').textContent = napCount;
}

function checkActiveTimers() {
    // Check for active breastfeeding
    const activeFeeding = state.feedings.find(f => f.type === 'breast' && !f.endTime);

    if (activeFeeding) {
        state.activeTimer = activeFeeding;
        showActiveTimer();
    } else {
        state.activeTimer = null;
        hideActiveTimer();
    }

    // Check for active sleep
    const activeSleep = state.sleeps.find(s => !s.endTime);

    if (activeSleep) {
        state.activeSleep = activeSleep;
        showActiveSleepBanner();
    } else {
        state.activeSleep = null;
        hideActiveSleepBanner();
    }
}

// ===== Active Timer Logic =====
let timerInterval = null;

function showActiveTimer() {
    const section = document.getElementById('activeTimerSection');
    section.classList.remove('hidden');

    document.getElementById('activeTimerType').textContent = 'Breastfeeding';
    document.getElementById('activeTimerSide').textContent = state.activeTimer.side?.toUpperCase() || '';

    updateTimerDisplay();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimerDisplay, 1000);
}

function hideActiveTimer() {
    const section = document.getElementById('activeTimerSection');
    section.classList.add('hidden');
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function updateTimerDisplay() {
    if (!state.activeTimer) return;

    const now = Date.now();
    let elapsed;

    if (state.activeTimer.isPaused) {
        elapsed = state.activeTimer.pauseStartTime - state.activeTimer.startTime - (state.activeTimer.totalPausedMs || 0);
        document.getElementById('pauseTimerBtn').textContent = 'Resume';
        document.getElementById('pauseTimerBtn').classList.add('resuming');
    } else {
        elapsed = now - state.activeTimer.startTime - (state.activeTimer.totalPausedMs || 0);
        document.getElementById('pauseTimerBtn').textContent = 'Pause';
        document.getElementById('pauseTimerBtn').classList.remove('resuming');
    }

    document.getElementById('activeTimerDisplay').textContent = formatTimerDuration(Math.max(0, elapsed));
}

// ===== Active Sleep Banner =====
let sleepInterval = null;

function showActiveSleepBanner() {
    const banner = document.getElementById('activeSleepBanner');
    banner.classList.remove('hidden');

    document.body.style.paddingTop = '80px';

    updateSleepBannerDisplay();
    if (sleepInterval) clearInterval(sleepInterval);
    sleepInterval = setInterval(updateSleepBannerDisplay, 1000);
}

function hideActiveSleepBanner() {
    const banner = document.getElementById('activeSleepBanner');
    banner.classList.add('hidden');
    document.body.style.paddingTop = '0';
    if (sleepInterval) {
        clearInterval(sleepInterval);
        sleepInterval = null;
    }
}

function updateSleepBannerDisplay() {
    if (!state.activeSleep) return;

    const now = Date.now();
    let elapsed;

    if (state.activeSleep.isPaused) {
        elapsed = state.activeSleep.pauseStartTime - state.activeSleep.startTime - (state.activeSleep.totalPausedMs || 0);
        document.getElementById('pauseSleepBtn').textContent = 'Resume';
        document.getElementById('pauseSleepBtn').classList.add('resuming');
    } else {
        elapsed = now - state.activeSleep.startTime - (state.activeSleep.totalPausedMs || 0);
        document.getElementById('pauseSleepBtn').textContent = 'Pause';
        document.getElementById('pauseSleepBtn').classList.remove('resuming');
    }

    document.getElementById('sleepBannerTime').textContent = formatTimerDuration(Math.max(0, elapsed));
}

// ===== Breastfeeding =====
function initBreastfeeding() {
    document.getElementById('startBreastfeeding').addEventListener('click', () => {
        if (state.activeTimer) {
            showToast('Please stop current timer first');
            return;
        }
        openModal('breastfeedingModal');
    });

    document.getElementById('confirmBreastfeeding').addEventListener('click', async () => {
        const side = document.querySelector('.side-selector .side-btn.active')?.dataset.side || 'left';
        const notes = document.getElementById('breastfeedingNotes').value;

        const feeding = {
            id: generateId(),
            type: 'breast',
            startTime: Date.now(),
            endTime: null,
            side: side,
            notes: notes || null
        };

        // Optimistic UI update handled by listener... but wait, listener is fast. 
        // We just save.
        saveDoc(COLLECTIONS.feedings, feeding)
            .then(() => showToast('Breastfeeding started'));

        closeModal('breastfeedingModal');
        document.getElementById('breastfeedingNotes').value = '';
    });

    document.getElementById('switchSideBtn').addEventListener('click', async () => {
        if (!state.activeTimer) return;

        const sides = ['left', 'right', 'both'];
        const currentIndex = sides.indexOf(state.activeTimer.side);
        const newSide = sides[(currentIndex + 1) % 3];

        const updated = { ...state.activeTimer, side: newSide };
        await saveDoc(COLLECTIONS.feedings, updated);
        showToast(`Switched to ${newSide}`);
    });

    document.getElementById('stopTimerBtn').addEventListener('click', async () => {
        if (!state.activeTimer) return;

        const now = Date.now();
        const feeding = { ...state.activeTimer };

        if (feeding.isPaused) {
            // If stopped while paused, don't add more pause time, just use the pauseStartTime as endTime
            feeding.endTime = feeding.pauseStartTime;
        } else {
            feeding.endTime = now;
        }

        // Calculate final duration for the toast
        const totalDuration = feeding.endTime - feeding.startTime - (feeding.totalPausedMs || 0);

        await saveDoc(COLLECTIONS.feedings, feeding);
        showToast(`Feeding saved: ${formatDuration(totalDuration)}`);
    });

    document.getElementById('pauseTimerBtn').addEventListener('click', async () => {
        if (!state.activeTimer) return;

        const now = Date.now();
        const updated = { ...state.activeTimer };

        if (updated.isPaused) {
            // Resume
            updated.totalPausedMs = (updated.totalPausedMs || 0) + (now - updated.pauseStartTime);
            updated.isPaused = false;
            updated.pauseStartTime = null;
        } else {
            // Pause
            updated.isPaused = true;
            updated.pauseStartTime = now;
        }

        await saveDoc(COLLECTIONS.feedings, updated);
    });
}

// ===== Bottle =====
function initBottle() {
    // Top-level Bottle action opens the choice modal
    document.getElementById('logBottle').addEventListener('click', () => {
        openModal('bottleChoiceModal');
    });

    // Handle "Breast Milk" choice
    document.getElementById('choiceBreastMilk').addEventListener('click', () => {
        closeModal('bottleChoiceModal');
        document.getElementById('bottleTime').value = getLocalDateTimeString();
        openModal('bottleModal');
    });

    // Handle "Formula" choice
    document.getElementById('choiceFormula').addEventListener('click', () => {
        closeModal('bottleChoiceModal');
        document.getElementById('formulaTime').value = getLocalDateTimeString();
        openModal('formulaModal');
    });

    document.getElementById('confirmBottle').addEventListener('click', async () => {
        const amount = parseInt(document.getElementById('bottleAmount').value) || 0;
        const time = new Date(document.getElementById('bottleTime').value).getTime();
        const notes = document.getElementById('bottleNotes').value;

        const feeding = {
            id: generateId(),
            type: 'bottle',
            subtype: 'breast_milk',
            startTime: time,
            endTime: time,
            amount: amount,
            notes: notes || null
        };

        await saveDoc(COLLECTIONS.feedings, feeding);
        closeModal('bottleModal');

        document.getElementById('bottleAmount').value = 60;
        document.getElementById('bottleNotes').value = '';

        showToast(`Bottle saved: ${amount}ml`);
    });
}

// ===== Formula =====
function initFormula() {
    // Note: logFormula button is removed from main UI, but the modal logic remains for the choice flow

    document.getElementById('confirmFormula').addEventListener('click', async () => {
        const amount = parseInt(document.getElementById('formulaAmount').value) || 0;
        const brand = document.getElementById('formulaBrand').value;
        const time = new Date(document.getElementById('formulaTime').value).getTime();
        const notes = document.getElementById('formulaNotes').value;

        const feeding = {
            id: generateId(),
            type: 'bottle',
            subtype: 'formula',
            startTime: time,
            endTime: time,
            amount: amount,
            brand: brand || null,
            notes: notes || null
        };

        await saveDoc(COLLECTIONS.feedings, feeding);
        closeModal('formulaModal');

        document.getElementById('formulaAmount').value = 60;
        document.getElementById('formulaBrand').value = '';
        document.getElementById('formulaNotes').value = '';

        showToast(`Formula saved: ${amount}ml`);
    });
}

// ===== Vitamins =====
function initVitamin() {
    document.getElementById('logVitamin').addEventListener('click', () => {
        document.getElementById('vitaminTime').value = getLocalDateTimeString();
        openModal('vitaminModal');
    });

    document.getElementById('confirmVitamin').addEventListener('click', async () => {
        const name = document.getElementById('vitaminName').value ||
            document.querySelector('#vitaminModal .choice-btn.active')?.dataset.vitamin ||
            'Vitamin';
        const time = new Date(document.getElementById('vitaminTime').value).getTime();
        const notes = document.getElementById('vitaminNotes').value;

        const entry = {
            id: generateId(),
            type: 'vitamin',
            startTime: time,
            endTime: time,
            name: name,
            notes: notes || null
        };

        await saveDoc(COLLECTIONS.feedings, entry); // Log vitamins in feedings for now (daily journal)
        closeModal('vitaminModal');

        // Reset
        document.getElementById('vitaminName').value = '';
        document.getElementById('vitaminNotes').value = '';

        showToast(`${name} logged`);
    });
}

// ===== Sleep =====
function initSleep() {
    document.getElementById('startSleep').addEventListener('click', () => {
        if (state.activeSleep) {
            showToast('Baby is already sleeping');
            return;
        }
        openModal('sleepModal');
    });

    document.getElementById('confirmSleep').addEventListener('click', async () => {
        const type = document.querySelector('.sleep-type-selector .sleep-type-btn.active')?.dataset.type || 'nap';
        const location = document.getElementById('sleepLocation').value;

        const sleep = {
            id: generateId(),
            startTime: Date.now(),
            endTime: null,
            type: type,
            location: location || null
        };

        await saveDoc(COLLECTIONS.sleeps, sleep);

        closeModal('sleepModal');
        document.getElementById('sleepLocation').value = '';

        showToast('Sleep started');
    });

    document.getElementById('wakeUpBtn').addEventListener('click', async () => {
        if (!state.activeSleep) return;

        const now = Date.now();
        const sleep = { ...state.activeSleep };

        if (sleep.isPaused) {
            sleep.endTime = sleep.pauseStartTime;
        } else {
            sleep.endTime = now;
        }

        const totalDuration = sleep.endTime - sleep.startTime - (sleep.totalPausedMs || 0);

        await saveDoc(COLLECTIONS.sleeps, sleep);
        showToast(`Sleep saved: ${formatDuration(totalDuration)}`);
    });

    document.getElementById('pauseSleepBtn').addEventListener('click', async () => {
        if (!state.activeSleep) return;

        const now = Date.now();
        const updated = { ...state.activeSleep };

        if (updated.isPaused) {
            updated.totalPausedMs = (updated.totalPausedMs || 0) + (now - updated.pauseStartTime);
            updated.isPaused = false;
            updated.pauseStartTime = null;
        } else {
            updated.isPaused = true;
            updated.pauseStartTime = now;
        }

        await saveDoc(COLLECTIONS.sleeps, updated);
    });
}


function formatDateForHeader(date) {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric' });

    if (d.toDateString() === today.toDateString()) {
        return { title: 'Today', subtitle: datePart };
    }
    if (d.toDateString() === yesterday.toDateString()) {
        return { title: 'Yesterday', subtitle: datePart };
    }
    if (d.toDateString() === tomorrow.toDateString()) {
        return { title: 'Tomorrow', subtitle: datePart };
    }

    return {
        title: d.toLocaleDateString([], { weekday: 'long' }),
        subtitle: datePart
    };
}

// ===== Feeding Log =====
function renderFeedingLog() {
    const date = state.currentFeedingDate;
    const startOfDay = getStartOfDay(date).getTime();
    const endOfDay = getEndOfDay(date).getTime();

    const { title, subtitle } = formatDateForHeader(date);
    const display = document.getElementById('feedingDateDisplay');
    if (display) {
        display.querySelector('.date-title').textContent = title;
        display.querySelector('.date-subtitle').textContent = subtitle;
    }

    // Listeners already keep state.feedings up to date
    const feedings = state.feedings
        .filter(f => f.startTime >= startOfDay && f.startTime <= endOfDay);

    const list = document.getElementById('feedingLogList');

    if (feedings.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🍼</div>
                <p>No feedings logged</p>
                <p class="empty-hint">Tap + to add one</p>
            </div>
        `;
        return;
    }

    list.innerHTML = feedings.map(f => {
        let iconSvg = '';
        let iconClass = '';
        let title = '';
        let subtitle = '';

        if (f.type === 'breast') {
            iconClass = 'breast';
            title = 'Nursing';
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21a9 9 0 0 1-9-9c0-3.87 2.4-7.1 5.7-8.4C9.6 3.2 10.8 3 12 3c1.2 0 2.4.2 3.3.6C18.6 4.9 21 8.1 21 12c0 .5-.1 1-.2 1.5"/><path d="M12 21a9.01 9.01 0 0 0 9-9"/><path d="M12 21v-9"/><path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>`;
            if (f.side) subtitle = `${f.side.charAt(0).toUpperCase() + f.side.slice(1)} side`;
        } else if (f.type === 'bottle') {
            iconClass = 'bottle';
            title = 'Bottle';
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 2v2"/><path d="M15 2v2"/><path d="M12 2v2"/><rect x="7" y="4" width="10" height="16" rx="2"/><path d="M7 9h10"/><path d="M7 14h10"/></svg>`;
            subtitle = `${f.amount}ml`;
            if (f.subtype === 'formula') {
                title = 'Formula';
                iconClass = 'formula'; // Use formula color style
                if (f.brand) subtitle += ` • ${f.brand}`;
            } else if (f.subtype === 'breast_milk') {
                title = 'Breast Milk';
            }
            // Fallback for old data or generic bottle
        } else if (f.type === 'formula') {
            // Mapping old formula type to new look (same as bottle with formula subtype)
            iconClass = 'formula';
            title = 'Formula';
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 2v2"/><path d="M15 2v2"/><path d="M12 2v2"/><rect x="7" y="4" width="10" height="16" rx="2"/><path d="M7 9h10"/><path d="M7 14h10"/></svg>`;
            subtitle = `${f.amount}ml`;
            if (f.brand) subtitle += ` • ${f.brand}`;
        } else if (f.type === 'vitamin') {
            iconClass = 'vitamin';
            title = 'Vitamin';
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a5 5 0 0 1 5 5v10a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"/><path d="M8 7h8"/><path d="M12 17v-4"/><path d="M10 13h4"/></svg>`;
            subtitle = f.notes || '';
        }

        const duration = f.endTime && f.type === 'breast' ? formatDuration(f.endTime - f.startTime) : '';

        return `
            <div class="log-item" data-id="${f.id}" data-type="feeding">
                <div class="log-icon ${iconClass}">
                    ${iconSvg}
                </div>
                <div class="log-details">
                    <div class="log-title">${title}</div>
                    <div class="log-subtitle">${subtitle}</div>
                </div>
                <div class="log-time">
                    <span class="log-time-main">${formatTime(f.startTime)}</span>
                    ${duration ? `<span class="log-time-duration">${duration}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers for editing
    list.querySelectorAll('.log-item').forEach(item => {
        item.addEventListener('click', () => openEditFeedingModal(item.dataset.id));
    });
}

function initFeedingLog() {
    document.getElementById('feedingPrevDay').addEventListener('click', () => {
        state.currentFeedingDate.setDate(state.currentFeedingDate.getDate() - 1);
        renderFeedingLog();
    });

    document.getElementById('feedingNextDay').addEventListener('click', () => {
        state.currentFeedingDate.setDate(state.currentFeedingDate.getDate() + 1);
        renderFeedingLog();
    });

    document.getElementById('addFeedingBtn').addEventListener('click', () => {
        document.getElementById('bottleTime').value = getLocalDateTimeString();
        openModal('bottleModal');
    });
}

async function openEditFeedingModal(id) {
    const feeding = state.feedings.find(f => f.id === id);
    if (!feeding) return;

    state.editingId = id;

    const body = document.getElementById('editFeedingBody');
    const isBreast = feeding.type === 'breast';

    body.innerHTML = `
        <div class="form-group">
            <label>Type</label>
            <input type="text" value="${feeding.type === 'breast' ? 'Breastfeeding' : feeding.type === 'bottle' ? 'Bottle' : 'Formula'}" disabled>
        </div>
        ${isBreast ? `
            <div class="form-group">
                <label>Side</label>
                <select id="editFeedingSide">
                    <option value="left" ${feeding.side === 'left' ? 'selected' : ''}>Left</option>
                    <option value="right" ${feeding.side === 'right' ? 'selected' : ''}>Right</option>
                    <option value="both" ${feeding.side === 'both' ? 'selected' : ''}>Both</option>
                </select>
            </div>
        ` : `
            <div class="form-group">
                <label>Amount (ml)</label>
                <input type="number" id="editFeedingAmount" value="${feeding.amount || 0}">
            </div>
        `}
        <div class="form-group">
            <label>Start Time</label>
            <input type="datetime-local" id="editFeedingStart" value="${getLocalDateTimeString(feeding.startTime)}">
        </div>
        ${isBreast && feeding.endTime ? `
            <div class="form-group">
                <label>End Time</label>
                <input type="datetime-local" id="editFeedingEnd" value="${getLocalDateTimeString(feeding.endTime)}">
            </div>
        ` : ''}
        <div class="form-group">
            <label>Notes</label>
            <textarea id="editFeedingNotes">${feeding.notes || ''}</textarea>
        </div>
    `;

    openModal('editFeedingModal');
}

function initEditFeeding() {
    document.getElementById('saveEditFeeding').addEventListener('click', async () => {
        const feeding = { ...state.feedings.find(f => f.id === state.editingId) };
        if (!feeding) return;

        feeding.startTime = new Date(document.getElementById('editFeedingStart').value).getTime();

        if (feeding.type === 'breast') {
            feeding.side = document.getElementById('editFeedingSide').value;
            const endEl = document.getElementById('editFeedingEnd');
            if (endEl) feeding.endTime = new Date(endEl.value).getTime();
        } else {
            feeding.amount = parseInt(document.getElementById('editFeedingAmount').value) || 0;
        }

        feeding.notes = document.getElementById('editFeedingNotes').value || null;

        await saveDoc(COLLECTIONS.feedings, feeding);
        closeModal('editFeedingModal');
        showToast('Feeding updated');
    });

    document.getElementById('deleteFeedingBtn').addEventListener('click', async () => {
        if (confirm('Delete this feeding entry?')) {
            await removeDoc(COLLECTIONS.feedings, state.editingId);
            closeModal('editFeedingModal');
            showToast('Feeding deleted');
        }
    });
}

// ===== Sleep Log =====
function renderSleepLog() {
    const date = state.currentSleepDate;
    const startOfDay = getStartOfDay(date).getTime();
    const endOfDay = getEndOfDay(date).getTime();

    const { title, subtitle } = formatDateForHeader(date);
    const display = document.getElementById('sleepDateDisplay');
    if (display) {
        display.querySelector('.date-title').textContent = title;
        display.querySelector('.date-subtitle').textContent = subtitle;
    }

    const sleeps = state.sleeps
        .filter(s => s.startTime >= startOfDay && s.startTime <= endOfDay);

    // Calculate total sleep and update bar
    const totalSleepMs = sleeps.reduce((sum, s) => {
        const end = s.endTime || Date.now();
        return sum + (end - s.startTime);
    }, 0);

    const sleepHours = totalSleepMs / 3600000;
    const maxHours = 16;
    const percentage = Math.min((sleepHours / maxHours) * 100, 100);

    document.getElementById('sleepBar').style.width = `${percentage}%`;
    document.getElementById('sleepTotalHours').textContent = `${Math.floor(sleepHours)}h ${Math.floor((sleepHours % 1) * 60)}m`;

    const list = document.getElementById('sleepLogList');

    if (sleeps.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🌙</div>
                <p>No sleep logged</p>
                <p class="empty-hint">Tap + to add one</p>
            </div>
        `;
        return;
    }

    list.innerHTML = sleeps.map(s => {
        let iconSvg = '';
        let iconClass = '';
        let title = '';

        if (s.type === 'nap') {
            iconClass = 'nap';
            title = 'Nap';
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
            // Actually let's use a Sun or Cloud for Nap to distinguish?
            // Or just the same Moon but lighter color is handled by CSS. 
            // Let's use a different icon for Nap to be fancy. A Cloud?
            // <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`;
        } else {
            iconClass = 'night'; // CSS handles color
            title = 'Night Sleep';
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/><path d="M12 4v2"/><path d="M12 18v2"/></svg>`; // Moon with stars/sparkles
        }

        const subtitle = s.location ? s.location.charAt(0).toUpperCase() + s.location.slice(1) : '';
        const duration = s.endTime ? formatDuration(s.endTime - s.startTime) : 'Ongoing...';
        const endTime = s.endTime ? ` - ${formatTime(s.endTime)}` : '';

        return `
            <div class="log-item" data-id="${s.id}" data-type="sleep">
                <div class="log-icon ${iconClass}">
                    ${iconSvg}
                </div>
                <div class="log-details">
                    <div class="log-title">${title}</div>
                    <div class="log-subtitle">${subtitle}</div>
                </div>
                <div class="log-time">
                    <span class="log-time-main">${formatTime(s.startTime)}${endTime}</span>
                    <span class="log-time-duration">${duration}</span>
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.log-item').forEach(item => {
        item.addEventListener('click', () => openEditSleepModal(item.dataset.id));
    });
}

function initSleepLog() {
    document.getElementById('sleepPrevDay').addEventListener('click', () => {
        state.currentSleepDate.setDate(state.currentSleepDate.getDate() - 1);
        renderSleepLog();
    });

    document.getElementById('sleepNextDay').addEventListener('click', () => {
        state.currentSleepDate.setDate(state.currentSleepDate.getDate() + 1);
        renderSleepLog();
    });

    document.getElementById('addSleepBtn').addEventListener('click', () => {
        openModal('sleepModal');
    });
}

async function openEditSleepModal(id) {
    const sleep = state.sleeps.find(s => s.id === id);
    if (!sleep) return;

    state.editingId = id;

    const body = document.getElementById('editSleepBody');
    body.innerHTML = `
        <div class="form-group">
            <label>Type</label>
            <select id="editSleepType">
                <option value="nap" ${sleep.type === 'nap' ? 'selected' : ''}>Nap</option>
                <option value="night" ${sleep.type === 'night' ? 'selected' : ''}>Night Sleep</option>
            </select>
        </div>
        <div class="form-group">
            <label>Start Time</label>
            <input type="datetime-local" id="editSleepStart" value="${getLocalDateTimeString(sleep.startTime)}">
        </div>
        <div class="form-group">
            <label>End Time</label>
            <input type="datetime-local" id="editSleepEnd" value="${sleep.endTime ? getLocalDateTimeString(sleep.endTime) : ''}">
        </div>
        <div class="form-group">
            <label>Location</label>
            <select id="editSleepLocation">
                <option value="">Select location</option>
                <option value="crib" ${sleep.location === 'crib' ? 'selected' : ''}>Crib</option>
                <option value="bassinet" ${sleep.location === 'bassinet' ? 'selected' : ''}>Bassinet</option>
                <option value="stroller" ${sleep.location === 'stroller' ? 'selected' : ''}>Stroller</option>
                <option value="car" ${sleep.location === 'car' ? 'selected' : ''}>Car seat</option>
                <option value="arms" ${sleep.location === 'arms' ? 'selected' : ''}>In arms</option>
                <option value="other" ${sleep.location === 'other' ? 'selected' : ''}>Other</option>
            </select>
        </div>
    `;

    openModal('editSleepModal');
}

function initEditSleep() {
    document.getElementById('saveEditSleep').addEventListener('click', async () => {
        const sleep = { ...state.sleeps.find(s => s.id === state.editingId) };
        if (!sleep) return;

        sleep.type = document.getElementById('editSleepType').value;
        sleep.startTime = new Date(document.getElementById('editSleepStart').value).getTime();
        const endValue = document.getElementById('editSleepEnd').value;
        sleep.endTime = endValue ? new Date(endValue).getTime() : null;
        sleep.location = document.getElementById('editSleepLocation').value || null;

        await saveDoc(COLLECTIONS.sleeps, sleep);
        closeModal('editSleepModal');
        showToast('Sleep updated');
    });

    document.getElementById('deleteSleepBtn').addEventListener('click', async () => {
        if (confirm('Delete this sleep entry?')) {
            await removeDoc(COLLECTIONS.sleeps, state.editingId);
            closeModal('editSleepModal');
            showToast('Sleep deleted');
        }
    });
}

// ===== Settings =====
function initSettings() {
    // Note: State is already loaded via listeners

    // Save baby info
    document.getElementById('saveBabyInfo').addEventListener('click', async () => {
        const baby = {
            id: 'main',
            name: document.getElementById('babyName').value,
            birthDate: document.getElementById('babyBirthDate').value
        };
        await saveDoc(COLLECTIONS.baby, baby);
        showToast('Baby info saved');
        // UI updates automatically via listener
    });

    // Volume unit change
    document.getElementById('volumeUnit').addEventListener('change', async (e) => {
        const settings = {
            id: 'main',
            volumeUnit: e.target.value
        };
        await saveDoc(COLLECTIONS.settings, settings);
        showToast('Settings saved');
    });

    // Export data (Client side generation from state)
    document.getElementById('exportData').addEventListener('click', () => {
        let csv = 'Type,Date,Time,Duration,Amount,Side,Notes\n';

        state.feedings.forEach(f => {
            const date = new Date(f.startTime).toLocaleDateString();
            const time = formatTime(f.startTime);
            const duration = f.endTime ? formatDuration(f.endTime - f.startTime) : '';
            csv += `${f.type},${date},${time},${duration},${f.amount || ''},${f.side || ''},${f.notes || ''}\n`;
        });

        csv += '\nSleep Type,Date,Start Time,End Time,Duration,Location\n';
        state.sleeps.forEach(s => {
            const date = new Date(s.startTime).toLocaleDateString();
            const startTime = formatTime(s.startTime);
            const endTime = s.endTime ? formatTime(s.endTime) : '';
            const duration = s.endTime ? formatDuration(s.endTime - s.startTime) : '';
            csv += `${s.type},${date},${startTime},${endTime},${duration},${s.location || ''}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `baby-tracker-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        showToast('Data exported');
    });

    // Clear data
    document.getElementById('clearData').addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete ALL data? This cannot be undone.')) {
            if (confirm('Really delete everything?')) {
                await clearCollection(COLLECTIONS.feedings);
                await clearCollection(COLLECTIONS.sleeps);
                showToast('All data cleared');
            }
        }
    });
}

// ===== Authentication Logic =====
function initAuth() {
    initAuthForms();

    onAuthStateChanged(auth, (user) => {
        state.user = user;
        if (user) {
            // User is signed in
            console.log("User signed in:", user.email);
            document.getElementById('authContainer').classList.add('hidden');
            document.getElementById('app').classList.remove('hidden');

            // Update profile info
            const emailDisplay = document.getElementById('userEmailDisplay');
            if (emailDisplay) emailDisplay.textContent = user.email;

            initListeners(); // Start listening to user's data
        } else {
            // User is signed out
            console.log("User signed out");
            document.getElementById('authContainer').classList.remove('hidden');
            document.getElementById('app').classList.add('hidden');
            initListeners(); // This will clear the state because !state.user
        }
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        if (confirm('Are you sure you want to log out?')) {
            signOut(auth).then(() => {
                showToast('Logged out');
            }).catch((error) => {
                showToast('Error logging out');
                console.error(error);
            });
        }
    });
}

function initAuthForms() {
    const loginScreen = document.getElementById('loginScreen');
    const signupScreen = document.getElementById('signupScreen');
    const showSignup = document.getElementById('showSignup');
    const showLogin = document.getElementById('showLogin');

    // Toggle screens
    showSignup.addEventListener('click', () => {
        loginScreen.classList.remove('active');
        signupScreen.classList.add('active');
    });

    showLogin.addEventListener('click', () => {
        signupScreen.classList.remove('active');
        loginScreen.classList.add('active');
    });

    // Login Form
    document.getElementById('loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        signInWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                showToast('Welcome back!');
            })
            .catch((error) => {
                const errorCode = error.code;
                const errorMessage = error.message;
                console.error("Login Error", errorCode, errorMessage);
                if (errorCode === 'auth/invalid-credential') {
                    showToast('Invalid email or password');
                } else if (errorCode === 'auth/invalid-email') {
                    showToast('Invalid email format');
                } else {
                    showToast('Login failed: ' + errorMessage);
                }
            });
    });

    // Signup Form
    document.getElementById('signupForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;

        if (password.length < 6) {
            showToast('Password must be at least 6 characters');
            return;
        }

        createUserWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                showToast('Account created!');
            })
            .catch((error) => {
                const errorCode = error.code;
                const errorMessage = error.message;
                console.error("Signup Error", errorCode, errorMessage);
                if (errorCode === 'auth/email-already-in-use') {
                    showToast('Email already in use');
                } else if (errorCode === 'auth/weak-password') {
                    showToast('Password is too weak');
                } else {
                    showToast('Signup failed: ' + errorMessage);
                }
            });
    });
}

// ===== Initialize App =====
async function init() {
    try {
        // initAuth handles the listeners now
        initAuth();

        initNavigation();
        initModals();
        initSelectors();
        initAmountButtons();

        initBreastfeeding();
        initBottle();
        initFormula();
        initVitamin();
        initSleep();

        initFeedingLog();
        initSleepLog();
        initEditFeeding();
        initEditSleep();

        initSettings();

        // Initial render will happen when listeners fire
        console.log('Baby Tracker initialized successfully');
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showToast('Error loading app. Please refresh.');
    }
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
