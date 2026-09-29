"use strict";

// Run with `node --test tests/content-rendering.test.cjs` and Playwright available
// through node_modules or NODE_PATH. All browser requests are fulfilled locally.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const source = readFileSync(
  process.env.HRFB_CONTENT_SCRIPT || path.join(root, "content.js"),
  "utf8",
);
const css = readFileSync(path.join(root, "content.css"), "utf8");
const imageSource = (color) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${color}"/></svg>`,
)}`;
const reactions = [
  ["like", "Like", "blue"],
  ["love", "Love", "red"],
  ["haha", "Haha", "yellow"],
];

function summary(id, comment = false) {
  const images = reactions.map(([key, label, color]) => {
    const image = `<img role="presentation" width="16" height="16" alt="${label}" src="${imageSource(color)}">`;
    return comment
      ? `<span data-reaction="${key}">${image}</span>`
      : `<span role="button" aria-label="${label}: 1 person" data-reaction="${key}">${image}</span>`;
  }).join("");
  const markup = `<div id="${id}" role="${comment ? "button" : "toolbar"}" aria-label="See who reacted">${images}<span data-count>3</span></div>`;
  return comment ? `<article role="article">${markup}</article>` : markup;
}

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function fixture(t, { html = "", mode = "like-only", early = false } = {}) {
  const page = await browser.newPage();
  t.after(() => page.close());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><head></head><body></body></html>",
  }));
  await page.goto("https://www.facebook.com/");
  await page.evaluate(({ mode, html, css, early }) => {
    const listeners = [];
    window.__messages = [];
    window.__frameIds = new Set();
    window.__cancelledFrames = 0;
    const nativeFrame = window.requestAnimationFrame.bind(window);
    const nativeCancel = window.cancelAnimationFrame.bind(window);
    window.__nextFrame = () => new Promise(nativeFrame);
    window.requestAnimationFrame = (callback) => {
      const id = nativeFrame((timestamp) => {
        window.__frameIds.delete(id);
        callback(timestamp);
      });
      window.__frameIds.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (window.__frameIds.delete(id)) window.__cancelledFrames += 1;
      nativeCancel(id);
    };
    window.chrome = {
      i18n: { getMessage: () => "" },
      storage: {
        sync: {
          get: async () => ({ reactionMode: mode }),
          set: async () => {},
          remove: async () => {},
        },
        onChanged: { addListener: (listener) => listeners.push(listener) },
      },
      runtime: {
        sendMessage: async (message) => {
          window.__messages.push(message);
          return { ok: true, version: message.version, operationId: message.operationId };
        },
      },
    };
    window.__setMode = (newValue) => {
      listeners.forEach((listener) => listener({ reactionMode: { newValue } }, "sync"));
    };
    window.__visibility = (id) => {
      const element = document.getElementById(id);
      return {
        images: [...element.querySelectorAll("img")].map((image) => image.getClientRects().length > 0),
        count: element.querySelector("[data-count]").getClientRects().length > 0,
      };
    };
    if (early) {
      document.documentElement.remove();
    } else {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
      document.body.innerHTML = html;
    }
  }, { mode, html, css, early });
  await page.evaluate((source) => (0, eval)(source), source);
  return { page, errors };
}

async function settle(page) {
  await page.evaluate(async () => {
    await window.__nextFrame();
    await window.__nextFrame();
  });
}

async function waitForHidden(page, id) {
  await page.waitForFunction((id) => !window.__visibility(id).images[1], id, { timeout: 1500 });
}

test("動態新增的貼文與留言反應會在下一幀隱藏，總數保持可見", async (t) => {
  const { page, errors } = await fixture(t);
  await settle(page);
  const visibility = await page.evaluate(async (html) => {
    await window.__nextFrame();
    document.body.insertAdjacentHTML("beforeend", html);
    await Promise.resolve(); // Deliver the mutation before scheduling our next-frame check.
    await window.__nextFrame();
    return [window.__visibility("post"), window.__visibility("comment")];
  }, summary("post") + summary("comment", true));
  assert.deepEqual(visibility, [
    { images: [true, false, false], count: true },
    { images: [true, false, false], count: true },
  ]);
  assert.deepEqual(errors, []);
});

for (const attribute of ["aria-label", "src"]) {
  test(`${attribute} 變動至重掃完成前，已隱藏的反應保持隱藏`, async (t) => {
    const { page, errors } = await fixture(t, { html: summary("post") + summary("comment", true) });
    await waitForHidden(page, "post");
    const visibility = await page.evaluate(async (attribute) => {
      for (const id of ["post", "comment"]) {
        const element = document.getElementById(id);
        if (attribute === "aria-label") {
          element.setAttribute(attribute, "View who reacted");
        } else {
          const image = element.querySelector('[data-reaction="love"] img');
          image.setAttribute(attribute, image.getAttribute(attribute).replace("red", "pink"));
        }
      }
      await Promise.resolve();
      const beforeFrame = [window.__visibility("post"), window.__visibility("comment")];
      await window.__nextFrame();
      return { beforeFrame, afterFrame: [window.__visibility("post"), window.__visibility("comment")] };
    }, attribute);
    const expected = [
      { images: [true, false, false], count: true },
      { images: [true, false, false], count: true },
    ];
    assert.deepEqual(visibility.beforeFrame, expected);
    assert.deepEqual(visibility.afterFrame, expected);
    assert.deepEqual(errors, []);
  });
}

test("四種模式保留總數，重掃和模式切換不重複計入統計", async (t) => {
  const { page, errors } = await fixture(t, { html: summary("post") + summary("comment", true) });
  await waitForHidden(page, "post");
  for (const [mode, expected] of [
    ["hide-all", [false, false, false]],
    ["show-one", [true, false, false]],
    ["disabled", [true, true, true]],
    ["like-only", [true, false, false]],
  ]) {
    await page.evaluate((mode) => window.__setMode(mode), mode);
    await settle(page);
    assert.deepEqual(await page.evaluate(() => [window.__visibility("post"), window.__visibility("comment")]), [
      { images: expected, count: true },
      { images: expected, count: true },
    ], mode);
  }
  await page.evaluate(() => {
    document.getElementById("post").setAttribute("aria-label", "View who reacted");
    document.getElementById("comment").setAttribute("aria-label", "View who reacted");
  });
  await settle(page);
  const totals = await page.evaluate(async () => {
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    const totals = {};
    for (const message of window.__messages) {
      for (const [key, count] of Object.entries(message.delta)) {
        totals[key] = (totals[key] || 0) + count;
      }
    }
    return totals;
  });
  assert.deepEqual(totals, { love: 2, haha: 2, like: 2 });
  assert.deepEqual(errors, []);
});

test("停用會取消待執行的掃描，並還原已隱藏和後續新增的反應", async (t) => {
  const { page, errors } = await fixture(t, { html: summary("post") });
  await waitForHidden(page, "post");
  const result = await page.evaluate(async (html) => {
    document.body.insertAdjacentHTML("beforeend", html);
    await Promise.resolve();
    const queued = window.__frameIds.size;
    window.__setMode("disabled");
    const remaining = window.__frameIds.size;
    await window.__nextFrame();
    await window.__nextFrame();
    return {
      queued,
      remaining,
      cancelled: window.__cancelledFrames,
      visibility: [window.__visibility("post"), window.__visibility("new-post")],
    };
  }, summary("new-post"));
  assert.equal(result.queued, 1);
  assert.equal(result.remaining, 0);
  assert.equal(result.cancelled, 1);
  assert.deepEqual(result.visibility, [
    { images: [true, true, true], count: true },
    { images: [true, true, true], count: true },
  ]);
  assert.deepEqual(errors, []);
});

test("已處理的摘要失去反應語意後，同一幀還原圖示", async (t) => {
  const { page, errors } = await fixture(t, { html: summary("post") + summary("comment", true) });
  await waitForHidden(page, "post");
  const result = await page.evaluate(async () => {
    document.getElementById("post").setAttribute("role", "group");
    document.getElementById("comment").setAttribute("aria-label", "Open profile");
    await Promise.resolve();
    const beforeFrame = [window.__visibility("post"), window.__visibility("comment")];
    await window.__nextFrame();
    return { beforeFrame, afterFrame: [window.__visibility("post"), window.__visibility("comment")] };
  });
  assert.deepEqual(result.beforeFrame, [
    { images: [true, false, false], count: true },
    { images: [true, false, false], count: true },
  ]);
  assert.deepEqual(result.afterFrame, [
    { images: [true, true, true], count: true },
    { images: [true, true, true], count: true },
  ]);
  assert.deepEqual(errors, []);
});

test("documentElement 尚未建立時啟動仍可觀察稍後建立的內容", async (t) => {
  const { page, errors } = await fixture(t, { early: true });
  await page.evaluate(async ({ css, html }) => {
    await Promise.resolve();
    const root = document.createElement("html");
    root.innerHTML = `<head><style>${css}</style></head><body>${html}</body>`;
    document.append(root);
  }, { css, html: summary("post") });
  await waitForHidden(page, "post");
  assert.deepEqual(await page.evaluate(() => window.__visibility("post")), {
    images: [true, false, false], count: true,
  });
  assert.deepEqual(errors, []);
});
