(() => {
  "use strict";

  const STORAGE_KEY = "reactionMode";
  const LEGACY_STORAGE_KEY = "option";
  const RECORD_REACTIONS_MESSAGE_TYPE = "hrfb:record-hidden-reactions";
  const STATS_VERSION = 1;
  const MAX_DELTA_PER_REACTION = 10000;
  const DEFAULT_MODE = "like-only";
  const MODES = new Set(["like-only", "hide-all", "show-one", "disabled"]);
  const LEGACY_MODES = {
    "0": "hide-all",
    "1": "show-one",
    "2": "disabled",
  };

  const POST_SUMMARY_SELECTOR = '[role="toolbar"][aria-label]';
  const COMMENT_SUMMARY_SELECTOR = '[role="button"][aria-label]';
  const EXCLUDED_CONTEXT_SELECTOR = [
    '[role="menu"]',
    '[role="listbox"]',
    '[role="tooltip"]',
    '[role="textbox"]',
    '[contenteditable="true"]',
  ].join(",");

  const HIDDEN_ITEM_CLASS = "hrfb-reaction-item-hidden";
  const MANAGED_POST_CLASS = "hrfb-managed-post-summary";
  const MANAGED_COMMENT_CLASS = "hrfb-managed-comment-summary";
  const MANAGED_CLASSES = [
    HIDDEN_ITEM_CLASS,
    MANAGED_POST_CLASS,
    MANAGED_COMMENT_CLASS,
  ];
  const MANAGED_MARKER_SELECTOR = `.${MANAGED_POST_CLASS}, .${MANAGED_COMMENT_CLASS}`;

  const REACTION_SUMMARY_LABEL_PATTERNS = [
    /\b(?:see|view)\b.*\b(?:who\s+)?react(?:ed|ions?)\b/i,
    /^\s*[\d,.]+\s+(?:people\s+)?react(?:ed|ions?)\s*$/i,
    /(?:查看|看看).*(?:誰|哪些人).*(?:回應|反應|按讚|心情)/u,
    /(?:查看|看看).*(?:谁|哪些人).*(?:回应|反应|点赞|心情)/u,
    /reacci(?:ón|ones)|reaccion(?:ó|aron)/iu,
    /reaç(?:ão|ões)|reagiu/iu,
    /réagi|réaction/iu,
    /reagiert|reaktion/iu,
    /reazione|reagito/iu,
    /gereageerd|reacties?/iu,
    /リアクション/u,
    /공감|반응/u,
    /реакц|отреаг/iu,
    /реакц|відреаг/iu,
    /ifade|tepki/iu,
    /تفاعل/u,
    /واکنش/u,
    /תגובה|הגיב/u,
    /प्रतिक्रिया/u,
    /reaksi/iu,
    /ความรู้สึก|การตอบสนอง/u,
    /cảm xúc|bày tỏ/iu,
    /reaction/iu,
    /reakcj/iu,
    /реакц|реагир/iu,
    /প্রতিক্রিয়া/u,
    /reacci/iu,
    /reakc/iu,
    /reaktion/iu,
    /αντίδραση|αντέδρασε/iu,
    /reaktsioon/iu,
    /reaktio/iu,
    /reakció/iu,
    /reacț|reacţie|reacție/iu,
    /odziv/iu,
    /reaksjon/iu,
    /ምላሽ/u,
    /પ્રતિક્રિયા/u,
    /ಪ್ರತಿಕ್ರಿಯೆ/u,
    /പ്രതികരണം/u,
    /प्रतिक्रिया/u,
    /hisia/iu,
    /எதிர்வினை/u,
    /ప్రతిస్పందన/u,
  ];
  const COUNT_TEXT_PATTERN = /^\s*[\d０-９][\d０-９\s.,，.萬万億亿kKmM]*\s*$/u;
  const SUPPORTED_POST_PATH_PATTERNS = [
    /\/posts\//u,
    /^\/(?:permalink|story|photo)\.php$/u,
    /^\/photo(?:\/|$)/u,
    /^\/share\/(?:p|v)\//u,
    /\/videos?\//u,
  ];
  const EXCLUDED_PATH_PREFIXES = [
    "/events",
    "/gaming",
    "/groups",
    "/marketplace",
    "/messages",
    "/reel",
    "/watch",
  ];

  let currentMode = DEFAULT_MODE;
  let observerIsRunning = false;
  let scanTimer = null;
  let lastPageWasSupported = null;
  let statsFlushTimer = null;
  let activeStatsOperation = null;
  const pendingRoots = new Set();
  const pendingReactionDeltas = new Map();
  const detachedStatsOperations = new Map();
  const knownReactionsBySource = new Map();
  const countedHiddenImageSignatures = new WeakMap();

  const observer = new MutationObserver((mutations) => {
    if (currentMode === "disabled") {
      return;
    }

    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const managedRoot = restoreManagedBranch(mutation.target);
        if (managedRoot) {
          enqueueScan(managedRoot);
        } else if (
          mutation.target.matches?.(`${POST_SUMMARY_SELECTOR}, ${COMMENT_SUMMARY_SELECTOR}`)
        ) {
          enqueueScan(mutation.target);
        }
        continue;
      }

      const addedElements = Array.from(mutation.addedNodes).filter(
        (node) => node.nodeType === Node.ELEMENT_NODE,
      );

      if (addedElements.length === 1) {
        enqueueScan(addedElements[0]);
      } else {
        enqueueScan(mutation.target);
      }
    }
  });

  function isReactionSummaryLabel(label) {
    return REACTION_SUMMARY_LABEL_PATTERNS.some((pattern) => pattern.test(label));
  }

  function isSupportedPage() {
    const path = window.location.pathname;

    if (
      EXCLUDED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    ) {
      return false;
    }

    return path === "/" || SUPPORTED_POST_PATH_PATTERNS.some((pattern) => pattern.test(path));
  }

  function pageCanBeProcessed() {
    const isSupported = isSupportedPage();
    const returnedToSupportedPage = isSupported && lastPageWasSupported === false;

    if (!isSupported && lastPageWasSupported !== false) {
      restoreAll();
    }

    lastPageWasSupported = isSupported;

    if (returnedToSupportedPage) {
      enqueueScan(document);
    }

    return isSupported;
  }

  function isExcluded(element) {
    return element.matches("input, textarea, [aria-pressed]") ||
      Boolean(element.closest(EXCLUDED_CONTEXT_SELECTOR)) ||
      Boolean(element.querySelector("input, textarea, [aria-pressed]"));
  }

  function isReactionVisual(image) {
    const rect = image.getBoundingClientRect();
    const width = rect.width || Number(image.getAttribute("width"));
    const height = rect.height || Number(image.getAttribute("height"));
    const source = image.getAttribute("src") || "";

    if (width && height) {
      return width >= 8 && width <= 32 && height >= 8 && height <= 32;
    }

    return source.startsWith("data:image/svg+xml") && !image.getAttribute("alt");
  }

  function getReactionVisuals(root) {
    return Array.from(root.querySelectorAll('img[role="presentation"]')).filter(
      isReactionVisual,
    );
  }

  function hasSafeReactionVisualCount(element) {
    const count = getReactionVisuals(element).length;
    return count >= 1 && count <= 8;
  }

  function isPostReactionSummary(element) {
    const label = element.getAttribute("aria-label") || "";

    return element.matches(POST_SUMMARY_SELECTOR) &&
      isReactionSummaryLabel(label) &&
      !isExcluded(element) &&
      hasSafeReactionVisualCount(element) &&
      (element.textContent || "").length <= 120;
  }

  function isCommentReactionSummary(element) {
    const label = element.getAttribute("aria-label") || "";

    if (
      !element.matches(COMMENT_SUMMARY_SELECTOR) ||
      element.closest(POST_SUMMARY_SELECTOR) ||
      !element.closest('[role="article"]') ||
      !isReactionSummaryLabel(label) ||
      isExcluded(element) ||
      (element.textContent || "").length > 120 ||
      !hasSafeReactionVisualCount(element)
    ) {
      return false;
    }

    return Array.from(element.querySelectorAll("span")).some(
      (span) => span.children.length === 0 && COUNT_TEXT_PATTERN.test(span.textContent || ""),
    );
  }

  const REACTION_TYPES = [
    { key: "like", name: "讚", messageKey: "reactionLike", pattern: /^(?:like|讚|赞)$/iu },
    { key: "love", name: "大心", messageKey: "reactionLove", pattern: /^(?:love|大心|愛心|爱心)$/iu },
    { key: "care", name: "加油", messageKey: "reactionCare", pattern: /^(?:care|加油|抱抱)$/iu },
    { key: "haha", name: "哈", messageKey: "reactionHaha", pattern: /^(?:haha|哈|笑)$/iu },
    { key: "wow", name: "哇", messageKey: "reactionWow", pattern: /^(?:wow|哇)$/iu },
    { key: "sad", name: "嗚", messageKey: "reactionSad", pattern: /^(?:sad|嗚|呜)$/iu },
    { key: "angry", name: "怒", messageKey: "reactionAngry", pattern: /^(?:angry|怒)$/iu },
  ];

  function extractReactionName(image) {
    const button = image.closest('[role="button"][aria-label]');
    if (button?.closest(POST_SUMMARY_SELECTOR)) {
      const label = button.getAttribute("aria-label") || "";
      const name = label.split(/[：:]/u, 1)[0].trim();

      if (name && name.length <= 20 && !/^\d/u.test(name)) {
        return name;
      }
    }

    const alt = image.getAttribute("alt")?.trim();
    if (alt && alt.length <= 20) {
      return alt;
    }

    return null;
  }

  function getKnownReaction(name) {
    if (!name) {
      return null;
    }

    const normalizedName = name.trim().normalize("NFKC");
    return REACTION_TYPES.find((reaction) => {
      if (reaction.pattern.test(normalizedName)) {
        return true;
      }

      const localizedName = chrome.i18n.getMessage(reaction.messageKey)?.trim().normalize("NFKC");
      return Boolean(localizedName) && normalizedName.localeCompare(
        localizedName,
        undefined,
        { sensitivity: "base" },
      ) === 0;
    }) || null;
  }

  function inferReactionName(source) {
    if (!source.startsWith("data:image/svg+xml")) {
      return null;
    }

    let svg = source;
    try {
      const separatorIndex = source.indexOf(",");
      svg = decodeURIComponent(source.slice(separatorIndex + 1));
    } catch {
      return null;
    }

    const normalizedSvg = svg.toUpperCase();

    if (normalizedSvg.includes("#FF60A4") && normalizedSvg.includes("#4B280E")) {
      return "哈";
    }

    const isFaceReaction = normalizedSvg.includes("#F7B125") ||
      normalizedSvg.includes("#4B280E");
    if (normalizedSvg.includes("#0866FF") && !isFaceReaction) {
      return "讚";
    }

    return null;
  }

  function canonicalizeReactionSource(source) {
    if (source.startsWith("data:image/")) {
      return source;
    }

    try {
      const url = new URL(source);
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return source;
    }
  }

  function rememberReactionSources(root) {
    getReactionVisuals(root).forEach((image) => {
      const source = image.getAttribute("src") || image.currentSrc || "";
      const reaction = getKnownReaction(extractReactionName(image));
      if (source && reaction) {
        knownReactionsBySource.set(canonicalizeReactionSource(source), reaction);
      }
    });
  }

  function getReactionKey(image) {
    const source = image.getAttribute("src") || image.currentSrc || "";
    if (!source) {
      return null;
    }

    const canonicalSource = canonicalizeReactionSource(source);
    const inferredName = extractReactionName(image) || inferReactionName(source);
    const knownReaction = knownReactionsBySource.get(canonicalSource) ||
      getKnownReaction(inferredName);

    if (knownReaction) {
      return knownReaction.key;
    }

    return "unknown";
  }

  function getReactionSignature(image) {
    const source = image.getAttribute("src") || image.currentSrc || "";
    return source ? canonicalizeReactionSource(source) : null;
  }

  function getHiddenReactionVisuals(root) {
    const visuals = getReactionVisuals(root);

    if (currentMode === "hide-all") {
      return visuals;
    }

    if (currentMode === "show-one") {
      return visuals.slice(1);
    }

    if (currentMode === "like-only") {
      return visuals.filter((image) => getReactionKey(image) !== "like");
    }

    return [];
  }

  function scheduleStatsFlush(delay = 400) {
    if (statsFlushTimer !== null || activeStatsOperation !== null) {
      return;
    }

    statsFlushTimer = window.setTimeout(() => {
      statsFlushTimer = null;
      flushPendingReactionStats();
    }, delay);
  }

  function createStatsOperationId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replaceAll("-", "");
    }

    const values = new Uint32Array(4);
    crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
  }

  function addPendingReactionDelta(key, count) {
    pendingReactionDeltas.set(
      key,
      Math.min(Number.MAX_SAFE_INTEGER, (pendingReactionDeltas.get(key) || 0) + count),
    );
  }

  function takePendingReactionDelta() {
    const delta = {};

    Array.from(pendingReactionDeltas).forEach(([key, count]) => {
      if (!Number.isSafeInteger(count) || count <= 0) {
        pendingReactionDeltas.delete(key);
        return;
      }

      const chunk = Math.min(count, MAX_DELTA_PER_REACTION);
      delta[key] = chunk;

      if (count === chunk) {
        pendingReactionDeltas.delete(key);
      } else {
        pendingReactionDeltas.set(key, count - chunk);
      }
    });

    return delta;
  }

  async function sendActiveStatsOperation() {
    const operation = activeStatsOperation;
    if (!operation || operation.inFlight) {
      return;
    }

    operation.inFlight = true;
    let succeeded = false;

    try {
      const response = await chrome.runtime.sendMessage({
        type: RECORD_REACTIONS_MESSAGE_TYPE,
        version: STATS_VERSION,
        operationId: operation.id,
        delta: operation.delta,
      });

      if (
        !response?.ok ||
        response.version !== STATS_VERSION ||
        response.operationId !== operation.id
      ) {
        throw new Error("Stats update failed");
      }
      succeeded = true;
    } catch {
      // Retry this exact operation ID so the worker can acknowledge it without double-counting.
    } finally {
      operation.inFlight = false;

      if (activeStatsOperation !== operation) {
        return;
      }

      if (succeeded) {
        activeStatsOperation = null;
        if (pendingReactionDeltas.size > 0) {
          scheduleStatsFlush(0);
        }
      } else {
        operation.retryTimer = window.setTimeout(() => {
          operation.retryTimer = null;
          sendActiveStatsOperation();
        }, 2000);
      }
    }
  }

  async function sendDetachedStatsOperation(operation) {
    if (operation.inFlight) {
      return;
    }

    operation.inFlight = true;
    let succeeded = false;

    try {
      const response = await chrome.runtime.sendMessage({
        type: RECORD_REACTIONS_MESSAGE_TYPE,
        version: STATS_VERSION,
        operationId: operation.id,
        delta: operation.delta,
      });
      succeeded = response?.ok &&
        response.version === STATS_VERSION &&
        response.operationId === operation.id;
    } catch {
      // A BFCache-restored page can retry the same operation ID without double-counting.
    } finally {
      operation.inFlight = false;

      if (!detachedStatsOperations.has(operation.id)) {
        return;
      }

      if (succeeded) {
        detachedStatsOperations.delete(operation.id);
      } else {
        operation.retryTimer = window.setTimeout(() => {
          operation.retryTimer = null;
          sendDetachedStatsOperation(operation);
        }, 2000);
      }
    }
  }

  function flushPendingReactionStats() {
    if (activeStatsOperation || pendingReactionDeltas.size === 0) {
      return;
    }

    const delta = takePendingReactionDelta();
    if (Object.keys(delta).length === 0) {
      return;
    }

    activeStatsOperation = {
      id: createStatsOperationId(),
      delta,
      inFlight: false,
      retryTimer: null,
    };
    sendActiveStatsOperation();
  }

  function flushPendingStatsBeforePageHide() {
    if (statsFlushTimer !== null) {
      window.clearTimeout(statsFlushTimer);
      statsFlushTimer = null;
    }

    if (activeStatsOperation && !activeStatsOperation.inFlight) {
      if (activeStatsOperation.retryTimer !== null) {
        window.clearTimeout(activeStatsOperation.retryTimer);
        activeStatsOperation.retryTimer = null;
      }
      sendActiveStatsOperation();
    }

    detachedStatsOperations.forEach((operation) => {
      if (!operation.inFlight) {
        if (operation.retryTimer !== null) {
          window.clearTimeout(operation.retryTimer);
          operation.retryTimer = null;
        }
        sendDetachedStatsOperation(operation);
      }
    });

    while (pendingReactionDeltas.size > 0) {
      const delta = takePendingReactionDelta();
      if (Object.keys(delta).length === 0) {
        break;
      }

      const operation = {
        id: createStatsOperationId(),
        delta,
        inFlight: false,
        retryTimer: null,
      };
      detachedStatsOperations.set(operation.id, operation);
      sendDetachedStatsOperation(operation);
    }
  }

  function recordHiddenReactionImages(images) {
    let recordedAny = false;

    images.forEach((image) => {
      const reactionKey = getReactionKey(image);
      const signature = reactionKey && getReactionSignature(image);
      if (!reactionKey || !signature) {
        return;
      }

      if (countedHiddenImageSignatures.get(image) === signature) {
        return;
      }

      countedHiddenImageSignatures.set(image, signature);
      addPendingReactionDelta(reactionKey, 1);
      recordedAny = true;
    });

    if (recordedAny) {
      scheduleStatsFlush();
    }
  }

  function restoreWithin(root) {
    if (!(root instanceof Element) && !(root instanceof Document)) {
      return;
    }

    if (root instanceof Element) {
      root.classList.remove(...MANAGED_CLASSES);
    }

    for (const className of MANAGED_CLASSES) {
      root.querySelectorAll(`.${className}`).forEach((element) => {
        element.classList.remove(className);
      });
    }
  }

  function restoreAll() {
    restoreWithin(document);
  }

  function containsManagedContent(root) {
    if (!(root instanceof Element)) {
      return false;
    }

    return MANAGED_CLASSES.some(
      (className) => root.classList.contains(className) || root.querySelector(`.${className}`),
    );
  }

  function restoreManagedBranch(element) {
    const isInsideManagedSummary = Boolean(element.closest(MANAGED_MARKER_SELECTOR));
    const directlyContainsManagedContent = containsManagedContent(element);

    if (!isInsideManagedSummary && !directlyContainsManagedContent) {
      return null;
    }

    let root = element;
    let highestManagedRoot = null;

    for (let depth = 0; depth < 6 && root; depth += 1) {
      if (containsManagedContent(root)) {
        highestManagedRoot = root;
      }

      root = root.parentElement;
    }

    if (highestManagedRoot) {
      restoreWithin(highestManagedRoot);
    }

    return highestManagedRoot;
  }

  function applyPostMode(toolbar) {
    restoreWithin(toolbar);
    toolbar.classList.add(MANAGED_POST_CLASS);
    rememberReactionSources(toolbar);

    const hiddenImages = getHiddenReactionVisuals(toolbar);
    hiddenImages.forEach((image) => image.classList.add(HIDDEN_ITEM_CLASS));
    recordHiddenReactionImages(hiddenImages);
  }

  function applyCommentMode(summary) {
    restoreWithin(summary);
    summary.classList.add(MANAGED_COMMENT_CLASS);
    rememberReactionSources(summary);

    const hiddenImages = getHiddenReactionVisuals(summary);
    hiddenImages.forEach((image) => image.classList.add(HIDDEN_ITEM_CLASS));
    recordHiddenReactionImages(hiddenImages);
  }

  function collectCandidates(root, selector) {
    const candidates = new Set();

    if (root instanceof Element) {
      if (root.matches(selector)) {
        candidates.add(root);
      }

      const ancestor = root.closest(selector);
      if (ancestor) {
        candidates.add(ancestor);
      }
    }

    if (root instanceof Element || root instanceof Document) {
      root.querySelectorAll(selector).forEach((element) => candidates.add(element));
    }

    return candidates;
  }

  function scan(root) {
    if (
      currentMode === "disabled" ||
      !pageCanBeProcessed() ||
      !root ||
      (root instanceof Element && !root.isConnected)
    ) {
      return;
    }

    collectCandidates(root, POST_SUMMARY_SELECTOR).forEach((element) => {
      if (isPostReactionSummary(element)) {
        applyPostMode(element);
      } else if (element.classList.contains(MANAGED_POST_CLASS)) {
        const managedRoot = restoreManagedBranch(element);
        if (managedRoot) {
          enqueueScan(managedRoot);
        }
      }
    });

    collectCandidates(root, COMMENT_SUMMARY_SELECTOR).forEach((element) => {
      if (isCommentReactionSummary(element)) {
        applyCommentMode(element);
      } else if (element.classList.contains(MANAGED_COMMENT_CLASS)) {
        const managedRoot = restoreManagedBranch(element);
        if (managedRoot) {
          enqueueScan(managedRoot);
        }
      }
    });
  }

  function flushScans() {
    scanTimer = null;
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();

    roots.forEach(scan);
  }

  function enqueueScan(root) {
    if (currentMode === "disabled") {
      return;
    }

    if (!(root instanceof Element) && !(root instanceof Document)) {
      return;
    }

    if (root === document) {
      pendingRoots.clear();
      pendingRoots.add(document);
    } else {
      if (pendingRoots.has(document)) {
        return;
      }

      for (const existing of pendingRoots) {
        if (existing instanceof Element && existing.contains(root)) {
          return;
        }

        if (root.contains(existing)) {
          pendingRoots.delete(existing);
        }
      }

      pendingRoots.add(root);
    }

    if (scanTimer === null) {
      scanTimer = window.setTimeout(flushScans, 80);
    }
  }

  function startObserver() {
    if (observerIsRunning) {
      return;
    }

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "role", "src", "alt"],
    });
    observerIsRunning = true;
  }

  function stopObserver() {
    if (!observerIsRunning) {
      return;
    }

    observer.disconnect();
    observerIsRunning = false;
  }

  async function loadMode() {
    const stored = await chrome.storage.sync.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);

    if (MODES.has(stored[STORAGE_KEY])) {
      return stored[STORAGE_KEY];
    }

    const migratedMode = LEGACY_MODES[String(stored[LEGACY_STORAGE_KEY])];
    if (migratedMode) {
      await chrome.storage.sync.set({ [STORAGE_KEY]: migratedMode });
      await chrome.storage.sync.remove(LEGACY_STORAGE_KEY);
      return migratedMode;
    }

    return DEFAULT_MODE;
  }

  function setMode(mode) {
    if (!MODES.has(mode)) {
      return;
    }

    currentMode = mode;
    lastPageWasSupported = null;
    pendingRoots.clear();

    if (scanTimer !== null) {
      window.clearTimeout(scanTimer);
      scanTimer = null;
    }

    restoreAll();

    if (mode === "disabled") {
      stopObserver();
      return;
    }

    startObserver();
    enqueueScan(document);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[STORAGE_KEY]) {
      return;
    }

    setMode(changes[STORAGE_KEY].newValue);
  });

  window.addEventListener("pagehide", flushPendingStatsBeforePageHide);

  loadMode()
    .then(setMode)
    .catch(() => setMode(DEFAULT_MODE));
})();
