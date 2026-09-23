"use strict";

(() => {
  const key = "webhooktest.theme";
  const root = document.documentElement;

  function apply(value) {
    const theme = value === "dark" ? "dark" : "light";
    root.dataset.theme = theme;
    document.querySelector('meta[name="color-scheme"]').content = theme;
    const button = document.getElementById("theme-toggle");
    if (!button) return;
    const next = theme === "dark" ? "light" : "dark";
    button.title = `Switch to ${next} theme`;
    button.querySelector(".theme-toggle-label").textContent =
      next === "dark" ? "Dark theme" : "Light theme";
    button.querySelectorAll("[data-theme-icon]").forEach((icon) => {
      icon.toggleAttribute("hidden", icon.dataset.themeIcon !== next);
    });
  }

  // Run before the stylesheets paint so a remembered dark theme never flashes
  // light. Light is the explicit default, independent of the operating system.
  let saved = "light";
  try {
    saved = localStorage.getItem(key);
  } catch {
    // Browsers can disable storage; switching should still work for this page.
  }
  apply(saved);

  document.addEventListener("DOMContentLoaded", () => {
    apply(root.dataset.theme);
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const theme = root.dataset.theme === "dark" ? "light" : "dark";
      apply(theme);
      try {
        localStorage.setItem(key, theme);
      } catch {
        // The visible theme is still usable when persistence is unavailable.
      }
    });
  });

  // Keep other open inboxes in this browser in step with the selected theme.
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
