(() => {
  "use strict";

  const cfg = window.TLR_CONFIG || {};
  const API_BASE = String(cfg.API_BASE_URL || "").replace(/\/$/, "");
  const TOKEN_KEY = "tlr_session_token";
  const $ = (selector, root = document) => root.querySelector(selector);

  let currentUser = null;
  let staffCache = [];
  let editingStaffIcon = "";

  const show = (element, visible = true) => element?.classList.toggle("hidden", !visible);
  const setResult = (element, message, error = false) => {
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("error", error);
  };
  const token = () => localStorage.getItem(TOKEN_KEY) || "";

  const request = async (path, options = {}, authenticated = false) => {
    if (!API_BASE) throw new Error("The website backend is not connected yet.");
    const headers = { "Accept": "application/json", ...(options.headers || {}) };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (authenticated && token()) headers.Authorization = `Bearer ${token()}`;
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    let data = {};
    try { data = await response.json(); } catch { /* no response body */ }
    if (!response.ok) throw new Error(data.detail || data.message || `Request failed (${response.status}).`);
    return data;
  };

  const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const imageToDataUrl = (file, maxWidth = 1600, quality = .86) => new Promise((resolve, reject) => {
    if (!file) return resolve("");
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error("Use a PNG, JPEG, or WebP image."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("The image could not be opened."));
      image.onload = () => {
        const scale = Math.min(1, maxWidth / image.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve(canvas.toDataURL(mime, quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const showLoggedOut = () => {
    show($("#account-loading-view"), false);
    show($("#logged-out-view"), true);
    show($("#logged-in-view"), false);
  };

  const renderUser = (user) => {
    currentUser = user;
    show($("#account-loading-view"), false);
    show($("#logged-out-view"), false);
    show($("#logged-in-view"), true);

    $("#profile-name").textContent = user.minecraft_name || "Realm Traveler";
    $("#profile-title").textContent = user.display_title || user.playtime_rank || "Traveler";
    $("#profile-email").textContent = user.email;
    $("#metric-playtime").textContent = `${Math.floor((user.playtime_minutes || 0) / 60)}h`;
    $("#metric-quests").textContent = String(user.quests_completed || 0);
    $("#metric-achievements").textContent = String(user.achievements || 0);
    $("#metric-friends").textContent = String(user.friends || 0);
    $("#details-email").textContent = user.email;
    $("#details-created").textContent = formatDate(user.created_at);
    $("#details-login").textContent = formatDate(user.last_login);
    $("#details-id").textContent = String(user.id);

    const badges = $("#profile-badges");
    badges.innerHTML = `<span class="badge">${escapeHtml(user.playtime_rank || "Traveler")}</span>${user.is_admin ? '<span class="badge">Administrator</span>' : ""}`;

    const linked = Boolean(user.minecraft_name && user.minecraft_uuid);
    show($("#minecraft-unlinked-content"), !linked);
    show($("#minecraft-linked-content"), linked);
    $("#minecraft-state").textContent = linked ? "Linked" : "Not linked";
    $("#minecraft-heading").textContent = linked ? "Minecraft account linked" : "Link your Minecraft account";

    if (linked) {
      $("#linked-minecraft-name").textContent = user.minecraft_name;
      $("#linked-minecraft-head").src = `https://mc-heads.net/avatar/${encodeURIComponent(user.minecraft_name)}/96`;
      const head = $("#profile-head");
      head.src = `https://mc-heads.net/avatar/${encodeURIComponent(user.minecraft_name)}/128`;
      show(head, true);
      show($("#profile-placeholder"), false);
    }

    show($("#admin-console"), Boolean(user.is_admin));
    if (user.is_admin) loadAdmin();
  };

  const loadSession = async () => {
    if (!token()) return showLoggedOut();
    try { renderUser(await request("/api/me", {}, true)); }
    catch {
      localStorage.removeItem(TOKEN_KEY);
      showLoggedOut();
    }
  };

  const setupAuthentication = () => {
    const requestForm = $("#request-code-form");
    const verifyForm = $("#verify-code-form");
    const result = $("#auth-result");

    requestForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = $("#email").value.trim();
      setResult(result, "Sending your sign-in code...");
      try {
        const data = await request("/api/auth/request-code", { method: "POST", body: JSON.stringify({ email }) });
        $("#code-email-label").textContent = email;
        verifyForm.dataset.email = email;
        show(requestForm, false);
        show(verifyForm, true);
        setResult(result, data.dev_code ? `${data.message} Code: ${data.dev_code}` : data.message);
      } catch (error) { setResult(result, error.message, true); }
    });

    verifyForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      setResult(result, "Verifying your code...");
      try {
        const data = await request("/api/auth/verify-code", {
          method: "POST",
          body: JSON.stringify({ email: verifyForm.dataset.email, code: $("#code").value.trim() })
        });
        localStorage.setItem(TOKEN_KEY, data.token);
        await loadSession();
      } catch (error) { setResult(result, error.message, true); }
    });

    $("#resend-code-button")?.addEventListener("click", () => {
      show(verifyForm, false); show(requestForm, true); requestForm.requestSubmit();
    });
    $("#change-email-button")?.addEventListener("click", () => {
      show(verifyForm, false); show(requestForm, true); setResult(result, "");
    });
  };

  const setupAccountActions = () => {
    $("#logout-button")?.addEventListener("click", async () => {
      try { await request("/api/auth/logout", { method: "POST" }, true); } catch { /* clear locally */ }
      localStorage.removeItem(TOKEN_KEY); location.reload();
    });

    $("#link-minecraft-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = $("#link-result");
      try {
        const data = await request("/api/account/link", { method: "POST", body: JSON.stringify({ code: $("#link-code").value.trim() }) }, true);
        setResult(result, data.message);
        renderUser(await request("/api/me", {}, true));
      } catch (error) { setResult(result, error.message, true); }
    });

    $("#request-data-button")?.addEventListener("click", async () => {
      const result = $("#privacy-result");
      try { setResult(result, (await request("/api/account/request-data", { method: "POST" }, true)).message); }
      catch (error) { setResult(result, error.message, true); }
    });

    $("#delete-account-button")?.addEventListener("click", async () => {
      if (!confirm("Permanently delete this Lost Realm website account? This cannot be undone.")) return;
      const result = $("#privacy-result");
      try {
        const data = await request("/api/account", { method: "DELETE" }, true);
        localStorage.removeItem(TOKEN_KEY);
        alert(data.message);
        location.reload();
      } catch (error) { setResult(result, error.message, true); }
    });
  };

  const resetStaffForm = () => {
    $("#admin-staff-form")?.reset();
    $("#staff-id").value = "";
    $("#staff-order").value = "100";
    $("#staff-visible").checked = true;
    editingStaffIcon = "";
    show($("#cancel-staff-edit"), false);
  };

  const renderAdminStaff = () => {
    const list = $("#admin-staff-list");
    if (!list) return;
    list.innerHTML = staffCache.map((member) => `
      <div class="admin-list-item">
        ${member.icon_url ? `<img src="${escapeHtml(member.icon_url)}" alt="">` : `<span class="admin-avatar-fallback">${escapeHtml(member.name.slice(0, 1))}</span>`}
        <div><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(member.role)} • Order ${member.sort_order}${member.visible ? "" : " • Hidden"}</span></div>
        <div class="admin-item-actions">
          <button class="button-small button-ghost" type="button" data-edit-staff="${member.id}">Edit</button>
          <button class="button-small danger-button" type="button" data-delete-staff="${member.id}">Delete</button>
        </div>
      </div>`).join("");

    list.querySelectorAll("[data-edit-staff]").forEach((button) => button.addEventListener("click", () => {
      const member = staffCache.find((item) => item.id === Number(button.dataset.editStaff));
      if (!member) return;
      $("#staff-id").value = String(member.id);
      $("#staff-name").value = member.name;
      $("#staff-role").value = member.role;
      $("#staff-description").value = member.description || "";
      $("#staff-youtube").value = member.youtube_url || "";
      $("#staff-order").value = String(member.sort_order ?? 100);
      $("#staff-visible").checked = Boolean(member.visible);
      editingStaffIcon = member.icon_url || "";
      show($("#cancel-staff-edit"), true);
      $("#staff-name").focus();
    }));

    list.querySelectorAll("[data-delete-staff]").forEach((button) => button.addEventListener("click", async () => {
      if (!confirm("Remove this staff member from the website?")) return;
      const result = $("#staff-admin-result");
      try {
        const data = await request(`/api/admin/staff/${button.dataset.deleteStaff}`, { method: "DELETE" }, true);
        setResult(result, data.message);
        await loadStaffAdmin();
      } catch (error) { setResult(result, error.message, true); }
    }));
  };

  const loadStaffAdmin = async () => {
    const data = await request("/api/admin/staff", {}, true);
    staffCache = data.staff || [];
    renderAdminStaff();
  };

  const setupStaffAdmin = () => {
    $("#cancel-staff-edit")?.addEventListener("click", resetStaffForm);
    $("#admin-staff-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = $("#staff-admin-result");
      setResult(result, "Saving staff member...");
      try {
        const file = $("#staff-icon").files[0];
        const iconUrl = file ? await imageToDataUrl(file, 600, .88) : editingStaffIcon;
        const payload = {
          name: $("#staff-name").value.trim(),
          role: $("#staff-role").value.trim(),
          description: $("#staff-description").value.trim(),
          youtube_url: $("#staff-youtube").value.trim(),
          icon_url: iconUrl,
          sort_order: Number($("#staff-order").value || 100),
          visible: $("#staff-visible").checked,
        };
        const id = $("#staff-id").value;
        const data = await request(id ? `/api/admin/staff/${id}` : "/api/admin/staff", {
          method: id ? "PUT" : "POST",
          body: JSON.stringify(payload),
        }, true);
        setResult(result, data.message);
        resetStaffForm();
        await loadStaffAdmin();
      } catch (error) { setResult(result, error.message, true); }
    });
  };

  const renderImageAdmin = (images) => {
    const list = $("#admin-image-list");
    if (!list) return;
    list.innerHTML = images.map((image) => `
      <div class="media-manager-item" data-image-slot="${escapeHtml(image.slot)}">
        <div class="media-preview" style="${image.image_url ? `background-image:url('${escapeHtml(image.image_url)}')` : ""}"><span>${image.image_url ? "" : "Built-in artwork"}</span></div>
        <div class="media-copy"><strong>${escapeHtml(image.label)}</strong><small>${escapeHtml(image.slot)}</small><input type="file" accept="image/png,image/jpeg,image/webp"></div>
        <div class="admin-item-actions"><button class="button-small" type="button" data-save-image>Save Image</button><button class="button-small button-ghost" type="button" data-reset-image>Reset</button></div>
      </div>`).join("");

    list.querySelectorAll("[data-save-image]").forEach((button) => button.addEventListener("click", async () => {
      const row = button.closest("[data-image-slot]");
      const file = row.querySelector("input[type=file]").files[0];
      const result = $("#image-admin-result");
      if (!file) return setResult(result, "Choose an image first.", true);
      try {
        setResult(result, "Preparing and uploading the image...");
        const imageUrl = await imageToDataUrl(file, 1800, .84);
        const data = await request(`/api/admin/site-images/${row.dataset.imageSlot}`, { method: "PUT", body: JSON.stringify({ image_url: imageUrl }) }, true);
        setResult(result, data.message);
        await loadImageAdmin();
      } catch (error) { setResult(result, error.message, true); }
    }));

    list.querySelectorAll("[data-reset-image]").forEach((button) => button.addEventListener("click", async () => {
      const row = button.closest("[data-image-slot]");
      const result = $("#image-admin-result");
      try {
        const data = await request(`/api/admin/site-images/${row.dataset.imageSlot}`, { method: "DELETE" }, true);
        setResult(result, data.message);
        await loadImageAdmin();
      } catch (error) { setResult(result, error.message, true); }
    }));
  };

  const loadImageAdmin = async () => renderImageAdmin((await request("/api/admin/site-images", {}, true)).images || []);

  const loadAdmin = async () => {
    try {
      const summary = await request("/api/admin/summary", {}, true);
      $("#admin-total-accounts").textContent = String(summary.total_accounts || 0);
      $("#admin-linked-accounts").textContent = String(summary.linked_accounts || 0);
      await Promise.all([loadStaffAdmin(), loadImageAdmin()]);
    } catch (error) {
      setResult($("#staff-admin-result"), error.message, true);
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    setupAuthentication();
    setupAccountActions();
    setupStaffAdmin();
    loadSession();
  });
})();
