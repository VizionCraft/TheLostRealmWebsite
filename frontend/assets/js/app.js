(() => {
  "use strict";

  const cfg = window.TLR_CONFIG || {};
  const API_BASE = String(cfg.API_BASE_URL || "").replace(/\/$/, "");

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const toast = (message) => {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(window.__tlrToastTimer);
    window.__tlrToastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  };

  const copyText = async (text, successMessage) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(successMessage);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      toast(successMessage);
    }
  };

  const setupFooterPrivacy = () => {
    $$(".site-footer nav").forEach((nav) => {
      if (nav.querySelector('a[href="/privacy"]')) return;
      const link = document.createElement("a");
      link.href = "/privacy";
      link.textContent = "Privacy";
      nav.appendChild(link);
    });
  };

  const setupNavigation = () => {
    const toggle = $("#nav-toggle");
    const nav = $("#main-nav");
    if (!toggle || !nav) return;

    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  };

  const setupHeader = () => {
    const header = $("#site-header");
    if (!header) return;
    const update = () => header.classList.toggle("scrolled", window.scrollY > 20);
    update();
    window.addEventListener("scroll", update, { passive: true });
  };

  const setupReveal = () => {
    const elements = $$(".reveal");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((el) => el.classList.add("visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.13 });

    elements.forEach((el) => observer.observe(el));
  };

  const setupActions = () => {
    $$("[data-copy-ip]").forEach((button) => {
      button.addEventListener("click", () => copyText(cfg.SERVER_IP || "play.thelostrealm.org", "Server IP copied."));
    });

    $$("[data-discord]").forEach((link) => {
      link.href = cfg.DISCORD_INVITE || "https://discord.gg/BAHjdnYkE5";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });

    $$("[data-preview-action]").forEach((button) => {
      button.addEventListener("click", () => toast(button.dataset.previewAction || "More information is available in the realm."));
    });
  };

  const updateStatus = async () => {
    const statusText = $("[data-server-status]");
    const statusOrb = $("[data-status-orb]");
    const statusIp = $("[data-server-ip]");
    const onlineCount = $("[data-online-count]");

    if (statusIp) statusIp.textContent = cfg.SERVER_IP || "play.thelostrealm.org";

    const setDemo = () => {
      if (statusText) statusText.textContent = "Realm status unavailable";
      if (onlineCount) onlineCount.textContent = "0";
      if (statusOrb) statusOrb.classList.add("offline");
    };

    if (!API_BASE) {
      setDemo();
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/status`, { headers: { "Accept": "application/json" } });
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const data = await response.json();

      if (statusText) {
        statusText.textContent = data.online
          ? `Online • ${data.online_players}/${data.max_players} players`
          : `Offline • 0/${data.max_players} players`;
      }
      if (onlineCount) onlineCount.textContent = String(data.online_players || 0);
      if (statusOrb) statusOrb.classList.toggle("offline", !data.online);
    } catch {
      if (cfg.DEMO_MODE) setDemo();
      else {
        if (statusText) statusText.textContent = "Server status unavailable";
        if (statusOrb) statusOrb.classList.add("offline");
      }
    }
  };

  const setupLeaderboardTabs = () => {
    const tabs = $$("[data-board]");
    const rows = $$("[data-board-row]");
    if (!tabs.length || !rows.length) return;

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((item) => item.classList.remove("active"));
        tab.classList.add("active");
        const board = tab.dataset.board;

        rows.forEach((row) => {
          const value = row.dataset[board] || row.dataset.playtime || "0";
          const valueCell = $(".board-value", row);
          if (valueCell) valueCell.textContent = value;
        });
      });
    });
  };

  const setupPortalForm = () => {
    const form = $("#portal-preview-form");
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      toast("Open the Account page to sign in to your player portal.");
    });
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const safeImageUrl = (value) => {
    const url = String(value || "").trim();
    if (!url) return "";
    if (url.startsWith("assets/img/") || url.startsWith("https://") || url.startsWith("data:image/")) return url;
    return "";
  };

  const renderStaff = (staff) => {
    const grid = $("[data-staff-grid]");
    if (!grid || !Array.isArray(staff)) return;
    if (!staff.length) {
      grid.innerHTML = '<p class="staff-empty muted">No staff profiles are currently published.</p>';
      return;
    }

    grid.innerHTML = staff.map((member) => {
      const icon = safeImageUrl(member.icon_url);
      const initial = escapeHtml(String(member.name || "?").slice(0, 1).toUpperCase());
      const youtube = String(member.youtube_url || "").startsWith("https://")
        ? `<a class="staff-social" href="${escapeHtml(member.youtube_url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(member.name)} on YouTube">YouTube</a>`
        : "";
      const head = icon
        ? `<img class="staff-head staff-head-image" src="${escapeHtml(icon)}" alt="${escapeHtml(member.name)} profile image">`
        : `<div class="staff-head">${initial}</div>`;

      return `<article class="card staff-card reveal visible">${head}<h3>${escapeHtml(member.name)}</h3><span class="role">${escapeHtml(member.role)}</span><p>${escapeHtml(member.description)}</p>${youtube}</article>`;
    }).join("");
  };

  const applyManagedImages = (images) => {
    if (!images || typeof images !== "object") return;
    $$('[data-managed-image]').forEach((element) => {
      const url = safeImageUrl(images[element.dataset.managedImage]);
      if (!url) return;
      if (element.tagName === "IMG") element.src = url;
      else if (element.classList.contains("hero")) element.style.setProperty("--managed-image", `url("${url.replaceAll('"', '%22')}")`);
      else element.style.backgroundImage = `url("${url.replaceAll('"', '%22')}")`;
    });
  };

  const loadSiteContent = async () => {
    if (!API_BASE) return;
    try {
      const response = await fetch(`${API_BASE}/api/site-content`, { headers: { "Accept": "application/json" } });
      if (!response.ok) return;
      const data = await response.json();
      renderStaff(data.staff);
      applyManagedImages(data.images);
    } catch {
      // Built-in staff and placeholder images remain visible if the API is unavailable.
    }
  };

  const setupEmbers = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = $("#ember-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    let particles = [];

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      const count = Math.min(65, Math.max(24, Math.floor(width / 24)));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: .6 + Math.random() * 1.8,
        speed: .12 + Math.random() * .45,
        drift: -.15 + Math.random() * .3,
        alpha: .08 + Math.random() * .28
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      particles.forEach((p) => {
        p.y -= p.speed;
        p.x += p.drift;
        if (p.y < -10) {
          p.y = height + 10;
          p.x = Math.random() * width;
        }
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;

        ctx.beginPath();
        ctx.fillStyle = `rgba(235, 165, 83, ${p.alpha})`;
        ctx.shadowBlur = 10;
        ctx.shadowColor = "rgba(235, 165, 83, .32)";
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
  };

  document.addEventListener("DOMContentLoaded", () => {
    const year = $("#year");
    if (year) year.textContent = new Date().getFullYear();

    setupNavigation();
    setupFooterPrivacy();
    setupHeader();
    setupReveal();
    setupActions();
    setupLeaderboardTabs();
    setupPortalForm();
    setupEmbers();
    updateStatus();
    loadSiteContent();
  });
})();
