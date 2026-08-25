import { initializeApp } from "./vendor/firebase/firebase-app.js";
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
} from "./vendor/firebase/firebase-firestore.js";
import {
    initializeAuth,
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    setPersistence,
    indexedDBLocalPersistence,
    browserLocalPersistence,
    inMemoryPersistence,
    signOut,
    onAuthStateChanged
} from "./vendor/firebase/firebase-auth.js";

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

const isNativeRuntime = (() => {
    if (typeof window === 'undefined') return false;
    if (window.location?.protocol === 'capacitor:') return true;
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
})();

const auth = isNativeRuntime
    ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
    : getAuth(app);

function isNativeCapacitorApp() {
    if (typeof window === 'undefined') return false;
    if (window.location?.protocol === 'capacitor:') return true;
    return isNativeRuntime || !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
}

async function configureAuthPersistence() {
    const timeoutMs = 2500;
    const withTimeout = (promise) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('auth-persistence-timeout')), timeoutMs))
    ]);

    try {
        await withTimeout(setPersistence(auth, indexedDBLocalPersistence));
    } catch (error) {
        console.warn('IndexedDB auth persistence unavailable, trying browser local:', error);
        try {
            await withTimeout(setPersistence(auth, browserLocalPersistence));
        } catch (fallbackError) {
            console.warn('Browser local persistence unavailable, using memory persistence:', fallbackError);
            try {
                await withTimeout(setPersistence(auth, inMemoryPersistence));
            } catch (memoryError) {
                console.warn('Could not set auth persistence:', memoryError);
            }
        }
    }
}

function withAuthRequestTimeout(promise, timeoutMs = 12000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject({ code: 'auth/request-timeout', message: 'Authentication request timed out' }), timeoutMs))
    ]);
}

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
    solids: 'solids',
    sleeps: 'sleeps',
    settings: 'settings'
};

// Mirror the theme locally so a cold start paints the right palette immediately
// instead of flashing the system default until settings arrive from Firestore.
const THEME_STORAGE_KEY = 'babyTracker.theme';

try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'light' || storedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', storedTheme);
    }
} catch (error) {
    // Private mode or blocked storage: fall back to the system palette.
}

const APP_VERSION = 'v1.1.0';

const DEFAULT_SETTINGS = {
    volumeUnit: 'ml',
    notificationsEnabled: false,
    liveActivityEnabled: true,
    awakeAlertEnabled: true,
    awakeAlertMinutes: 60,
    napAlertEnabled: true,
    napAlertMinutes: 140,
    nightSleepAlertEnabled: false,
    nightSleepAlertMinutes: 240,
    theme: 'system'
};

const SOLID_FOOD_MEAL_TYPES = {
    breakfast: 'Breakfast',
    lunch: 'Lunch',
    dinner: 'Dinner',
    snack: 'Snack',
    first_taste: 'First taste'
};

const SOLID_FOOD_INTAKE_LEVELS = {
    refused: 'Refused',
    tasted: 'Tasted',
    some: 'Some',
    most: 'Most',
    all: 'All'
};

const SOLID_FOOD_TEXTURES = {
    puree: 'Puree',
    mashed: 'Mashed',
    soft_pieces: 'Soft pieces',
    finger_food: 'Finger food',
    mixed: 'Mixed'
};

const ICON_SPRITE_PATH = 'phosphor-icons.svg';

// ===== State =====
// We keep a local copy of data synced from Firestore
const state = {
    user: null,
    baby: null,
    settings: { ...DEFAULT_SETTINGS },
    feedings: [],
    solids: [],
    sleeps: [],
    activeTimer: null,
    activeSleep: null,
    currentFeedingDate: new Date(),
    currentFoodDate: new Date(),
    currentSleepDate: new Date(),
    editingId: null
};

const notificationRuntime = {
    awakeSessionKey: null,
    awakeNotified: false,
    sleepNotifiedById: {}
};

let notificationCheckInterval = null;
let pendingNotificationAction = null;

let nativeTimerLiveActivity = null;

function getNativeTimerLiveActivityPlugin() {
    if (nativeTimerLiveActivity) return nativeTimerLiveActivity;
    if (typeof window === 'undefined') return null;

    // Method 1: Capacitor.registerPlugin (standard)
    if (window.Capacitor && typeof window.Capacitor.registerPlugin === 'function') {
        try {
            nativeTimerLiveActivity = window.Capacitor.registerPlugin('TimerLiveActivity');
            console.log('[NativeBridge] Plugin registered via registerPlugin');
            return nativeTimerLiveActivity;
        } catch (e) {
            console.warn('[NativeBridge] registerPlugin failed:', e);
        }
    }

    // Method 2: Capacitor.Plugins object (some Capacitor versions)
    if (window.Capacitor?.Plugins?.TimerLiveActivity) {
        nativeTimerLiveActivity = window.Capacitor.Plugins.TimerLiveActivity;
        console.log('[NativeBridge] Plugin found via Capacitor.Plugins');
        return nativeTimerLiveActivity;
    }

    // Method 3: Direct global (fallback)
    if (window.TimerLiveActivity) {
        nativeTimerLiveActivity = window.TimerLiveActivity;
        console.log('[NativeBridge] Plugin found via window.TimerLiveActivity');
        return nativeTimerLiveActivity;
    }

    console.warn('[NativeBridge] No plugin access method succeeded.',
        'Capacitor exists:', !!window.Capacitor,
        'registerPlugin:', typeof window.Capacitor?.registerPlugin,
        'Plugins:', !!window.Capacitor?.Plugins,
        'isNativePlatform:', typeof window.Capacitor?.isNativePlatform === 'function' ? window.Capacitor.isNativePlatform() : 'N/A'
    );
    return null;
}

const nativeCapabilities = {
    loaded: false,
    isNativeIOS: false,
    supportsLiveActivities: false,
    supportsNativeNotifications: false,
    supportsCsvShare: false
};

const nativeNotificationState = {
    permission: 'default',
    loaded: false
};

let lastNativeCommandPollAt = 0;

async function loadNativeCapabilities() {
    const plugin = getNativeTimerLiveActivityPlugin();
    if (!isNativeCapacitorApp() || !plugin) return;
    try {
        const result = await plugin.getPlatformCapabilities();
        nativeCapabilities.loaded = true;
        nativeCapabilities.isNativeIOS = !!result?.isNativeIOS;
        nativeCapabilities.supportsLiveActivities = !!result?.supportsLiveActivities;
        nativeCapabilities.supportsNativeNotifications = result?.supportsNativeNotifications !== false;
        nativeCapabilities.supportsCsvShare = !!result?.supportsCsvShare;
    } catch (error) {
        console.warn('Native capabilities unavailable:', error);
    }
}

function getFeedingElapsedMs(feeding) {
    if (!feeding) return 0;
    const now = Date.now();
    const referenceEnd = feeding.isPaused ? feeding.pauseStartTime : (feeding.endTime || now);
    return Math.max(0, referenceEnd - feeding.startTime - (feeding.totalPausedMs || 0));
}

// Track last synced Live Activity state to avoid redundant updates
let lastLiveActivitySyncKey = '';

function getActiveLiveSession() {
    if (state.activeTimer) {
        return {
            session: state.activeTimer,
            collection: COLLECTIONS.feedings,
            kind: 'breast',
            label: 'Feeding',
            title: `Breastfeeding ${state.activeTimer.side?.toUpperCase() || ''}`.trim()
        };
    }
    if (state.activeSleep) {
        return {
            session: state.activeSleep,
            collection: COLLECTIONS.sleeps,
            kind: state.activeSleep.type || 'sleep',
            label: 'Sleep',
            title: state.activeSleep.type === 'nap' ? 'Nap Timer' : 'Night Sleep'
        };
    }
    return null;
}

// When this side last changed the session. Sessions created before the field existed
// fall back to their start time, which is always older than any Live Activity press.
function sessionUpdatedAt(session) {
    return session.updatedAt || session.startTime || 0;
}

async function syncNativeLiveActivity() {
    const plugin = getNativeTimerLiveActivityPlugin();
    if (!isNativeCapacitorApp()) return;
    if (!plugin) return;
    if (!state.settings.liveActivityEnabled) {
        if (lastLiveActivitySyncKey !== '') {
            try { await plugin.stop(); } catch (error) { console.warn(error); }
            lastLiveActivitySyncKey = '';
        }
        return;
    }
    if (!nativeCapabilities.supportsLiveActivities) return;

    try {
        const active = getActiveLiveSession();

        // No active timer — stop Live Activity if one was running
        if (!active) {
            if (lastLiveActivitySyncKey !== '') {
                await plugin.stop();
                lastLiveActivitySyncKey = '';
            }
            return;
        }

        const { session, kind, title } = active;
        const pausedAtMs = session.isPaused ? session.pauseStartTime : null;
        const totalPausedMs = session.totalPausedMs || 0;
        const syncKey = `${kind}:${session.id}:${pausedAtMs}:${totalPausedMs}`;
        if (syncKey === lastLiveActivitySyncKey) return;

        // No guard flags here any more. `updatedAtMs` settles it: a push carrying an
        // older stamp than the Live Activity's own state is refused natively, so a
        // stale sync from a render path can no longer undo a button press.
        await plugin.startOrUpdate({
            sessionId: session.id,
            timerKind: kind,
            title: title,
            startTimestamp: session.startTime,
            totalPausedMs: totalPausedMs,
            pausedAtMs: pausedAtMs,
            updatedAtMs: sessionUpdatedAt(session)
        });
        lastLiveActivitySyncKey = syncKey;
    } catch (error) {
        console.warn('Native Live Activity sync failed:', error);
    }
}

