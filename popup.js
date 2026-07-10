"use strict";

const STORAGE_KEY = "reactionMode";
const LEGACY_STORAGE_KEY = "option";
const STATS_STORAGE_PREFIX = "hiddenReactionStats:";
const STATS_VERSION = 1;
const DEFAULT_MODE = "like-only";
const MODES = new Set(["like-only", "hide-all", "show-one", "disabled"]);
const LEGACY_MODES = {
  "0": "hide-all",
  "1": "show-one",
  "2": "disabled",
};
const FALLBACK_MESSAGES = {
  popupTitle: "Hide reactions for Facebook",
  statsEmpty: "No reaction icons have been hidden yet.",
  statsReadError: "Unable to read synchronized statistics.",
  settingsReadError: "Unable to read settings. The default is being used.",
  invalidMode: "The selected mode is invalid.",
  saveSuccess: "Settings saved and applied immediately.",
  saveError: "Unable to save. Please try again later.",
  reactionLike: "Like",
  reactionLove: "Love",
  reactionCare: "Care",
  reactionHaha: "Haha",
  reactionWow: "Wow",
  reactionSad: "Sad",
  reactionAngry: "Angry",
};
const UI_LOCALE = (chrome.i18n.getMessage("@@ui_locale") || "en").replaceAll("_", "-");

function getMessage(key) {
  return chrome.i18n.getMessage(key) || FALLBACK_MESSAGES[key] || "";
}

const REACTION_DISPLAY = {
  like: { nameKey: "reactionLike", symbol: "👍" },
  love: { nameKey: "reactionLove", symbol: "❤️" },
  care: { nameKey: "reactionCare", symbol: "🤗" },
  haha: { nameKey: "reactionHaha", symbol: "😂" },
  wow: { nameKey: "reactionWow", symbol: "😮" },
  sad: { nameKey: "reactionSad", symbol: "😢" },
  angry: { nameKey: "reactionAngry", symbol: "😡" },
};
const DISPLAY_REACTION_KEYS = Object.keys(REACTION_DISPLAY);
const STORED_REACTION_KEYS = [...DISPLAY_REACTION_KEYS, "unknown"];

const modeSelect = document.querySelector("#reaction-mode");
const saveButton = document.querySelector("#save");
const status = document.querySelector("#status");
const hiddenTotal = document.querySelector("#hidden-total");
const reactionStats = document.querySelector("#reaction-stats");
const statsMessage = document.querySelector("#stats-message");
const numberFormatter = new Intl.NumberFormat(UI_LOCALE);

function showStatus(message, type) {
  status.textContent = message;
  status.dataset.type = type;
}

function localizeDocument() {
  document.documentElement.lang = UI_LOCALE;
  document.documentElement.dir = chrome.i18n.getMessage("@@bidi_dir") || "ltr";
  document.title = getMessage("popupTitle");

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const localized = getMessage(element.dataset.i18n);
    if (localized) {
      element.textContent = localized;
    }
  });

  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    const localized = getMessage(element.dataset.i18nTitle);
    if (localized) {
      element.title = localized;
      element.setAttribute("aria-label", localized);
    }
  });
}

function sanitizeCounts(value) {
  const counts = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return counts;
  }

  STORED_REACTION_KEYS.forEach((key) => {
    const count = value[key];
    if (Number.isSafeInteger(count) && count > 0) {
      counts[key] = count;
    }
  });

  return counts;
}

function addSafely(total, value) {
  return Math.min(Number.MAX_SAFE_INTEGER, total + value);
}

function aggregateSyncStats(items) {
  const counts = Object.fromEntries(DISPLAY_REACTION_KEYS.map((key) => [key, 0]));

  Object.entries(items || {}).forEach(([storageKey, shard]) => {
    if (
      !storageKey.startsWith(STATS_STORAGE_PREFIX) ||
      !shard ||
      typeof shard !== "object" ||
      Array.isArray(shard) ||
      shard.version !== STATS_VERSION
    ) {
      return;
    }

    const shardCounts = sanitizeCounts(shard.counts);
    DISPLAY_REACTION_KEYS.forEach((key) => {
      counts[key] = addSafely(counts[key], shardCounts[key] || 0);
    });
    counts.angry = addSafely(counts.angry, shardCounts.unknown || 0);
  });

  const groups = DISPLAY_REACTION_KEYS
    .filter((key) => counts[key] > 0)
    .map((key) => ({
      key,
      count: counts[key],
      name: getMessage(REACTION_DISPLAY[key].nameKey),
      symbol: REACTION_DISPLAY[key].symbol,
    }));
  const total = groups.reduce((sum, group) => addSafely(sum, group.count), 0);

  return { total, groups };
}

function renderCumulativeStats(stats) {
  hiddenTotal.textContent = numberFormatter.format(stats.total);
  reactionStats.replaceChildren();

  if (stats.groups.length === 0) {
    reactionStats.hidden = true;
    statsMessage.hidden = false;
    statsMessage.textContent = getMessage("statsEmpty");
    return;
  }

  stats.groups.forEach((group) => {
    const item = document.createElement("li");
    item.className = "reaction-stat";

    const symbol = document.createElement("span");
    symbol.className = "reaction-symbol";
    symbol.textContent = group.symbol;
    symbol.setAttribute("aria-hidden", "true");
    item.append(symbol);

    const name = document.createElement("span");
    name.className = "reaction-name";
    name.textContent = group.name;
    item.append(name);

    const count = document.createElement("strong");
    count.className = "reaction-count";
    count.textContent = numberFormatter.format(group.count);
    item.append(count);

    reactionStats.append(item);
  });

  reactionStats.hidden = false;
  statsMessage.hidden = true;
}

async function loadCumulativeStats() {
  try {
    const stored = await chrome.storage.sync.get(null);
    renderCumulativeStats(aggregateSyncStats(stored));
  } catch {
    hiddenTotal.textContent = "—";
    reactionStats.replaceChildren();
    reactionStats.hidden = true;
    statsMessage.hidden = false;
    statsMessage.textContent = getMessage("statsReadError");
  }
}

async function restoreOptions() {
  try {
    const stored = await chrome.storage.sync.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    const legacyMode = LEGACY_MODES[String(stored[LEGACY_STORAGE_KEY])];
    const mode = MODES.has(stored[STORAGE_KEY])
      ? stored[STORAGE_KEY]
      : legacyMode || DEFAULT_MODE;

    modeSelect.value = mode;

    if (legacyMode && !MODES.has(stored[STORAGE_KEY])) {
      await chrome.storage.sync.set({ [STORAGE_KEY]: legacyMode });
      await chrome.storage.sync.remove(LEGACY_STORAGE_KEY);
    }
  } catch {
    modeSelect.value = DEFAULT_MODE;
    showStatus(getMessage("settingsReadError"), "error");
  }
}

async function saveOptions() {
  const mode = modeSelect.value;
  if (!MODES.has(mode)) {
    showStatus(getMessage("invalidMode"), "error");
    return;
  }

  saveButton.disabled = true;

  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: mode });
    showStatus(getMessage("saveSuccess"), "success");
  } catch {
    showStatus(getMessage("saveError"), "error");
  } finally {
    saveButton.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  localizeDocument();
  loadCumulativeStats();
  await restoreOptions();
  saveButton.disabled = false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "sync" &&
    Object.keys(changes).some((key) => key.startsWith(STATS_STORAGE_PREFIX))
  ) {
    loadCumulativeStats();
  }
});

saveButton.addEventListener("click", saveOptions);
