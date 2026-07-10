"use strict";

const DEVICE_ID_STORAGE_KEY = "hiddenReactionStatsDeviceId";
const PENDING_OPERATIONS_STORAGE_KEY = "hiddenReactionStatsPendingOperations";
const COMPLETED_OPERATIONS_STORAGE_KEY = "hiddenReactionStatsCompletedOperations";
const STATS_STORAGE_PREFIX = "hiddenReactionStats:";
const STATS_VERSION = 1;
const RECORD_MESSAGE_TYPE = "hrfb:record-hidden-reactions";
const REACTION_KEYS = new Set([
  "like",
  "love",
  "care",
  "haha",
  "wow",
  "sad",
  "angry",
  "unknown",
]);
const MAX_DELTA_PER_REACTION = 10000;
const MAX_RECENT_OPERATION_IDS = 64;
const MAX_OPERATIONS_PER_FLUSH = 32;
const MAX_DURABLE_OPERATIONS = 2048;
const MAX_COMPLETED_OPERATION_IDS = 4096;
const WORKER_FLUSH_DELAY = 2500;
const WORKER_RETRY_DELAY = 30000;
const OPERATION_ID_PATTERN = /^[a-f0-9]{32}$/u;

let deviceStatsKeyPromise = null;
let recoveryPromise = null;
let workerFlushTimer = null;
let workerFlushIsRunning = false;
let localStorageQueue = Promise.resolve();
let pendingOperations = new Map();
let pendingResponders = new Map();
let completedOperationIds = new Set();

function sanitizePositiveCount(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function sanitizeCounts(value) {
  const counts = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return counts;
  }

  Object.entries(value).forEach(([key, count]) => {
    if (!REACTION_KEYS.has(key)) {
      return;
    }

    const safeCount = sanitizePositiveCount(count);
    if (safeCount > 0) {
      counts[key] = safeCount;
    }
  });

  return counts;
}

function validateDelta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return null;
  }

  const delta = {};
  for (const [key, count] of entries) {
    if (
      !REACTION_KEYS.has(key) ||
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      count > MAX_DELTA_PER_REACTION
    ) {
      return null;
    }
    delta[key] = count;
  }

  return delta;
}

function sanitizeRecentOperationIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter(
    (operationId) => typeof operationId === "string" &&
      OPERATION_ID_PATTERN.test(operationId),
  ))).slice(-MAX_RECENT_OPERATION_IDS);
}

function sanitizeDurableOperations(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const operations = new Map();
  value.forEach((operation) => {
    if (
      !operation ||
      typeof operation !== "object" ||
      Array.isArray(operation) ||
      typeof operation.operationId !== "string" ||
      !OPERATION_ID_PATTERN.test(operation.operationId)
    ) {
      return;
    }

    const delta = validateDelta(operation.delta);
    if (delta && !operations.has(operation.operationId)) {
      operations.set(operation.operationId, {
        operationId: operation.operationId,
        delta,
      });
    }
  });

  return Array.from(operations.values()).slice(-MAX_DURABLE_OPERATIONS);
}

function sanitizeCompletedOperationIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter(
    (operationId) => typeof operationId === "string" &&
      OPERATION_ID_PATTERN.test(operationId),
  ))).slice(-MAX_COMPLETED_OPERATION_IDS);
}

function queueLocalStorageTask(task) {
  localStorageQueue = localStorageQueue
    .catch(() => undefined)
    .then(task);
  return localStorageQueue;
}

async function readDurableOperations() {
  const stored = await chrome.storage.local.get(PENDING_OPERATIONS_STORAGE_KEY);
  return sanitizeDurableOperations(stored[PENDING_OPERATIONS_STORAGE_KEY]);
}

function persistDurableOperation(operation) {
  return queueLocalStorageTask(async () => {
    if (completedOperationIds.has(operation.operationId)) {
      return false;
    }

    const operations = await readDurableOperations();
    if (operations.some(({ operationId }) => operationId === operation.operationId)) {
      return true;
    }

    if (operations.length >= MAX_DURABLE_OPERATIONS) {
      throw new Error("Pending statistics queue is full");
    }

    operations.push(operation);
    await chrome.storage.local.set({ [PENDING_OPERATIONS_STORAGE_KEY]: operations });
    return true;
  });
}