// Pull the Live Activity's own state and adopt it when it is newer than ours.
//
// This replaces replaying a "toggle" command. A toggle had to arrive exactly once to
// be correct, and it travelled through a single-slot mailbox that dropped one of two
// quick taps — after which the app's idea of paused disagreed with the screen for the
// rest of the session. An absolute snapshot is idempotent.
async function reconcileFromLiveActivity() {
    const plugin = getNativeTimerLiveActivityPlugin();
    if (!isNativeCapacitorApp()) return;
    if (!plugin) return;
    if (!nativeCapabilities.supportsLiveActivities) return;

    const now = Date.now();
    if (now - lastNativeCommandPollAt < 800) return;
    lastNativeCommandPollAt = now;

    try {
        const snap = await plugin.fetchLiveState();
        if (!snap?.hasState) return;
        if (snap.source !== 'intent') return;

        const active = getActiveLiveSession();
        if (!active || active.session.id !== snap.sessionId) return;
        if (!(snap.updatedAtMs > sessionUpdatedAt(active.session))) return;

        const updated = { ...active.session, updatedAt: snap.updatedAtMs };

        if (snap.stopped) {
            // End where the counter actually stood, not where this side thinks it is.
            updated.endTime = Math.round(snap.pausedAtMs ?? snap.stoppedAtMs ?? snap.updatedAtMs);
            updated.isPaused = false;
            updated.pauseStartTime = null;
            await saveDoc(active.collection, updated);
            lastLiveActivitySyncKey = '';
            const total = updated.endTime - updated.startTime - (updated.totalPausedMs || 0);
            showToast(`${active.label} saved: ${formatDuration(total)}`);
            return;
        }

        updated.totalPausedMs = Math.round(snap.totalPausedMs || 0);
        updated.isPaused = snap.pausedAtMs != null;
        updated.pauseStartTime = snap.pausedAtMs != null ? Math.round(snap.pausedAtMs) : null;
        await saveDoc(active.collection, updated);
        lastLiveActivitySyncKey = '';
    } catch (error) {
        console.warn('Live Activity state reconcile failed:', error);
    }
}

function clampMinutes(value, fallback) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(1440, Math.max(1, parsed));
}

function normalizeSettings(settings = {}) {
    return {
        ...DEFAULT_SETTINGS,
        ...settings,
        volumeUnit: settings.volumeUnit === 'oz' ? 'oz' : 'ml',
        notificationsEnabled: !!settings.notificationsEnabled,
        liveActivityEnabled: settings.liveActivityEnabled !== false,
        awakeAlertEnabled: settings.awakeAlertEnabled !== false,
        awakeAlertMinutes: clampMinutes(settings.awakeAlertMinutes, DEFAULT_SETTINGS.awakeAlertMinutes),
        napAlertEnabled: settings.napAlertEnabled !== false,
        napAlertMinutes: clampMinutes(settings.napAlertMinutes, DEFAULT_SETTINGS.napAlertMinutes),
        nightSleepAlertEnabled: !!settings.nightSleepAlertEnabled,
        nightSleepAlertMinutes: clampMinutes(settings.nightSleepAlertMinutes, DEFAULT_SETTINGS.nightSleepAlertMinutes),
        theme: ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'system'
    };
}

async function saveUserSettings(partialSettings) {
    const settings = {
        id: 'main',
        ...normalizeSettings({
            ...state.settings,
            ...partialSettings
        })
    };
    await saveDoc(COLLECTIONS.settings, settings);
}

function getNotificationPermission() {
    if (isNativeCapacitorApp()) {
        return nativeNotificationState.loaded ? nativeNotificationState.permission : 'default';
    }
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
}

function supportsNativeNotificationBridge() {
    const plugin = getNativeTimerLiveActivityPlugin();
    return !!(
        isNativeCapacitorApp() &&
        plugin &&
        (nativeCapabilities.supportsNativeNotifications || !nativeCapabilities.loaded)
    );
}

async function refreshNotificationPermission() {
    // Try native plugin first
    if (isNativeCapacitorApp()) {
        const plugin = getNativeTimerLiveActivityPlugin();
        if (plugin) {
            try {
                const result = await plugin.getNotificationPermission();
                nativeNotificationState.permission = result?.status || 'default';
                nativeNotificationState.loaded = true;
                return nativeNotificationState.permission;
            } catch (error) {
                console.warn('Failed to read native notification permission:', error);
            }
        }
        // If native fails, don't override with 'unsupported' — keep default
        if (!nativeNotificationState.loaded) {
            nativeNotificationState.permission = 'default';
            nativeNotificationState.loaded = true;
        }
        return nativeNotificationState.permission;
    }

    // Web fallback
    const permission = getNotificationPermission();
    nativeNotificationState.permission = permission;
    nativeNotificationState.loaded = true;
    return permission;
}

async function requestNotificationPermission() {
    // Strategy 1: Native Capacitor plugin (iOS/Android)
    if (isNativeCapacitorApp()) {
        const plugin = getNativeTimerLiveActivityPlugin();
        if (plugin) {
            try {
                const result = await plugin.requestNotificationPermission();
                const permission = result?.status || 'default';
                nativeNotificationState.permission = permission;
                nativeNotificationState.loaded = true;
                const enabled = permission === 'granted';
                await saveUserSettings({ notificationsEnabled: enabled });
                showToast(enabled ? 'Notifications enabled' : 'Notifications denied — check iOS Settings');
                return enabled;
            } catch (error) {
                console.warn('Native notification permission request failed:', error);
                // Fall through to web API
            }
        } else {
            console.warn('[Notifications] Native plugin not available, trying web API fallback');
        }
    }

    // Strategy 2: Web Notification API
    if ('Notification' in window) {
        try {
            const permission = await Notification.requestPermission();
            const enabled = permission === 'granted';
            nativeNotificationState.permission = permission;
            nativeNotificationState.loaded = true;
            await saveUserSettings({ notificationsEnabled: enabled });
            showToast(enabled ? 'Notifications enabled' : 'Notifications not enabled');
            return enabled;
        } catch (error) {
            console.warn('Web Notification.requestPermission failed:', error);
        }
    }

    // Strategy 3: Just save the toggle and let the engine check permission at send time
    await saveUserSettings({ notificationsEnabled: true });
    showToast('Notifications preference saved');
    return true;
}

async function showSystemNotification(title, body, tag, data = {}) {
    if (!state.settings.notificationsEnabled) return;

    // Try native first
    if (isNativeCapacitorApp()) {
        const plugin = getNativeTimerLiveActivityPlugin();
        if (plugin) {
            try {
                const permission = await refreshNotificationPermission();
                if (permission !== 'granted') return;
                await plugin.sendLocalNotification({ title, body, tag, data });
                return;
            } catch (error) {
                console.warn('Native local notification failed:', error);
            }
        }
    }

    // Web fallback
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const options = {
        body,
        tag,
        data,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png'
    };

    if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, options);
    } else {
        new Notification(title, options);
    }
}

async function closeSystemNotificationsByTag(tag) {
    if (isNativeCapacitorApp()) {
        const plugin = getNativeTimerLiveActivityPlugin();
        if (plugin) {
            try {
                await plugin.clearLocalNotification({ tag });
                return;
            } catch (error) {
                console.warn('Native local notification clear failed:', error);
            }
        }
    }

    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const notifications = await registration.getNotifications({ tag });
    notifications.forEach(notification => notification.close());
}

async function updateActiveSessionNotification() {
    if (isNativeCapacitorApp()) return;

    if (!state.settings.notificationsEnabled || !state.settings.liveActivityEnabled) {
        await closeSystemNotificationsByTag('active-session');
        return;
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    if (!state.activeTimer && !state.activeSleep) {
        await closeSystemNotificationsByTag('active-session');
        return;
    }

    let title = 'Baby Tracker';
    let body = 'Timer is running';
    let actions = [];
    let data = { type: 'active-session' };

    if (state.activeTimer) {
        const timer = state.activeTimer;
        const elapsedMs = getEffectiveSleepElapsedMs({
            startTime: timer.startTime,
            endTime: timer.endTime,
            isPaused: timer.isPaused,
            pauseStartTime: timer.pauseStartTime,
            totalPausedMs: timer.totalPausedMs
        });
        title = 'Breastfeeding timer running';
        body = `Elapsed ${formatTimerDuration(elapsedMs)} (${(timer.side || 'left').toUpperCase()})`;
        actions = [
            { action: 'toggle-breast-pause', title: timer.isPaused ? 'Resume' : 'Pause' },
            { action: 'stop-breast', title: 'Stop' }
        ];
        data = { type: 'active-breast', timerId: timer.id };
    } else if (state.activeSleep) {
        const sleep = state.activeSleep;
        const elapsedMs = getEffectiveSleepElapsedMs(sleep);
        title = `${sleep.type === 'nap' ? 'Nap' : 'Sleep'} timer running`;
        body = `Elapsed ${formatTimerDuration(elapsedMs)}`;
        actions = [
            { action: 'toggle-sleep-pause', title: sleep.isPaused ? 'Resume' : 'Pause' },
            { action: 'stop-sleep', title: 'Wake Up' }
        ];
        data = { type: 'active-sleep', sleepId: sleep.id };
    }

    const options = {
        body,
        tag: 'active-session',
        renotify: false,
        requireInteraction: true,
        actions,
        data,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png'
    };

    if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, options);
    }
}

