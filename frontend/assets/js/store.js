(() => {
  "use strict";

  const tabs = [...document.querySelectorAll("[data-store-category]")];
  const panels = [...document.querySelectorAll("[data-store-panel]")];

  if (!tabs.length || !panels.length) return;

  const selectCategory = (category, updateHash = true) => {
    const selectedTab = tabs.find((tab) => tab.dataset.storeCategory === category) || tabs[0];
    const selectedCategory = selectedTab.dataset.storeCategory;

    tabs.forEach((tab) => {
      const active = tab === selectedTab;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    panels.forEach((panel) => {
      const active = panel.dataset.storePanel === selectedCategory;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
      if (active) {
        panel.querySelectorAll(".reveal").forEach((element) => element.classList.add("visible"));
      }
    });

    if (updateHash) {
      const url = new URL(window.location.href);
      url.hash = selectedCategory === "ranks" ? "" : selectedCategory;
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectCategory(tab.dataset.storeCategory));
    tab.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();

      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;

      const next = tabs[nextIndex];
      selectCategory(next.dataset.storeCategory);
      next.focus();
    });
  });

  const requested = window.location.hash.replace(/^#/, "");
  const valid = tabs.some((tab) => tab.dataset.storeCategory === requested);
  selectCategory(valid ? requested : "ranks", false);
})();