function completeDurableOperations(operationIds) {
  const completedIds = new Set(operationIds);
  return queueLocalStorageTask(async () => {
    const stored = await chrome.storage.local.get([
      PENDING_OPERATIONS_STORAGE_KEY,
      COMPLETED_OPERATIONS_STORAGE_KEY,
    ]);
    const operations = sanitizeDurableOperations(
      stored[PENDING_OPERATIONS_STORAGE_KEY],
    ).filter(
      ({ operationId }) => !completedIds.has(operationId),
    );
    const completed = sanitizeCompletedOperationIds(
      stored[COMPLETED_OPERATIONS_STORAGE_KEY],
    );
    const nextCompleted = Array.from(new Set([...completed, ...operationIds]))
      .slice(-MAX_COMPLETED_OPERATION_IDS);

    await chrome.storage.local.set({
      [PENDING_OPERATIONS_STORAGE_KEY]: operations,
      [COMPLETED_OPERATIONS_STORAGE_KEY]: nextCompleted,
    });
    completedOperationIds = new Set(nextCompleted);
  });
}

function ensureRecovered() {
  if (!recoveryPromise) {
    const attempt = queueLocalStorageTask(async () => {
      const stored = await chrome.storage.local.get([
        PENDING_OPERATIONS_STORAGE_KEY,
        COMPLETED_OPERATIONS_STORAGE_KEY,
      ]);
      const operations = sanitizeDurableOperations(
        stored[PENDING_OPERATIONS_STORAGE_KEY],
      );
      completedOperationIds = new Set(sanitizeCompletedOperationIds(
        stored[COMPLETED_OPERATIONS_STORAGE_KEY],
      ));
      operations.forEach(({ operationId, delta }) => {
        if (
          !completedOperationIds.has(operationId) &&
          !pendingOperations.has(operationId)
        ) {
          pendingOperations.set(operationId, delta);
        }
      });
    });

    recoveryPromise = attempt.catch((error) => {
      recoveryPromise = null;
      throw error;
    });
  }

  return recoveryPromise;
}

function wakeDurableOperations() {
  ensureRecovered()
    .then(() => {
      if (pendingOperations.size > 0) {
        scheduleWorkerFlush();
      }
    })
    .catch(() => undefined);
}

function createDeviceId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }

  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
}

async function getDeviceStatsKey() {
  if (!deviceStatsKeyPromise) {
    deviceStatsKeyPromise = (async () => {
      const stored = await chrome.storage.local.get(DEVICE_ID_STORAGE_KEY);
      let deviceId = stored[DEVICE_ID_STORAGE_KEY];

      if (typeof deviceId !== "string" || !/^[a-z0-9]{16,64}$/u.test(deviceId)) {
        deviceId = createDeviceId();
        await chrome.storage.local.set({ [DEVICE_ID_STORAGE_KEY]: deviceId });
      }

      return `${STATS_STORAGE_PREFIX}${deviceId}`;
    })();
  }

  try {
    return await deviceStatsKeyPromise;
  } catch (error) {
    deviceStatsKeyPromise = null;
    throw error;
  }
}

async function applyOperations(operations) {
  const statsKey = await getDeviceStatsKey();
  const stored = await chrome.storage.sync.get(statsKey);
  const previous = stored[statsKey];
  const counts = sanitizeCounts(previous?.counts);
  const recentOperationIds = sanitizeRecentOperationIds(previous?.recentOperationIds);
  const seenOperationIds = new Set(recentOperationIds);
  let changed = false;

  operations.forEach(({ operationId, delta }) => {
    if (seenOperationIds.has(operationId)) {
      return;
    }

    Object.entries(delta).forEach(([key, increment]) => {
      counts[key] = Math.min(
        Number.MAX_SAFE_INTEGER,
        (counts[key] || 0) + increment,
      );
    });
    recentOperationIds.push(operationId);
    seenOperationIds.add(operationId);
    changed = true;
  });

  const stats = {
    version: STATS_VERSION,
    counts,
    recentOperationIds: recentOperationIds.slice(-MAX_RECENT_OPERATION_IDS),
    updatedAt: changed ? Date.now() : previous?.updatedAt || Date.now(),
  };

  if (changed) {
    await chrome.storage.sync.set({ [statsKey]: stats });
  }

  return stats;
}