async function stopActiveBreastfeeding() {
    if (!state.activeTimer) return;

    const now = Date.now();
    const feeding = { ...state.activeTimer, updatedAt: now };

    if (feeding.isPaused) {
        feeding.endTime = feeding.pauseStartTime;
    } else {
        feeding.endTime = now;
    }

    const totalDuration = feeding.endTime - feeding.startTime - (feeding.totalPausedMs || 0);
    await saveDoc(COLLECTIONS.feedings, feeding);
    syncNativeLiveActivity();
    showToast(`Feeding saved: ${formatDuration(totalDuration)}`);
}

async function togglePauseActiveBreastfeeding() {
    if (!state.activeTimer) return;

    const now = Date.now();
    const updated = { ...state.activeTimer, updatedAt: now };

    if (updated.isPaused) {
        updated.totalPausedMs = (updated.totalPausedMs || 0) + (now - updated.pauseStartTime);
        updated.isPaused = false;
        updated.pauseStartTime = null;
    } else {
        updated.isPaused = true;
        updated.pauseStartTime = now;
    }

    await saveDoc(COLLECTIONS.feedings, updated);
    syncNativeLiveActivity();
}

async function stopActiveSleep() {
    if (!state.activeSleep) return;

    const now = Date.now();
    const sleep = { ...state.activeSleep, updatedAt: now };

    if (sleep.isPaused) {
        sleep.endTime = sleep.pauseStartTime;
    } else {
        sleep.endTime = now;
    }

    const totalDuration = sleep.endTime - sleep.startTime - (sleep.totalPausedMs || 0);
    await saveDoc(COLLECTIONS.sleeps, sleep);
    syncNativeLiveActivity();
    showToast(`Sleep saved: ${formatDuration(totalDuration)}`);
}

async function togglePauseActiveSleep() {
    if (!state.activeSleep) return;

    const now = Date.now();
    const updated = { ...state.activeSleep, updatedAt: now };

    if (updated.isPaused) {
        updated.totalPausedMs = (updated.totalPausedMs || 0) + (now - updated.pauseStartTime);
        updated.isPaused = false;
        updated.pauseStartTime = null;
    } else {
        updated.isPaused = true;
        updated.pauseStartTime = now;
    }

    await saveDoc(COLLECTIONS.sleeps, updated);
    syncNativeLiveActivity();
}

function initServiceWorkerMessages() {
    if (isNativeCapacitorApp()) return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', async (event) => {
        const message = event.data;
        if (!message || message.type !== 'notification-action') return;

        queueNotificationAction(message.action, message.payload || {});
    });
}

function queueNotificationAction(action, payload = {}) {
    if (!action || action === 'open') return;
    pendingNotificationAction = { action, payload };
    setTimeout(() => {
        handlePendingNotificationAction();
    }, 250);
}

async function handlePendingNotificationAction() {
    if (!pendingNotificationAction) return;

    const { action } = pendingNotificationAction;
    const hasRequiredState =
        ((action === 'toggle-breast-pause' || action === 'stop-breast') && !!state.activeTimer) ||
        ((action === 'toggle-sleep-pause' || action === 'stop-sleep') && !!state.activeSleep);

    if (!hasRequiredState) return;

    try {
        if (action === 'toggle-breast-pause') await togglePauseActiveBreastfeeding();
        if (action === 'stop-breast') await stopActiveBreastfeeding();
        if (action === 'toggle-sleep-pause') await togglePauseActiveSleep();
        if (action === 'stop-sleep') await stopActiveSleep();
        pendingNotificationAction = null;
    } catch (error) {
        console.error('Failed notification action:', error);
        showToast('Could not apply action. Please open app and retry.');
    }
}

function consumeNotificationActionFromUrl() {
    if (isNativeCapacitorApp()) return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get('notificationAction');
    if (!action) return;

    queueNotificationAction(action, { source: 'url' });

    params.delete('notificationAction');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
    window.history.replaceState({}, document.title, nextUrl);
}

function getEffectiveSleepElapsedMs(sleep) {
    if (!sleep) return 0;

    const now = Date.now();
    const referenceEnd = sleep.isPaused ? sleep.pauseStartTime : (sleep.endTime || now);
    return Math.max(0, referenceEnd - sleep.startTime - (sleep.totalPausedMs || 0));
}

function evaluateAwakeAlert() {
    if (!state.settings.notificationsEnabled || !state.settings.awakeAlertEnabled) return;
    if (state.activeSleep) {
        notificationRuntime.awakeSessionKey = null;
        notificationRuntime.awakeNotified = false;
        return;
    }

    const lastEndedSleep = state.sleeps
        .filter(s => s.endTime)
        .sort((a, b) => b.endTime - a.endTime)[0];

    if (!lastEndedSleep) {
        notificationRuntime.awakeSessionKey = null;
        notificationRuntime.awakeNotified = false;
        return;
    }

    const sessionKey = `${lastEndedSleep.id}:${lastEndedSleep.endTime}`;
    if (notificationRuntime.awakeSessionKey !== sessionKey) {
        notificationRuntime.awakeSessionKey = sessionKey;
        notificationRuntime.awakeNotified = false;
    }

    const awakeMs = Date.now() - lastEndedSleep.endTime;
    const thresholdMs = state.settings.awakeAlertMinutes * 60000;

    if (!notificationRuntime.awakeNotified && awakeMs >= thresholdMs) {
        notificationRuntime.awakeNotified = true;
        showSystemNotification(
            'Baby Awake Alert',
            `Baby has been awake for ${state.settings.awakeAlertMinutes} minutes.`,
            `awake-${sessionKey}`,
            { type: 'awake-alert' }
        ).catch((error) => console.error('Awake notification failed:', error));
        showToast('Awake alert reached');
    }
}

function evaluateSleepAlert() {
    if (!state.settings.notificationsEnabled || !state.activeSleep) return;

    const activeSleep = state.activeSleep;
    const isNap = activeSleep.type === 'nap';
    const alertEnabled = isNap ? state.settings.napAlertEnabled : state.settings.nightSleepAlertEnabled;
    const alertMinutes = isNap ? state.settings.napAlertMinutes : state.settings.nightSleepAlertMinutes;

    if (!alertEnabled) return;

    const sleepId = activeSleep.id;
    const sleepElapsedMs = getEffectiveSleepElapsedMs(activeSleep);
    const thresholdMs = alertMinutes * 60000;

    if (notificationRuntime.sleepNotifiedById[sleepId]) return;
    if (sleepElapsedMs < thresholdMs) return;

    notificationRuntime.sleepNotifiedById[sleepId] = true;

    const sleepLabel = isNap ? 'Nap' : 'Night sleep';
    showSystemNotification(
        `${sleepLabel} Alert`,
        `${sleepLabel} reached ${alertMinutes} minutes.`,
        `sleep-${sleepId}`,
        { type: 'sleep-alert', sleepId }
    ).catch((error) => console.error('Sleep notification failed:', error));
    showToast(`${sleepLabel} alert reached`);
}

function evaluateThresholdAlerts() {
    if (!state.user) return;
    evaluateAwakeAlert();
    evaluateSleepAlert();
    reconcileFromLiveActivity();
    handlePendingNotificationAction().catch((error) => {
        console.error('Pending action handler failed:', error);
    });
    updateActiveSessionNotification().catch((error) => {
        console.error('Active session notification update failed:', error);
    });
}

function startNotificationEngine() {
    if (notificationCheckInterval) clearInterval(notificationCheckInterval);
    notificationCheckInterval = setInterval(evaluateThresholdAlerts, 5000);
    evaluateThresholdAlerts();

    // Poll immediately when app returns to foreground (for Live Activity button presses)
    if (isNativeCapacitorApp()) {
        const handleForegroundResume = async () => {
            lastNativeCommandPollAt = 0;
            // Adopt the Live Activity's state before pushing anything back.
            await reconcileFromLiveActivity();
            lastLiveActivitySyncKey = '';
            await syncNativeLiveActivity();
        };
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                handleForegroundResume();
            }
        });
        window.addEventListener('resume', () => {
            handleForegroundResume();
        });
    }
}

