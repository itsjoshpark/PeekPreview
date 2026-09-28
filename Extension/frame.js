// Extension page that hosts the remote page, so the host page's CSP can't block the preview frame.
"use strict";

const LOAD_TIMEOUT_MS = 10000;

const params = new URLSearchParams(location.search);
const url = params.get("url") || "";
const loadingView = document.querySelector(".loading");
let frame = null;
let timeout = null;

function isWebUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function openInTab() {
  window.parent.postMessage({ type: "peek:openTab" }, "*");
}

function clearError() {
  document.querySelector(".error")?.remove();
}

function showError() {
  clearError();
  loadingView.hidden = true;

  const card = document.createElement("div");
  card.className = "error";

  const title = document.createElement("h2");
  title.textContent = "Can’t Preview This Page";

  const message = document.createElement("p");
  message.textContent =
    "The page didn’t load in the preview. It may block embedding, or the connection may have failed.";

  const address = document.createElement("div");
  address.className = "error-url";
  address.textContent = url;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Open in New Tab";
  button.addEventListener("click", openInTab);

  card.append(title, message, address, button);
  document.body.append(card);
}

function load() {
  clearTimeout(timeout);
  clearError();
  frame?.remove();
  loadingView.hidden = false;

  if (!isWebUrl(url)) {
    showError();
    return;
  }

  frame = document.createElement("iframe");
  frame.title = url;
  frame.allow = "clipboard-write; fullscreen";
  frame.addEventListener("load", () => {
    clearTimeout(timeout);
    clearError();
    loadingView.hidden = true;
  });
  frame.addEventListener("error", showError);
  frame.src = url;
  document.body.append(frame);

  // Slow pages may still finish later; the load handler clears the error if so.
  timeout = setTimeout(showError, LOAD_TIMEOUT_MS);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  if (event.data?.type === "peek:refresh") load();
  if (event.data?.type === "peek:theme") setTheme(event.data.theme);
});

setTheme(params.get("theme"));
load();