function replyToAll(responders, response) {
  responders.forEach(({ operationId, sendResponse }) => {
    try {
      sendResponse({ ...response, operationId });
    } catch {
      // The originating page may have navigated away after persistence completed.
    }
  });
}

function takeResponders(operationIds) {
  const responders = [];

  operationIds.forEach((operationId) => {
    const operationResponders = pendingResponders.get(operationId) || [];
    operationResponders.forEach((sendResponse) => {
      responders.push({ operationId, sendResponse });
    });
    pendingResponders.delete(operationId);
  });

  return responders;
}

function prependPendingOperations(operations) {
  const reordered = new Map();
  operations.forEach(({ operationId, delta }) => reordered.set(operationId, delta));
  pendingOperations.forEach((delta, operationId) => {
    if (!reordered.has(operationId)) {
      reordered.set(operationId, delta);
    }
  });
  pendingOperations = reordered;
}

async function flushWorkerOperations() {
  workerFlushTimer = null;
  if (workerFlushIsRunning) {
    return;
  }

  try {
    await ensureRecovered();
  } catch {
    scheduleWorkerFlush(WORKER_RETRY_DELAY);
    return;
  }

  const entries = Array.from(pendingOperations).slice(0, MAX_OPERATIONS_PER_FLUSH);
  if (entries.length === 0) {
    return;
  }

  workerFlushIsRunning = true;
  const operations = entries.map(([operationId, delta]) => ({ operationId, delta }));
  const operationIds = operations.map(({ operationId }) => operationId);
  operationIds.forEach((operationId) => pendingOperations.delete(operationId));
  const responders = takeResponders(operationIds);
  let nextDelay = WORKER_FLUSH_DELAY;

  try {
    const uncompletedOperations = operations.filter(
      ({ operationId }) => !completedOperationIds.has(operationId),
    );
    if (uncompletedOperations.length > 0) {
      await applyOperations(uncompletedOperations);
    }
    await completeDurableOperations(operationIds);
    replyToAll(responders, { ok: true, version: STATS_VERSION });
  } catch {
    prependPendingOperations(operations);
    replyToAll(responders, { ok: false, version: STATS_VERSION });
    nextDelay = WORKER_RETRY_DELAY;
  } finally {
    workerFlushIsRunning = false;
    if (pendingOperations.size > 0) {
      scheduleWorkerFlush(nextDelay);
    }
  }
}

function scheduleWorkerFlush(delay = WORKER_FLUSH_DELAY) {
  if (workerFlushTimer !== null || workerFlushIsRunning) {
    return;
  }

  workerFlushTimer = setTimeout(flushWorkerOperations, delay);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderUrl = sender.url || sender.tab?.url || "";
  if (
    sender.id !== chrome.runtime.id ||
    !senderUrl.startsWith("https://www.facebook.com/") ||
    message?.type !== RECORD_MESSAGE_TYPE ||
    message.version !== STATS_VERSION ||
    typeof message.operationId !== "string" ||
    !OPERATION_ID_PATTERN.test(message.operationId)
  ) {
    return undefined;
  }

  const delta = validateDelta(message.delta);
  if (!delta) {
    sendResponse({
      ok: false,
      version: STATS_VERSION,
      operationId: message.operationId,
    });
    return false;
  }

  const operation = { operationId: message.operationId, delta };
  ensureRecovered()
    .then(() => persistDurableOperation(operation))
    .then((shouldQueue) => {
      if (!shouldQueue) {
        sendResponse({
          ok: true,
          version: STATS_VERSION,
          operationId: message.operationId,
        });
        return;
      }

      if (!pendingOperations.has(message.operationId)) {
        pendingOperations.set(message.operationId, delta);
      }
      if (!pendingResponders.has(message.operationId)) {
        pendingResponders.set(message.operationId, []);
      }
      pendingResponders.get(message.operationId).push(sendResponse);
      scheduleWorkerFlush();
    })
    .catch(() => {
      sendResponse({
        ok: false,
        version: STATS_VERSION,
        operationId: message.operationId,
      });
    });
  return true;
});

chrome.runtime.onStartup.addListener(wakeDurableOperations);
chrome.runtime.onInstalled.addListener(wakeDurableOperations);
wakeDurableOperations();