async function registerServiceWorker() {
    if (isNativeCapacitorApp()) return;
    if (!('serviceWorker' in navigator)) return;
    try {
        await navigator.serviceWorker.register('./sw.js');
    } catch (error) {
        console.error('Service worker registration failed:', error);
    }
}

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
    const collectionItems = {
        [COLLECTIONS.feedings]: state.feedings,
        [COLLECTIONS.solids]: state.solids,
        [COLLECTIONS.sleeps]: state.sleeps
    };
    const items = collectionItems[collectionName] || [];
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

function formatDateTimeShort(date) {
    return new Date(date).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
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

function formatElapsedSince(timestamp) {
    return formatDuration(Math.max(0, Date.now() - timestamp));
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

function isSameDay(a, b) {
    return getStartOfDay(a).getTime() === getStartOfDay(b).getTime();
}

// `<input type="date">` wants local YYYY-MM-DD. toISOString() would shift the day
// for anyone west of UTC, which is most of the evening here.
function toDateInputValue(date) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Prev/next arrows, tap-the-date-to-jump, and a "back to today" shortcut.
// Shared by the feeding, food and sleep logs — they all use the same markup.
function initDateNav(kind, getDate, setDate, render) {
    const step = (days) => {
        const next = new Date(getDate());
        next.setDate(next.getDate() + days);
        setDate(next);
        render();
    };

    document.getElementById(`${kind}PrevDay`)?.addEventListener('click', () => step(-1));
    document.getElementById(`${kind}NextDay`)?.addEventListener('click', () => step(1));

    document.getElementById(`${kind}DatePicker`)?.addEventListener('change', (event) => {
        const value = event.target.value;
        if (!value) return;
        const [year, month, day] = value.split('-').map(Number);
        setDate(new Date(year, month - 1, day));
        render();
    });

    document.getElementById(`${kind}TodayBtn`)?.addEventListener('click', () => {
        setDate(new Date());
        render();
    });
}

// Keeps the picker value, the today shortcut and the next-day cap in step with
// whichever day is on screen. Called from each render.
function syncDateNav(kind, date) {
    const now = new Date();
    const atToday = isSameDay(date, now);

    const picker = document.getElementById(`${kind}DatePicker`);
    if (picker) {
        picker.value = toDateInputValue(date);
        picker.max = toDateInputValue(now);
    }

    document.getElementById(`${kind}TodayBtn`)?.classList.toggle('hidden', atToday);

    // Nothing is ever logged in the future, so stop the arrow there.
    const nextBtn = document.getElementById(`${kind}NextDay`);
    if (nextBtn) nextBtn.disabled = getStartOfDay(date) >= getStartOfDay(now);
}

function getLocalDateTimeString(date = new Date()) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildSelectOptions(options, selectedValue, { includeBlank = false, blankLabel = 'Select an option' } = {}) {
    let html = '';

    if (includeBlank) {
        html += `<option value="" ${selectedValue ? '' : 'selected'}>${escapeHtml(blankLabel)}</option>`;
    }

    return html + Object.entries(options)
        .map(([value, label]) => `<option value="${value}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(label)}</option>`)
        .join('');
}

function getActiveChoiceValue(containerId, fallback = null) {
    return document.querySelector(`#${containerId} .choice-btn.active`)?.dataset.value || fallback;
}

function setActiveChoiceValue(containerId, value) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.querySelectorAll('.choice-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.value === value);
    });
}

function formatOptionLabel(options, value) {
    return options[value] || value || '';
}

function truncateText(value, maxLength = 28) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function renderIcon(name, className = '', label = '') {
    const classes = ['ph-icon', className].filter(Boolean).join(' ');
    const aria = label ? ` role="img" aria-label="${escapeHtml(label)}"` : ' aria-hidden="true"';
    return `<svg class="${classes}" viewBox="0 0 256 256"${aria}><use href="${ICON_SPRITE_PATH}#ph-${name}"></use></svg>`;
}

// ===== Toast Notification =====
function showToast(message) {
    const asText = String(message || '').toLowerCase();
    let tone = 'info';
    if (asText.includes('error') || asText.includes('failed') || asText.includes('invalid') || asText.includes('not supported') || asText.includes('blocked')) {
        tone = 'error';
    } else if (asText.includes('saved') || asText.includes('enabled') || asText.includes('welcome') || asText.includes('sent') || asText.includes('started')) {
        tone = 'success';
    }

    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    if (!toast || !toastMessage) return;

    toast.classList.remove('toast-info', 'toast-success', 'toast-error');
    toast.classList.add(`toast-${tone}`);
    toastMessage.textContent = message;

    if (showToast._timer) {
        clearTimeout(showToast._timer);
    }

    toast.classList.remove('hidden');
    toast.classList.add('show');

    showToast._timer = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 250);
    }, 2500);
}

function showConfirmDialog({
    title = 'Please confirm',
    message = 'Are you sure?',
    confirmText = 'Continue',
    cancelText = 'Cancel',
    destructive = false
} = {}) {
    const backdrop = document.getElementById('appDialogBackdrop');
    const titleEl = document.getElementById('appDialogTitle');
    const messageEl = document.getElementById('appDialogMessage');
    const confirmBtn = document.getElementById('appDialogConfirm');
    const cancelBtn = document.getElementById('appDialogCancel');

    if (!backdrop || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
        return Promise.resolve(window.confirm(message));
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    confirmBtn.classList.toggle('danger-btn', destructive);
    confirmBtn.classList.toggle('primary-btn', !destructive);

    backdrop.classList.remove('hidden');
    requestAnimationFrame(() => backdrop.classList.add('active'));

    return new Promise((resolve) => {
        const close = (result) => {
            backdrop.classList.remove('active');
            setTimeout(() => backdrop.classList.add('hidden'), 180);
            cleanup();
            resolve(result);
        };

        const onConfirm = () => close(true);
        const onCancel = () => close(false);
        const onBackdrop = (event) => {
            if (event.target === backdrop) close(false);
        };

        const onEscape = (event) => {
            if (event.key === 'Escape') close(false);
        };

        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            backdrop.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onEscape);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        backdrop.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onEscape);
    });
}

// ===== Real-time Listeners =====
// ===== Real-time Listeners =====
let unsubBaby, unsubSettings, unsubFeedings, unsubSolids, unsubSleeps;

