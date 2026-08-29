(() => {
  const TOKEN_KEY = "tlr_session_token";
  const apiBase = String(window.TLR_CONFIG?.API_BASE_URL || "").replace(/\/+$/, "");
  const $ = id => document.getElementById(id);
  let kbItems = [], currentKbId = null, currentTicketId = null;

  const api = async (path, options={}) => {
    const token = localStorage.getItem(TOKEN_KEY) || "";
    const headers = new Headers(options.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await fetch(`${apiBase}${path}`, {...options, headers});
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data?.detail || `Request failed (${res.status})`);
    return data || {};
  };

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const fmt = ts => ts ? new Date(Number(ts)*1000).toLocaleString() : "";
  const result = (id, msg, bad=false) => { const el=$(id); el.textContent=msg; el.classList.toggle("error", bad); };

  async function init(){
    try {
      const me = await api("/api/me");
      if (!me?.user?.is_admin) throw new Error("Administrator access required.");
      $("support-guard").classList.add("hidden"); $("support-app").classList.remove("hidden");
      bind(); await Promise.all([loadKb(), loadQueueCount(), loadSettings()]);
    } catch(e){ $("support-guard").innerHTML=`<h3>Access unavailable</h3><p class="muted">${esc(e.message)}</p><p><a class="button" href="account.html">Open Account</a></p>`; }
  }

  function bind(){
    document.querySelectorAll(".support-tab").forEach(btn=>btn.addEventListener("click",()=>switchTab(btn.dataset.tab)));
    $("new-kb").addEventListener("click",()=>editKb(null)); $("cancel-kb").addEventListener("click",()=>$("kb-form").classList.add("hidden"));
    $("kb-form").addEventListener("submit",saveKb); $("delete-kb").addEventListener("click",deleteKb);
    $("refresh-queue").addEventListener("click",loadTickets); $("human-reply-form").addEventListener("submit",sendHumanReply);
    $("return-ai").addEventListener("click",()=>ticketAction("return-ai")); $("close-ticket").addEventListener("click",()=>ticketAction("close"));
    $("settings-form").addEventListener("submit",saveSettings);
  }

  function switchTab(tab){
    document.querySelectorAll(".support-tab").forEach(b=>{ const on=b.dataset.tab===tab; b.classList.toggle("active",on); b.classList.toggle("button",on); b.classList.toggle("button-ghost",!on); });
    ["knowledge","queue","settings"].forEach(x=>$("panel-"+x).classList.toggle("hidden",x!==tab));
    if(tab==="queue") loadTickets(); if(tab==="settings") loadSettings();
  }

  async function loadKb(){
    const data=await api("/api/admin/support/kb"); kbItems=data.items||[];
    $("kb-list").innerHTML=kbItems.length?kbItems.map(x=>`<button type="button" class="support-list-item" data-kb="${x.id}"><strong>${esc(x.title)}</strong><small>${esc(x.category)} · ${x.active?'Active':'Disabled'}</small></button>`).join(""):`<div class="support-empty">No knowledge entries yet.</div>`;
    document.querySelectorAll("[data-kb]").forEach(b=>b.addEventListener("click",()=>editKb(Number(b.dataset.kb))));
  }

  function editKb(id){
    currentKbId=id; const x=kbItems.find(k=>k.id===id)||{category:"General",title:"",tags:"",content:"",active:true};
    $("kb-id").value=id||""; $("kb-category").value=x.category||"General"; $("kb-title").value=x.title||""; $("kb-tags").value=x.tags||""; $("kb-content").value=x.content||""; $("kb-active").checked=x.active!==false;
    $("delete-kb").classList.toggle("hidden",!id); $("kb-form").classList.remove("hidden"); result("kb-result","");
  }

  async function saveKb(e){ e.preventDefault(); try{
    const body={category:$("kb-category").value,title:$("kb-title").value,tags:$("kb-tags").value,content:$("kb-content").value,active:$("kb-active").checked};
    await api(currentKbId?`/api/admin/support/kb/${currentKbId}`:"/api/admin/support/kb",{method:currentKbId?"PUT":"POST",body:JSON.stringify(body)}); result("kb-result","Saved."); await loadKb();
  }catch(e){result("kb-result",e.message,true)} }
  async function deleteKb(){ if(!currentKbId||!confirm("Delete this knowledge entry?"))return; try{await api(`/api/admin/support/kb/${currentKbId}`,{method:"DELETE"}); $("kb-form").classList.add("hidden"); await loadKb();}catch(e){result("kb-result",e.message,true)} }

  async function loadQueueCount(){ try{const d=await api("/api/admin/support/tickets?status=human"); $("queue-count").textContent=(d.tickets||[]).length;}catch{} }
  async function loadTickets(){
    try{const d=await api("/api/admin/support/tickets?status=human"); const items=d.tickets||[]; $("queue-count").textContent=items.length;
      $("ticket-list").innerHTML=items.length?items.map(t=>`<button type="button" class="support-list-item" data-ticket="${t.id}"><strong>${esc(t.subject||'Support request')}</strong><small>${esc(t.ticket_code)} · ${esc(t.sender_email)} · ${fmt(t.last_message_at)}</small></button>`).join(""):`<div class="support-empty">No conversations are waiting for a human.</div>`;
      document.querySelectorAll("[data-ticket]").forEach(b=>b.addEventListener("click",()=>openTicket(Number(b.dataset.ticket))));
    }catch(e){$("ticket-list").innerHTML=`<div class="support-empty">${esc(e.message)}</div>`}
  }
  async function openTicket(id){
    try{currentTicketId=id; const d=await api(`/api/admin/support/tickets/${id}`),t=d.ticket; $("ticket-view").classList.remove("hidden");
      $("ticket-meta").innerHTML=`<div class="support-ticket-meta"><strong>${esc(t.subject)}</strong><span>${esc(t.ticket_code)} · ${esc(t.sender_email)}</span><span class="muted">${esc(t.escalation_reason||'Human review requested.')}</span></div>`;
      $("ticket-messages").innerHTML=(d.messages||[]).map(m=>`<div class="ticket-message ${esc(m.direction)}"><small>${esc(m.direction.toUpperCase())}${m.ai_written?' · AI written':''} · ${fmt(m.created_at)}</small>${esc(m.body)}</div>`).join("");
      $("human-reply").value=""; result("ticket-result","");
    }catch(e){result("ticket-result",e.message,true)}
  }
  async function sendHumanReply(e){e.preventDefault(); if(!currentTicketId)return; try{await api(`/api/admin/support/tickets/${currentTicketId}/reply`,{method:"POST",body:JSON.stringify({reply:$("human-reply").value})}); result("ticket-result","Human reply sent."); await openTicket(currentTicketId);}catch(e){result("ticket-result",e.message,true)}}
  async function ticketAction(action){if(!currentTicketId)return; try{await api(`/api/admin/support/tickets/${currentTicketId}/${action}`,{method:"POST",body:"{}"}); $("ticket-view").classList.add("hidden"); currentTicketId=null; await loadTickets();}catch(e){result("ticket-result",e.message,true)}}

  async function loadSettings(){ try{const d=await api("/api/admin/support/settings"),s=d.settings||{}; $("set-ai-name").value=s.ai_name||""; $("set-human-phrase").value=s.human_phrase||""; $("set-signature").value=s.signature||""; $("set-footer").value=s.ai_footer||""; $("set-human-message").value=s.human_needed_message||"";}catch(e){result("settings-result",e.message,true)} }
  async function saveSettings(e){e.preventDefault();try{const settings={ai_name:$("set-ai-name").value,human_phrase:$("set-human-phrase").value,signature:$("set-signature").value,ai_footer:$("set-footer").value,human_needed_message:$("set-human-message").value};await api("/api/admin/support/settings",{method:"PUT",body:JSON.stringify({settings})});result("settings-result","Settings saved.");}catch(e){result("settings-result",e.message,true)}}

  init();
})();