function initListeners() {
    // Clean up existing listeners if any
    if (unsubBaby) unsubBaby();
    if (unsubSettings) unsubSettings();
    if (unsubFeedings) unsubFeedings();
    if (unsubSolids) unsubSolids();
    if (unsubSleeps) unsubSleeps();

    if (!state.user) {
        console.log("No user, clearing data...");
        state.baby = null;
        state.settings = { ...DEFAULT_SETTINGS };
        state.feedings = [];
        state.solids = [];
        state.sleeps = [];
        updateDashboard();
        renderFeedingLog();
        renderFoodLog();
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
        state.settings = normalizeSettings(doc.exists() ? doc.data() : {});
        updateSettingsUI();
        evaluateThresholdAlerts();
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

    // Solid Food Listener
    // Path: users/{uid}/solids
    const qSolids = query(
        collection(db, 'users', userId, COLLECTIONS.solids),
        orderBy("startTime", "desc")
    );
    unsubSolids = onSnapshot(qSolids, (snapshot) => {
        state.solids = [];
        snapshot.forEach((doc) => {
            state.solids.push(doc.data());
        });

        updateDashboard();
        renderFoodLog();
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
            if (screenId === 'food') renderFoodLog();
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
    const babyName = getBabyDisplayName();
    const hasBirthDate = !!state.baby?.birthDate;
    const babyAge = hasBirthDate
        ? calculateBabyAge(state.baby.birthDate)
        : 'Set up your baby\'s info in settings';

    const babyInfo = document.getElementById('babyInfo');
    if (babyInfo) {
        babyInfo.querySelector('.baby-name').textContent = `Hello, ${babyName}`;
        babyInfo.querySelector('.baby-age').textContent = babyAge;
    }

    const photo = state.baby?.photo || '';

    // Home hero avatar: the photo when there is one, initials otherwise.
    const avatarInitials = document.getElementById('babyAvatarInitials');
    const avatarImg = document.getElementById('babyAvatarImg');
    if (avatarInitials) avatarInitials.textContent = getBabyInitials(babyName);
    if (avatarImg) {
        avatarImg.src = photo;
        avatarImg.classList.toggle('hidden', !photo);
    }
    if (avatarInitials) avatarInitials.classList.toggle('hidden', !!photo);

    // Settings fields. These are the only controls that never used to be restored
    // from state, so a saved name looked like it had been thrown away.
    const nameInput = document.getElementById('babyName');
    const birthInput = document.getElementById('babyBirthDate');
    if (nameInput && document.activeElement !== nameInput) {
        nameInput.value = state.baby?.name || '';
    }
    if (birthInput && document.activeElement !== birthInput) {
        birthInput.value = state.baby?.birthDate || '';
    }

    const ageLine = document.getElementById('babyAgeLine');
    if (ageLine) {
        ageLine.textContent = hasBirthDate ? babyAge : 'Add a birth date to track age';
    }

    const settingsPhotoImg = document.getElementById('babyPhotoImg');
    const settingsPhotoInitials = document.getElementById('babyPhotoInitials');
    const removePhotoBtn = document.getElementById('babyPhotoRemove');
    if (settingsPhotoImg) {
        settingsPhotoImg.src = photo;
        settingsPhotoImg.classList.toggle('hidden', !photo);
    }
    if (settingsPhotoInitials) {
        settingsPhotoInitials.textContent = getBabyInitials(babyName);
        settingsPhotoInitials.classList.toggle('hidden', !!photo);
    }
    if (removePhotoBtn) removePhotoBtn.classList.toggle('hidden', !photo);
}

// Minutes as something readable at 3am: "45m", "1h", "2h 20m".
function formatMinutes(total) {
    const mins = Math.max(0, Math.round(Number(total) || 0));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (!h) return `${m}m`;
    return m ? `${h}h ${m}m` : `${h}h`;
}

function applyTheme(preference) {
    const root = document.documentElement;
    if (preference === 'light' || preference === 'dark') {
        root.setAttribute('data-theme', preference);
    } else {
        root.removeAttribute('data-theme');
    }
    try {
        localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch (error) {
        // Nothing to do; the setting still lives in Firestore.
    }
}

function setSegmented(groupId, value) {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.querySelectorAll('.segmented-option').forEach((option) => {
        option.setAttribute('aria-pressed', String(option.dataset.value === value));
    });
}

// A control whose parent switch is off reads as inactive instead of inviting
// edits that would not take effect.
function syncDependentRows() {
    document.querySelectorAll('[data-depends-on]').forEach((el) => {
        const source = document.getElementById(el.dataset.dependsOn);
        el.classList.toggle('is-inactive', !(source && source.checked));
    });
}

function describeLoggedData() {
    const counts = [
        [state.feedings?.length || 0, 'feeding', 'feedings'],
        [state.solids?.length || 0, 'solid', 'solids'],
        [state.sleeps?.length || 0, 'sleep', 'sleeps']
    ].filter(([n]) => n > 0)
        .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);

    if (!counts.length) return 'Nothing logged yet';

    const earliest = [...(state.feedings || []), ...(state.solids || []), ...(state.sleeps || [])]
        .reduce((min, entry) => (entry.startTime && entry.startTime < min ? entry.startTime : min), Date.now());

    return `${counts.join(' \u00b7 ')} \u00b7 since ${new Date(earliest).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

function updateSettingsUI() {
    const settings = normalizeSettings(state.settings || {});
    state.settings = settings;

    applyTheme(settings.theme);
    setSegmented('volumeUnitSeg', settings.volumeUnit);
    setSegmented('themeSeg', settings.theme);

    document.getElementById('notificationsEnabled').checked = settings.notificationsEnabled;
    document.getElementById('liveActivityEnabled').checked = settings.liveActivityEnabled;
    document.getElementById('awakeAlertEnabled').checked = settings.awakeAlertEnabled;
    document.getElementById('napAlertEnabled').checked = settings.napAlertEnabled;
    document.getElementById('nightSleepAlertEnabled').checked = settings.nightSleepAlertEnabled;

    [['awakeAlertMinutes', settings.awakeAlertMinutes],
     ['napAlertMinutes', settings.napAlertMinutes],
     ['nightSleepAlertMinutes', settings.nightSleepAlertMinutes]].forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value;
        const label = document.querySelector(`[data-value-for="${id}"]`);
        if (label) label.textContent = formatMinutes(value);
    });

    syncDependentRows();

    const summary = document.getElementById('dataSummary');
    if (summary) summary.textContent = describeLoggedData();

    const version = document.getElementById('aboutVersion');
    if (version) version.textContent = `Baby Tracker ${APP_VERSION}`;

    const permission = (isNativeCapacitorApp() && nativeNotificationState.loaded)
        ? nativeNotificationState.permission
        : getNotificationPermission();
    const enableBtn = document.getElementById('enableNotifications');
    const permissionRow = document.getElementById('notificationPermissionRow');
    const hint = document.getElementById('notificationHint');

    // One row instead of a raw permission status plus a button: the button only
    // appears while there is something for it to do.
    if (permission === 'granted') {
        hint.textContent = settings.notificationsEnabled ? 'On' : 'Off';
        permissionRow.classList.add('hidden');
    } else if (permission === 'denied') {
        hint.textContent = 'Blocked in iOS Settings';
        permissionRow.classList.remove('hidden');
        enableBtn.textContent = 'Open iOS Settings';
        enableBtn.disabled = false;
    } else if (permission === 'unsupported' && !isNativeCapacitorApp()) {
        hint.textContent = 'Not supported on this device';
        permissionRow.classList.add('hidden');
    } else {
        hint.textContent = 'Needs permission';
        permissionRow.classList.remove('hidden');
        enableBtn.textContent = 'Enable notifications';
        enableBtn.disabled = false;
    }
}

function getBabyDisplayName() {
    return state.baby?.name?.trim() || 'Baby';
}

function getBabyInitials(name) {
    return String(name || 'Baby')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || 'B';
}

function getElapsedForEntry(entry) {
    if (!entry) return 0;

    if (entry.isPaused) {
        return entry.pauseStartTime - entry.startTime - (entry.totalPausedMs || 0);
    }

    return Date.now() - entry.startTime - (entry.totalPausedMs || 0);
}

let homeStatusInterval = null;

function startHomeStatusTicker() {
    if (homeStatusInterval) return;

    homeStatusInterval = setInterval(() => {
        const homeScreen = document.getElementById('homeScreen');
        if (homeScreen?.classList.contains('active')) {
            updateQuickStats();
        }
    }, 30000);
}

function updateDashboard() {
    // This is called automatically by listeners when data changes
    updateQuickStats();
    updateTodaySummary();
    checkActiveTimers();
    evaluateThresholdAlerts();
}

function updateQuickStats() {
    return;
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

    // Today's solids
    const todaySolids = state.solids.filter(entry => entry.startTime >= startOfDay && entry.startTime <= endOfDay);
    const latestSolid = todaySolids.slice().sort((a, b) => b.startTime - a.startTime)[0];
    const newFoodCount = todaySolids.filter(entry => entry.isNewFood).length;
    const solidSummaryEl = document.getElementById('todaySolidSummary');
    const solidDetailsEl = document.getElementById('todaySolidDetails');

    if (solidSummaryEl) {
        solidSummaryEl.textContent = `${todaySolids.length} logged`;
    }

    if (solidDetailsEl) {
        if (todaySolids.length === 0) {
            solidDetailsEl.textContent = 'No foods logged yet';
        } else {
            const detailParts = [];
            if (newFoodCount > 0) {
                detailParts.push(`${newFoodCount} new food${newFoodCount === 1 ? '' : 's'}`);
            }
            if (latestSolid?.foods) {
                detailParts.push(`Last: ${truncateText(latestSolid.foods, 26)}`);
            }
            solidDetailsEl.textContent = detailParts.join(' • ') || 'Food logged today';
        }
    }
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

    // Sync Live Activity whenever active timer state is re-evaluated
    syncNativeLiveActivity();
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
            updatedAt: Date.now(),
            endTime: null,
            side: side,
            notes: notes || null
        };

        // Optimistic UI update handled by listener... but wait, listener is fast. 
        // We just save.
        saveDoc(COLLECTIONS.feedings, feeding)
            .then(() => {
                showToast('Breastfeeding started');
                syncNativeLiveActivity();
            });

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
        await stopActiveBreastfeeding();
    });

    document.getElementById('pauseTimerBtn').addEventListener('click', async () => {
        await togglePauseActiveBreastfeeding();
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

// ===== Solid Food =====
function resetSolidFoodForm() {
    document.getElementById('solidFoodName').value = '';
    document.getElementById('solidFoodTime').value = getLocalDateTimeString();
    document.getElementById('solidFoodIsNew').checked = false;
    document.getElementById('solidFoodHadReaction').checked = false;
    document.getElementById('solidReactionNotes').value = '';
    document.getElementById('solidFoodNotes').value = '';

    setActiveChoiceValue('solidMealTypeChoices', 'snack');
    setActiveChoiceValue('solidIntakeChoices', 'some');
    setActiveChoiceValue('solidTextureChoices', null);

    document.getElementById('solidReactionGroup').classList.add('hidden');
}

function initSolidFood() {
    const reactionToggle = document.getElementById('solidFoodHadReaction');
    const reactionGroup = document.getElementById('solidReactionGroup');

    const syncReactionGroup = () => {
        reactionGroup.classList.toggle('hidden', !reactionToggle.checked);
    };

    reactionToggle.addEventListener('change', syncReactionGroup);
    syncReactionGroup();

    document.getElementById('confirmSolidFood').addEventListener('click', async () => {
        const foods = document.getElementById('solidFoodName').value.trim();
        const timeValue = document.getElementById('solidFoodTime').value;
        const startTime = timeValue ? new Date(timeValue).getTime() : Date.now();
        const hadReaction = document.getElementById('solidFoodHadReaction').checked;

        if (!foods) {
            showToast('Please enter at least one food');
            return;
        }

        if (Number.isNaN(startTime)) {
            showToast('Please choose a valid time');
            return;
        }

        const entry = {
            id: generateId(),
            foods,
            startTime,
            mealType: getActiveChoiceValue('solidMealTypeChoices', 'snack'),
            intake: getActiveChoiceValue('solidIntakeChoices', 'some'),
            texture: getActiveChoiceValue('solidTextureChoices', null),
            isNewFood: document.getElementById('solidFoodIsNew').checked,
            hadReaction,
            reactionNotes: hadReaction ? (document.getElementById('solidReactionNotes').value.trim() || null) : null,
            notes: document.getElementById('solidFoodNotes').value.trim() || null
        };

        await saveDoc(COLLECTIONS.solids, entry);
        closeModal('solidFoodModal');
        resetSolidFoodForm();
        showToast('Solid food saved');
    });

    resetSolidFoodForm();
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
            updatedAt: Date.now(),
            endTime: null,
            type: type,
            location: location || null
        };

        await saveDoc(COLLECTIONS.sleeps, sleep);

        closeModal('sleepModal');
        document.getElementById('sleepLocation').value = '';

        showToast('Sleep started');
        syncNativeLiveActivity();
    });

    document.getElementById('wakeUpBtn').addEventListener('click', async () => {
        await stopActiveSleep();
    });

    document.getElementById('pauseSleepBtn').addEventListener('click', async () => {
        await togglePauseActiveSleep();
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
    syncDateNav('feeding', date);

    // Listeners already keep state.feedings up to date
    const feedings = state.feedings
        .filter(f => f.startTime >= startOfDay && f.startTime <= endOfDay);

    const list = document.getElementById('feedingLogList');

    if (feedings.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${renderIcon('baby', 'icon-48')}</div>
                <p>No feedings logged</p>
                <p class="empty-hint">Tap + to add one</p>
            </div>
        `;
        return;
    }

    list.innerHTML = feedings.map(f => {
        let iconName = 'baby';
        let iconClass = '';
        let title = '';
        let subtitle = '';

        if (f.type === 'breast') {
            iconClass = 'breast';
            iconName = 'drop';
            title = 'Nursing';
            if (f.side) subtitle = `${f.side.charAt(0).toUpperCase() + f.side.slice(1)} side`;
        } else if (f.type === 'bottle') {
            iconClass = 'bottle';
            iconName = 'jar';
            title = 'Bottle';
            subtitle = `${f.amount}ml`;
            if (f.subtype === 'formula') {
                title = 'Formula';
                iconClass = 'formula';
                iconName = 'flask';
                if (f.brand) subtitle += ` • ${f.brand}`;
            } else if (f.subtype === 'breast_milk') {
                title = 'Breast Milk';
                iconName = 'jar-label';
            }
        } else if (f.type === 'formula') {
            iconClass = 'formula';
            iconName = 'flask';
            title = 'Formula';
            subtitle = `${f.amount}ml`;
            if (f.brand) subtitle += ` • ${f.brand}`;
        } else if (f.type === 'vitamin') {
            iconClass = 'vitamin';
            iconName = 'pill';
            title = 'Vitamin';
            subtitle = f.notes || '';
        }

        const duration = f.endTime && f.type === 'breast' ? formatDuration(f.endTime - f.startTime) : '';

        return `
            <div class="log-item" data-id="${f.id}" data-type="feeding">
                <div class="log-icon ${iconClass}">
                    ${renderIcon(iconName)}
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
    initDateNav('feeding', () => state.currentFeedingDate, (date) => { state.currentFeedingDate = date; }, renderFeedingLog);

    document.getElementById('addFeedingBtn').addEventListener('click', () => {
        document.getElementById('bottleTime').value = getLocalDateTimeString();
        openModal('bottleModal');
    });
}

// ===== Food Log =====
function renderFoodLog() {
    const date = state.currentFoodDate;
    const startOfDay = getStartOfDay(date).getTime();
    const endOfDay = getEndOfDay(date).getTime();

    const { title, subtitle } = formatDateForHeader(date);
    const display = document.getElementById('foodDateDisplay');
    if (display) {
        display.querySelector('.date-title').textContent = title;
        display.querySelector('.date-subtitle').textContent = subtitle;
    }
    syncDateNav('food', date);

    const foods = state.solids
        .filter(entry => entry.startTime >= startOfDay && entry.startTime <= endOfDay);

    const list = document.getElementById('foodLogList');

    if (foods.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${renderIcon('bowl-food', 'icon-48')}</div>
                <p>No food logged</p>
                <p class="empty-hint">Tap + to add one</p>
            </div>
        `;
        return;
    }

    list.innerHTML = foods.map((entry) => {
        const details = [
            formatOptionLabel(SOLID_FOOD_MEAL_TYPES, entry.mealType),
            formatOptionLabel(SOLID_FOOD_INTAKE_LEVELS, entry.intake),
            entry.texture ? formatOptionLabel(SOLID_FOOD_TEXTURES, entry.texture) : ''
        ].filter(Boolean).join(' • ');

        const flags = [
            entry.isNewFood ? '<span class="food-flag">New food</span>' : '',
            entry.hadReaction ? '<span class="food-flag reaction">Reaction</span>' : ''
        ].filter(Boolean).join('');

        return `
            <div class="log-item" data-id="${entry.id}" data-type="food">
                <div class="log-icon food">
                    ${renderIcon('bowl-food')}
                </div>
                <div class="log-details">
                    <div class="log-title">${escapeHtml(entry.foods)}</div>
                    <div class="log-subtitle">${escapeHtml(details)}</div>
                    ${flags ? `<div class="food-flags">${flags}</div>` : ''}
                </div>
                <div class="log-time">
                    <span class="log-time-main">${formatTime(entry.startTime)}</span>
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.log-item').forEach((item) => {
        item.addEventListener('click', () => openEditFoodModal(item.dataset.id));
    });
}

function initFoodLog() {
    initDateNav('food', () => state.currentFoodDate, (date) => { state.currentFoodDate = date; }, renderFoodLog);

    document.getElementById('addFoodBtn').addEventListener('click', () => {
        resetSolidFoodForm();
        openModal('solidFoodModal');
    });
}

async function openEditFoodModal(id) {
    const entry = state.solids.find(food => food.id === id);
    if (!entry) return;

    state.editingId = id;

    const body = document.getElementById('editFoodBody');
    body.innerHTML = `
        <div class="form-group">
            <label for="editFoodName">Food name(s)</label>
            <input type="text" id="editFoodName" value="${escapeHtml(entry.foods)}">
        </div>
        <div class="form-group">
            <label for="editFoodTime">Time</label>
            <input type="datetime-local" id="editFoodTime" value="${getLocalDateTimeString(entry.startTime)}">
        </div>
        <div class="form-group">
            <label for="editFoodMealType">Meal Type</label>
            <select id="editFoodMealType">
                ${buildSelectOptions(SOLID_FOOD_MEAL_TYPES, entry.mealType)}
            </select>
        </div>
        <div class="form-group">
            <label for="editFoodIntake">Intake</label>
            <select id="editFoodIntake">
                ${buildSelectOptions(SOLID_FOOD_INTAKE_LEVELS, entry.intake)}
            </select>
        </div>
        <div class="form-group">
            <label for="editFoodTexture">Texture / Form</label>
            <select id="editFoodTexture">
                ${buildSelectOptions(SOLID_FOOD_TEXTURES, entry.texture, { includeBlank: true, blankLabel: 'Not set' })}
            </select>
        </div>
        <div class="form-group">
            <label class="check-row" for="editFoodIsNew">
                <input type="checkbox" id="editFoodIsNew" ${entry.isNewFood ? 'checked' : ''}>
                <span>New food / first exposure</span>
            </label>
        </div>
        <div class="form-group">
            <label class="check-row" for="editFoodHadReaction">
                <input type="checkbox" id="editFoodHadReaction" ${entry.hadReaction ? 'checked' : ''}>
                <span>Reaction observed</span>
            </label>
        </div>
        <div class="form-group ${entry.hadReaction ? '' : 'hidden'}" id="editFoodReactionGroup">
            <label for="editFoodReactionNotes">Reaction notes</label>
            <textarea id="editFoodReactionNotes">${escapeHtml(entry.reactionNotes || '')}</textarea>
        </div>
        <div class="form-group">
            <label for="editFoodNotes">Notes</label>
            <textarea id="editFoodNotes">${escapeHtml(entry.notes || '')}</textarea>
        </div>
    `;

    openModal('editFoodModal');

    const reactionCheckbox = document.getElementById('editFoodHadReaction');
    const reactionGroup = document.getElementById('editFoodReactionGroup');
    const syncReactionGroup = () => {
        reactionGroup.classList.toggle('hidden', !reactionCheckbox.checked);
    };

    reactionCheckbox.addEventListener('change', syncReactionGroup);
    syncReactionGroup();
}

function initEditFood() {
    document.getElementById('saveEditFood').addEventListener('click', async () => {
        const entry = { ...state.solids.find(food => food.id === state.editingId) };
        if (!entry) return;

        const foods = document.getElementById('editFoodName').value.trim();
        const timeValue = document.getElementById('editFoodTime').value;
        const startTime = timeValue ? new Date(timeValue).getTime() : NaN;
        const hadReaction = document.getElementById('editFoodHadReaction').checked;

        if (!foods) {
            showToast('Please enter at least one food');
            return;
        }

        if (Number.isNaN(startTime)) {
            showToast('Please choose a valid time');
            return;
        }

        entry.foods = foods;
        entry.startTime = startTime;
        entry.mealType = document.getElementById('editFoodMealType').value || 'snack';
        entry.intake = document.getElementById('editFoodIntake').value || 'some';
        entry.texture = document.getElementById('editFoodTexture').value || null;
        entry.isNewFood = document.getElementById('editFoodIsNew').checked;
        entry.hadReaction = hadReaction;
        entry.reactionNotes = hadReaction ? (document.getElementById('editFoodReactionNotes').value.trim() || null) : null;
        entry.notes = document.getElementById('editFoodNotes').value.trim() || null;

        await saveDoc(COLLECTIONS.solids, entry);
        closeModal('editFoodModal');
        showToast('Food entry updated');
    });

    document.getElementById('deleteFoodBtn').addEventListener('click', async () => {
        const shouldDelete = await showConfirmDialog({
            title: 'Delete Food Entry',
            message: 'Delete this food entry? This cannot be undone.',
            confirmText: 'Delete',
            destructive: true
        });

        if (shouldDelete) {
            await removeDoc(COLLECTIONS.solids, state.editingId);
            closeModal('editFoodModal');
            showToast('Food entry deleted');
        }
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
        const shouldDelete = await showConfirmDialog({
            title: 'Delete Feeding',
            message: 'Delete this feeding entry? This cannot be undone.',
            confirmText: 'Delete',
            destructive: true
        });
        if (shouldDelete) {
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
    syncDateNav('sleep', date);

    const sleeps = state.sleeps
        .filter((sleep) => {
            const sleepEnd = sleep.endTime || Date.now();
            return sleep.startTime <= endOfDay && sleepEnd >= startOfDay;
        });

    const intervalTrack = document.getElementById('sleepIntervalTrack');

    if (intervalTrack) {
        const ticks = [0, 6, 12, 18, 24]
            .map(() => '<span class="sleep-tick"></span>')
            .join('');

        const segments = sleeps.map((sleep) => {
            const segmentStart = Math.max(sleep.startTime, startOfDay);
            const segmentEnd = Math.min(sleep.endTime || Date.now(), endOfDay);
            const startPercent = ((segmentStart - startOfDay) / 86400000) * 100;
            const widthPercent = Math.max(((segmentEnd - segmentStart) / 86400000) * 100, 1.5);
            const segmentClass = sleep.type === 'nap' ? 'sleep-interval-segment nap' : 'sleep-interval-segment night';
            return `<span class="${segmentClass}" style="left:${startPercent}%;width:${widthPercent}%;"></span>`;
        }).join('');

        intervalTrack.innerHTML = `
            ${segments}
            <div class="sleep-tick-layer" aria-hidden="true">${ticks}</div>
        `;
    }

    const totalSleepMs = sleeps.reduce((sum, s) => {
        const segmentStart = Math.max(s.startTime, startOfDay);
        const segmentEnd = Math.min(s.endTime || Date.now(), endOfDay);
        return sum + Math.max(0, segmentEnd - segmentStart - (s.totalPausedMs || 0));
    }, 0);

    const sleepHours = totalSleepMs / 3600000;
    document.getElementById('sleepTotalHours').textContent = `${Math.floor(sleepHours)}h ${Math.floor((sleepHours % 1) * 60)}m`;

    const list = document.getElementById('sleepLogList');

    if (sleeps.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${renderIcon('moon-stars', 'icon-48')}</div>
                <p>No sleep logged</p>
                <p class="empty-hint">Tap + to add one</p>
            </div>
        `;
        return;
    }

    list.innerHTML = sleeps.map(s => {
        let iconName = 'moon-stars';
        let iconClass = '';
        let title = '';

        if (s.type === 'nap') {
            iconClass = 'nap';
            title = 'Nap';
            iconName = 'cloud-moon';
        } else {
            iconClass = 'night';
            title = 'Night Sleep';
            iconName = 'moon-stars';
        }

        const subtitle = s.location ? s.location.charAt(0).toUpperCase() + s.location.slice(1) : '';
        const duration = s.endTime ? formatDuration(s.endTime - s.startTime) : 'Ongoing...';
        const endTime = s.endTime ? ` - ${formatTime(s.endTime)}` : '';

        return `
            <div class="log-item" data-id="${s.id}" data-type="sleep">
                <div class="log-icon ${iconClass}">
                    ${renderIcon(iconName)}
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
    initDateNav('sleep', () => state.currentSleepDate, (date) => { state.currentSleepDate = date; }, renderSleepLog);

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
        const shouldDelete = await showConfirmDialog({
            title: 'Delete Sleep Entry',
            message: 'Delete this sleep entry? This cannot be undone.',
            confirmText: 'Delete',
            destructive: true
        });
        if (shouldDelete) {
            await removeDoc(COLLECTIONS.sleeps, state.editingId);
            closeModal('editSleepModal');
            showToast('Sleep deleted');
        }
    });
}

// ===== Settings =====
// Every control here saves the moment it changes. The screen used to mix three
// save models — instant for the volume unit, an explicit button for baby info and
// another for notifications — so nothing you learned in one group transferred to
// the next, and a saved value that vanished read as data loss.
function initSettings() {
    const debouncedSaveBaby = debounce(async () => {
        await saveDoc(COLLECTIONS.baby, {
            id: 'main',
            ...(state.baby || {}),
            name: document.getElementById('babyName').value.trim(),
            birthDate: document.getElementById('babyBirthDate').value
        });
    }, 600);

    document.getElementById('babyName').addEventListener('input', debouncedSaveBaby);
    document.getElementById('babyBirthDate').addEventListener('change', debouncedSaveBaby);

    // --- Baby photo -------------------------------------------------------
    const photoInput = document.getElementById('babyPhotoInput');
    document.getElementById('babyPhotoBtn').addEventListener('click', () => photoInput.click());

    photoInput.addEventListener('change', async () => {
        const file = photoInput.files?.[0];
        photoInput.value = '';
        if (!file) return;
        try {
            const photo = await downscaleImageToDataUrl(file, 320);
            await saveDoc(COLLECTIONS.baby, { id: 'main', ...(state.baby || {}), photo });
            showToast('Photo updated');
        } catch (error) {
            console.error('Photo failed:', error);
            showToast('Could not read that image');
        }
    });

    document.getElementById('babyPhotoRemove').addEventListener('click', async () => {
        await saveDoc(COLLECTIONS.baby, { id: 'main', ...(state.baby || {}), photo: '' });
        showToast('Photo removed');
    });

    // --- Segmented controls ----------------------------------------------
    document.getElementById('volumeUnitSeg').addEventListener('click', async (event) => {
        const option = event.target.closest('.segmented-option');
        if (!option) return;
        setSegmented('volumeUnitSeg', option.dataset.value);
        await saveUserSettings({ volumeUnit: option.dataset.value });
    });

    document.getElementById('themeSeg').addEventListener('click', async (event) => {
        const option = event.target.closest('.segmented-option');
        if (!option) return;
        setSegmented('themeSeg', option.dataset.value);
        applyTheme(option.dataset.value);
        await saveUserSettings({ theme: option.dataset.value });
    });

    // --- Alert switches ---------------------------------------------------
    ['notificationsEnabled', 'liveActivityEnabled', 'awakeAlertEnabled',
     'napAlertEnabled', 'nightSleepAlertEnabled'].forEach((id) => {
        document.getElementById(id).addEventListener('change', async (event) => {
            syncDependentRows();
            await saveUserSettings({ [id]: event.target.checked });
        });
    });

    // --- Duration steppers ------------------------------------------------
    document.querySelectorAll('.stepper').forEach((stepper) => {
        stepper.addEventListener('click', async (event) => {
            const button = event.target.closest('.stepper-btn');
            if (!button) return;

            const id = stepper.dataset.target;
            const input = document.getElementById(id);
            const step = Number(stepper.dataset.step) * Number(button.dataset.dir);
            const next = Math.min(
                Number(stepper.dataset.max),
                Math.max(Number(stepper.dataset.min), Number(input.value) + step)
            );
            if (next === Number(input.value)) return;

            input.value = next;
            stepper.querySelector('.stepper-value').textContent = formatMinutes(next);
            await saveUserSettings({ [id]: next });
        });
    });

    document.getElementById('enableNotifications').addEventListener('click', async () => {
        await requestNotificationPermission();
        await refreshNotificationPermission();
        updateSettingsUI();
    });

    // --- Export -----------------------------------------------------------
    document.getElementById('exportData').addEventListener('click', async () => {
        const rows = [];
        const push = (...cells) => rows.push(cells.map(csvCell).join(','));

        push('Type', 'Date', 'Time', 'Duration', 'Amount', 'Side', 'Notes');
        state.feedings.forEach((f) => push(
            f.type,
            new Date(f.startTime).toLocaleDateString(),
            formatTime(f.startTime),
            f.endTime ? formatDuration(f.endTime - f.startTime) : '',
            f.amount || '', f.side || '', f.notes || ''
        ));

        rows.push('');
        push('Foods', 'Date', 'Time', 'Meal', 'Intake', 'Texture', 'New Food', 'Reaction', 'Reaction Notes', 'Notes');
        state.solids.forEach((entry) => push(
            entry.foods || '',
            new Date(entry.startTime).toLocaleDateString(),
            formatTime(entry.startTime),
            formatOptionLabel(SOLID_FOOD_MEAL_TYPES, entry.mealType),
            formatOptionLabel(SOLID_FOOD_INTAKE_LEVELS, entry.intake),
            formatOptionLabel(SOLID_FOOD_TEXTURES, entry.texture),
            entry.isNewFood ? 'Yes' : 'No',
            entry.hadReaction ? 'Yes' : 'No',
            entry.reactionNotes || '', entry.notes || ''
        ));

        rows.push('');
        push('Sleep Type', 'Date', 'Start Time', 'End Time', 'Duration', 'Location');
        state.sleeps.forEach((s) => push(
            s.type,
            new Date(s.startTime).toLocaleDateString(),
            formatTime(s.startTime),
            s.endTime ? formatTime(s.endTime) : '',
            s.endTime ? formatDuration(s.endTime - s.startTime) : '',
            s.location || ''
        ));

        await deliverCsv(`baby-tracker-${new Date().toISOString().split('T')[0]}.csv`, rows.join('\n'));
    });

    document.getElementById('clearData').addEventListener('click', async () => {
        const shouldClear = await showConfirmDialog({
            title: 'Delete all data',
            message: 'This permanently deletes every feeding, food and sleep record. It cannot be undone.',
            confirmText: 'Delete everything',
            destructive: true
        });

        if (shouldClear) {
            await clearCollection(COLLECTIONS.feedings);
            await clearCollection(COLLECTIONS.solids);
            await clearCollection(COLLECTIONS.sleeps);
            showToast('All data deleted');
        }
    });
}

function debounce(fn, wait) {
    let handle = null;
    return (...args) => {
        clearTimeout(handle);
        handle = setTimeout(() => fn(...args), wait);
    };
}

// A comma or quote in a note used to shift every column after it.
function csvCell(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Downscale in the browser so the photo fits comfortably inside the baby document
// rather than needing a separate storage bucket.
function downscaleImageToDataUrl(file, maxEdge) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('read-failed'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('decode-failed'));
            image.onload = () => {
                const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(image.width * scale);
                canvas.height = Math.round(image.height * scale);
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

// WKWebView ignores <a download>, so the native app has to hand the file to the
// iOS share sheet instead. On the web the anchor is still the right answer.
async function deliverCsv(filename, csv) {
    const plugin = getNativeTimerLiveActivityPlugin();
    if (isNativeCapacitorApp() && plugin?.shareCsv) {
        try {
            await plugin.shareCsv({ filename, contents: csv });
            return;
        } catch (error) {
            console.warn('Native share failed:', error);
            showToast('Could not open the share sheet');
            return;
        }
    }

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported');
}

// ===== Authentication Logic =====
function initAuth() {
    initAuthForms();

    let signOutDebounce = null;

    const loadingScreen = document.getElementById('loadingScreen');

    function hideLoadingScreen() {
        if (loadingScreen) {
            loadingScreen.classList.add('hidden');
            setTimeout(() => { loadingScreen.style.display = 'none'; }, 350);
        }
    }

    onAuthStateChanged(auth, (user) => {
        if (signOutDebounce) {
            clearTimeout(signOutDebounce);
            signOutDebounce = null;
        }

        state.user = user;
        if (user) {
            // User is signed in
            console.log("User signed in:", user.email);
            document.getElementById('authContainer').classList.add('hidden');
            document.getElementById('app').classList.remove('hidden');
            hideLoadingScreen();

            // Update profile info
            const emailDisplay = document.getElementById('userEmailDisplay');
            if (emailDisplay) emailDisplay.textContent = user.email;

            initListeners(); // Start listening to user's data
        } else {
            // Debounce transient null auth states seen in some simulator/native webview runs
            signOutDebounce = setTimeout(() => {
                const currentUser = auth.currentUser;
                if (currentUser) {
                    state.user = currentUser;
                    document.getElementById('authContainer').classList.add('hidden');
                    document.getElementById('app').classList.remove('hidden');
                    hideLoadingScreen();
                    initListeners();
                    return;
                }

                console.log("User signed out");
                document.getElementById('authContainer').classList.remove('hidden');
                document.getElementById('app').classList.add('hidden');
                hideLoadingScreen();
                initListeners(); // This will clear the state because !state.user
            }, 1200);
        }
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        showConfirmDialog({
            title: 'Log Out',
            message: 'Are you sure you want to log out?',
            confirmText: 'Log Out'
        }).then((shouldLogout) => {
            if (!shouldLogout) return;
            signOut(auth).then(() => {
                showToast('Logged out');
            }).catch((error) => {
                showToast('Error logging out');
                console.error(error);
            });
        });
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
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value.trim().toLowerCase();
        const password = document.getElementById('loginPassword').value;

        try {
            await withAuthRequestTimeout(signInWithEmailAndPassword(auth, email, password));
            showToast('Welcome back!');
        } catch (error) {
            const errorCode = error.code;
            const errorMessage = error.message;
            console.error("Login Error", errorCode, errorMessage);
            if (errorCode === 'auth/invalid-credential' || errorCode === 'auth/user-not-found' || errorCode === 'auth/wrong-password') {
                showToast('Invalid email or password');
            } else if (errorCode === 'auth/invalid-email') {
                showToast('Invalid email format');
            } else if (errorCode === 'auth/network-request-failed') {
                showToast('Network error. Check simulator internet and try again.');
            } else if (errorCode === 'auth/too-many-requests') {
                showToast('Too many attempts. Please wait and try again.');
            } else if (errorCode === 'auth/operation-not-supported-in-this-environment') {
                showToast('Login not supported in this simulator environment.');
            } else if (errorCode === 'auth/request-timeout') {
                showToast('Login timed out. Please try again.');
            } else {
                showToast('Login failed: ' + errorMessage);
            }
        }
    });

    // Signup Form
    document.getElementById('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signupEmail').value.trim().toLowerCase();
        const password = document.getElementById('signupPassword').value;

        if (password.length < 6) {
            showToast('Password must be at least 6 characters');
            return;
        }

        try {
            await withAuthRequestTimeout(createUserWithEmailAndPassword(auth, email, password));
            showToast('Account created!');
        } catch (error) {
            const errorCode = error.code;
            const errorMessage = error.message;
            console.error("Signup Error", errorCode, errorMessage);
            if (errorCode === 'auth/email-already-in-use') {
                try {
                    await withAuthRequestTimeout(signInWithEmailAndPassword(auth, email, password));
                    showToast('Welcome back!');
                } catch (_signInError) {
                    showToast('Email already in use');
                }
            } else if (errorCode === 'auth/weak-password') {
                showToast('Password is too weak');
            } else if (errorCode === 'auth/network-request-failed') {
                showToast('Network error. Check simulator internet and try again.');
            } else if (errorCode === 'auth/operation-not-supported-in-this-environment') {
                showToast('Signup not supported in this simulator environment.');
            } else if (errorCode === 'auth/request-timeout') {
                showToast('Signup timed out. Please try again.');
            } else {
                showToast('Signup failed: ' + errorMessage);
            }
        }
    });
}

// ===== Initialize App =====
async function init() {
    try {
        window.__APP_READY = true;

        // Always wire auth UI immediately; persistence setup runs in background.
        initAuth();

        // Try to load native capabilities immediately; retry after delay if bridge isn't ready
        await loadNativeCapabilities();
        if (isNativeCapacitorApp() && !nativeCapabilities.loaded) {
            console.log('[NativeBridge] Retrying capabilities in 500ms...');
            setTimeout(async () => {
                nativeTimerLiveActivity = null; // force re-lookup
                await loadNativeCapabilities();
                if (nativeCapabilities.loaded) {
                    console.log('[NativeBridge] Retry succeeded');
                    await refreshNotificationPermission();
                    updateSettingsUI();
                }
            }, 500);
        }

        configureAuthPersistence().catch((error) => {
            console.warn('Auth persistence setup failed:', error);
        });

        registerServiceWorker().catch((error) => {
            console.warn('Service worker setup failed:', error);
        });
        initServiceWorkerMessages();
        consumeNotificationActionFromUrl();

        initNavigation();
        initModals();
        initSelectors();
        initAmountButtons();

        initBreastfeeding();
        initBottle();
        initFormula();
        initVitamin();
        initSolidFood();
        initSleep();

        initFeedingLog();
        initFoodLog();
        initSleepLog();
        initEditFood();
        initEditFeeding();
        initEditSleep();

        initSettings();
        await refreshNotificationPermission();
        updateSettingsUI();
        startNotificationEngine();

        // Initial render will happen when listeners fire
        console.log('Baby Tracker initialized successfully');
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showToast('Error loading app. Please refresh.');
    }
}

// Start the app
document.addEventListener('DOMContentLoaded', init);

