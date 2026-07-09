/* ============================================================================
   Athena Agreements Studio — application core
   Boot, auth, profile, per-tool permissions, two-level navigation, shared
   helpers, notifications. Module files (agreement.js, modules/*.js) register
   their views into OPS.routes and read shared state from window.OPS.
   ============================================================================ */
const $ = id => document.getElementById(id);
const esc = s => (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = d => d ? new Date(d).toLocaleString() : "";
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "";
const todayISO = () => new Date().toISOString().slice(0,10);
const money = n => "₹" + (Number(n||0)).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const num = n => (n===""||n==null||isNaN(n)) ? 0 : Number(n);

// Indian fiscal year label for a date, e.g. 2026-06-25 -> "26-27"
function fyOf(dateStr){
  const d = dateStr ? new Date(dateStr) : new Date();
  const y = d.getFullYear(), m = d.getMonth(); // Apr (3) starts the FY
  const start = m >= 3 ? y : y - 1;
  return String(start%100).padStart(2,"0") + "-" + String((start+1)%100).padStart(2,"0");
}

// Shared mutable state + a place for modules to hang their views.
window.OPS = { sb:null, me:null, profile:null, perms:new Set(),
  routes:{}, currentSection:"agreement", currentTool:"agreements",
  helpers:{ $, esc, fmt, fmtDate, todayISO, money, num, fyOf } };

let sb=null, me=null, profile=null, signupMode=false;
let _inRecovery = false;   // true while the user is on the "set new password" screen (password-reset link)
const STATUS_LABEL={draft:"Draft",in_review:"In review",recommended:"Recommended",approved:"Approved",rejected:"Rejected",executed:"Executed"};

/* ---------- sections + tools registry ----------
   gate: 'all' (any signed-in) | 'approver' | 'admin' | 'perm' (admin or per-tool grant) */
const SECTIONS = [
  { key:"dashboard",  label:"Dashboard" },
  { key:"agreement",  label:"Agreements" },
  { key:"reviews",    label:"Review / Approvals" },
  { key:"negotiate",  label:"Contract Reviews" },
  { key:"library",    label:"Libraries" },
  { key:"resources",  label:"Resources" },
  { key:"team",       label:"Team & Access" },
  { key:"audit",      label:"Audit" },
];
const TOOLS = [
  // Dashboard — status snapshot
  { key:"dashboard",   section:"dashboard", label:"Dashboard",        gate:"all" },
  // Agreements — drafting + tracking
  { key:"agreements",  section:"agreement", label:"Agreements",       gate:"all" },
  { key:"new",         section:"agreement", label:"New agreement",    gate:"all" },
  { key:"templates",   section:"agreement", label:"Shared templates", gate:"approver" },
  // Review / Approvals — consolidated queue; everyone sees only their assigned items
  { key:"reviews",     section:"reviews",   label:"My Queue",         gate:"all" },
  // Contract Reviews — negotiation workspace (access is admin-grantable per tool)
  { key:"vendor_reviews", section:"negotiate", label:"Vendor reviews", gate:"perm" },
  { key:"client_reviews", section:"negotiate", label:"Client reviews", gate:"perm" },
  // Libraries — executed (signed) agreements
  { key:"vendor_library", section:"library", label:"Vendor agreements", gate:"all" },
  { key:"client_library", section:"library", label:"Client agreements", gate:"all" },
  // Resources — manual & FAQs
  { key:"manual",      section:"resources", label:"User Manual",      gate:"all" },
  { key:"faqs",        section:"resources", label:"FAQs",             gate:"all" },
  // Team & Access + Audit (admin-only)
  { key:"team",        section:"team",  label:"Team & Access", gate:"admin" },
  { key:"ai_settings", section:"team",  label:"AI prompts",    gate:"admin" },
  { key:"audit",       section:"audit", label:"Audit log",     gate:"admin" },
  { key:"access_log",  section:"audit", label:"Access Log",    gate:"admin" },
];
window.OPS.TOOLS = TOOLS; window.OPS.SECTIONS = SECTIONS;
// Tools whose access an admin can grant (the per-tool permission set)
window.OPS.PERMISSIONED_TOOLS = TOOLS.filter(t=>t.gate==="perm");
// Capabilities = grantable permissions that are NOT navigable tabs (shown in Team & Access)
const CAPABILITIES = [
  { key:"view_contacts", label:"View contacts (unmask phone numbers)" },
  { key:"can_export",    label:"Export data (CSV)" },
  { key:"can_delete",    label:"Delete records" },
];
window.OPS.CAPABILITIES = CAPABILITIES;

// ---------- boot ----------
(function boot(){
  if(!window.APP_CONFIG || !window.APP_CONFIG.SUPABASE_URL || window.APP_CONFIG.SUPABASE_URL.indexOf("YOUR-")>=0){
    $("auConfigWarn").textContent="⚠ config.js is missing your Supabase URL/key. See SETUP_OPS.md.";
    $("auGo").disabled=true; return;
  }
  // flowType 'implicit' makes email links (esp. password reset) deliver the session tokens
  // directly in the URL, so they work regardless of which browser/tab opens the link — PKCE
  // ('code' + verifier) breaks if the email opens in a different context and yields
  // "Auth session missing" on updateUser. detectSessionInUrl lets the client pick them up.
  sb = supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY, {
    auth: { flowType:"implicit", detectSessionInUrl:true, persistSession:true, autoRefreshToken:true }
  });
  window.OPS.sb = sb;
  // If we arrived from a password-reset email link, show the "set new password" screen
  // IMMEDIATELY — synchronously from the URL — so we never flash the sign-in page while
  // Supabase processes the token in the background. Covers both link styles (see helper).
  if(urlLooksLikeRecovery()){ showRecovery(); }
  // IMPORTANT: only (re)initialise the app when the *logged-in user* actually changes.
  // Supabase fires onAuthStateChange for TOKEN_REFRESHED / focus / etc.; re-running
  // afterLogin() on those would re-render the screen and wipe whatever you're typing.
  sb.auth.onAuthStateChange((evt, session)=>{
    // A password-reset link brings the user back with a temporary session and this event.
    // Show the "set new password" screen instead of dropping them into the app.
    if(evt === "PASSWORD_RECOVERY"){ showRecovery(); return; }
    handleSession(session);
  });
  sb.auth.getSession().then(({data})=>{ if(!_inRecovery) handleSession(data.session); });
})();

let _authedUserId = null;
// A password-reset email link returns the user to the app in one of two shapes depending
// on the Supabase auth flow: implicit (#access_token=...&type=recovery in the URL hash) or
// PKCE (?code=... in the query). We also stamp our own ?recovery=1 marker on the redirect
// so a PKCE return is unmistakable. Any of these means "show the set-new-password screen".
function urlLooksLikeRecovery(){
  try{
    const h = window.location.hash || "";
    const q = window.location.search || "";
    if(/(^|[#&?])type=recovery/.test(h)) return true;   // implicit-flow reset link
    if(/[?&]recovery=1/.test(q)) return true;           // our marker (covers PKCE ?code= returns)
    // This app uses only email+password + password-reset — no OAuth/magic-link — so a bare
    // ?code= return can only be a reset link even if the marker above was dropped.
    if(/[?&]code=/.test(q)) return true;
    return false;
  }catch(_){ return false; }
}
function handleSession(session){
  if(_inRecovery) return;  // don't jump into the app mid password-reset
  const u = session ? session.user : null;
  me = u; window.OPS.me = u;
  if(!u){ _authedUserId = null; showAuth(); return; }
  if(_authedUserId === u.id) return;   // already initialised for this user — ignore repeat events
  _authedUserId = u.id;
  afterLogin();
}

function showAuth(){ $("appView").classList.add("hidden"); $("resetView").classList.add("hidden"); $("authView").classList.remove("hidden"); }
function showRecovery(){ _inRecovery = true; $("appView").classList.add("hidden"); $("authView").classList.add("hidden"); $("resetView").classList.remove("hidden"); }

let _loadingProfile=false;
async function loadProfile(){
  for(let i=0;i<8;i++){
    const { data } = await sb.from("profiles").select("*").eq("id", me.id).maybeSingle();
    if(data) return data;
    await new Promise(r=>setTimeout(r, 400));
  }
  return null;
}
async function loadPerms(){
  const { data } = await sb.from("app_permissions").select("tool_key").eq("user_id", me.id);
  window.OPS.perms = new Set((data||[]).map(r=>r.tool_key));
}
async function afterLogin(){
  if(_loadingProfile) return; _loadingProfile=true;
  let data=null;
  try{ data = await loadProfile(); }catch(e){}
  _loadingProfile=false;
  profile = data || { id:me.id, email:me.email, role:"drafter", full_name:me.email };
  window.OPS.profile = profile;
  try{ await loadPerms(); }catch(e){}
  $("authView").classList.add("hidden"); $("appView").classList.remove("hidden");
  applyProfile();
}
function applyProfile(keepView){
  $("meEmail").textContent = profile.email || me.email;
  $("meRole").textContent = isExternal() ? "PARTNER" : (profile.role||"drafter").toUpperCase();
  // Always land on the home/landing page after login so the user chooses the path forward.
  // Only an in-session refresh (e.g. clicking the role chip) keeps the current view.
  if(keepView && window.OPS.currentTool && window.OPS.currentTool!=="home" && canSee(toolByKey(window.OPS.currentTool))){
    window.OPS.currentSection = (toolByKey(window.OPS.currentTool)||{}).section || null;
    renderNav(); openTool(window.OPS.currentTool);
  } else {
    goHome();
  }
  refreshNotifs(); refreshReviewCount();
  if(!window._notifPoll) window._notifPoll=setInterval(()=>{ if(me){ refreshNotifs(); refreshReviewCount(); } }, 30000);
}
async function refreshRole(){
  const data = await loadProfile();
  if(data){ profile = data; window.OPS.profile=profile; await loadPerms(); applyProfile(true); }
}

// ---------- auth UI ----------
$("auToggle").addEventListener("click",e=>{ e.preventDefault(); signupMode=!signupMode;
  $("authTitle").textContent = signupMode?"Create account":"Sign in";
  $("auGo").textContent = signupMode?"Create account":"Sign in";
  $("auNameField").classList.toggle("hidden", !signupMode);
  $("auToggleText").textContent = signupMode?"Already have an account?":"New to the workspace?";
  $("auToggle").textContent = signupMode?"Sign in":"Create an account";
  $("auErr").textContent="";
});
$("auGo").addEventListener("click", async ()=>{
  const email=$("auEmail").value.trim(), pass=$("auPass").value;
  $("auErr").textContent=""; if(!email||!pass){ $("auErr").textContent="Enter email and password."; return; }
  $("auGo").disabled=true;
  try{
    if(signupMode){
      const { error } = await sb.auth.signUp({ email, password:pass, options:{ data:{ full_name:$("auName").value.trim() } } });
      if(error) throw error;
      $("auErr").innerHTML='<span class="ok">Account created. If email confirmation is on, check your inbox; otherwise you are now signed in.</span>';
    }else{
      const { error } = await sb.auth.signInWithPassword({ email, password:pass });
      if(error) throw error;
    }
  }catch(err){ $("auErr").textContent = err.message || "Authentication failed."; }
  $("auGo").disabled=false;
});
$("btnSignOut").addEventListener("click", async ()=>{ await sb.auth.signOut(); });

// ---------- password reset ----------
// Send a reset link. The link returns to THIS app URL (must be in Supabase → Auth →
// URL Configuration → Redirect URLs), where onAuthStateChange fires PASSWORD_RECOVERY.
$("auForgot").addEventListener("click", async (e)=>{
  e.preventDefault();
  const email = $("auEmail").value.trim();
  if(!email){ $("auErr").textContent = "Type your email above first, then click “Forgot password?”."; return; }
  $("auErr").textContent = ""; $("auForgot").style.pointerEvents="none";
  try{
    const redirectTo = window.location.origin + window.location.pathname + "?recovery=1";
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if(error) throw error;
    $("auErr").innerHTML = '<span class="ok">Reset link sent. Open the email and click the link — it brings you back here to set a new password.</span>';
  }catch(err){ $("auErr").textContent = err.message || "Could not send the reset email."; }
  $("auForgot").style.pointerEvents="";
});
// Apply the new password (we already hold the temporary recovery session).
$("rsGo").addEventListener("click", async ()=>{
  const p1 = $("rsPass").value, p2 = $("rsPass2").value;
  $("rsErr").textContent = "";
  if(!p1 || p1.length < 8){ $("rsErr").textContent = "Password must be at least 8 characters."; return; }
  if(p1 !== p2){ $("rsErr").textContent = "The two passwords do not match."; return; }
  $("rsGo").disabled = true;
  try{
    // Make sure we actually hold the recovery session before updating. The client usually
    // picks it up from the URL automatically, but establish it explicitly as a fallback so
    // we never hit "Auth session missing".
    let sess = (await sb.auth.getSession()).data.session;
    if(!sess){
      const hp = new URLSearchParams((window.location.hash||"").replace(/^#/,""));
      const at = hp.get("access_token"), rt = hp.get("refresh_token");
      if(at && rt){
        await sb.auth.setSession({ access_token:at, refresh_token:rt });
      } else {
        const code = new URLSearchParams(window.location.search||"").get("code");
        if(code && sb.auth.exchangeCodeForSession){ await sb.auth.exchangeCodeForSession(code); }
      }
      sess = (await sb.auth.getSession()).data.session;
    }
    if(!sess) throw new Error("This reset link has expired or was already used. Please request a new one from “Forgot password?”.");
    const { error } = await sb.auth.updateUser({ password: p1 });
    if(error) throw error;
    _inRecovery = false;
    // strip the recovery token from the address bar, then enter the app with the live session
    try{ history.replaceState(null, "", window.location.pathname + window.location.search); }catch(_){}
    $("resetView").classList.add("hidden");
    const { data } = await sb.auth.getSession();
    handleSession(data.session);
  }catch(err){ $("rsErr").textContent = err.message || "Could not update the password."; }
  $("rsGo").disabled = false;
});
$("rsCancel").addEventListener("click", async (e)=>{
  e.preventDefault(); _inRecovery = false;
  try{ history.replaceState(null, "", window.location.pathname + window.location.search); }catch(_){}
  await sb.auth.signOut();
  showAuth();
});
(function(){ const r=$("meRole"); if(r){ r.style.cursor="pointer"; r.title="Click to refresh your role & access"; r.addEventListener("click", ()=>{ if(me) refreshRole(); }); } })();

// ---------- role + permission helpers ----------
const isAdmin    = ()=> profile && profile.role==="admin" && !profile.is_external;
const isApprover = ()=> profile && !profile.is_external && (profile.role==="admin"||profile.role==="approver");
const isExternal = ()=> profile && profile.is_external===true;
window.OPS.isExternal = isExternal;
const canViewContacts = ()=> isAdmin() || window.OPS.perms.has("view_contacts");
const canExport = ()=> isAdmin() || window.OPS.perms.has("can_export");
const canDelete = ()=> isAdmin() || window.OPS.perms.has("can_delete");
window.OPS.canExport=canExport; window.OPS.canDelete=canDelete;
function maskPhone(v){ if(v==null||v==="") return ""; if(canViewContacts()) return v; const d=String(v).replace(/\D/g,""); return d.length<=3 ? "•••" : ("•••••• "+d.slice(-3)); }
window.OPS.isAdmin=isAdmin; window.OPS.isApprover=isApprover;
window.OPS.canViewContacts=canViewContacts; window.OPS.helpers.maskPhone=maskPhone;
function toolByKey(k){ return TOOLS.find(t=>t.key===k); }
function canSee(tool){
  if(!tool) return false;
  // External (invite-only) partner logins are sandboxed to the Partner Portal only.
  if(isExternal()) return tool.gate==="external";
  if(tool.gate==="external") return false;
  if(tool.gate==="admin")    return isAdmin();
  if(tool.gate==="approver") return isApprover();
  if(tool.gate==="perm")     return isAdmin() || window.OPS.perms.has(tool.key);
  return true; // 'all'
}
window.OPS.canSee = canSee;

// ---------- two-level navigation ----------
function visibleSections(){
  return SECTIONS.filter(s => TOOLS.some(t=>t.section===s.key && canSee(t)));
}
function renderNav(){
  // top section bar — Home sits first, before the Agreements tab
  const secs = visibleSections();
  const homeBtn = `<button data-home="1" class="${window.OPS.currentTool==='home'?'active':''}" title="Home (landing page)">🏠 Home</button>`;
  $("sectionBar").innerHTML = homeBtn + secs.map(s=>{
    const badge = (s.key==="reviews" && window.OPS.reviewCount) ? ` <span style="background:var(--orange);color:#fff;border-radius:999px;padding:1px 7px;font-size:11px;margin-left:4px">🔔 ${window.OPS.reviewCount}</span>` : "";
    return `<button data-sec="${s.key}" class="${s.key===window.OPS.currentSection?'active':''}">${esc(s.label)}${badge}</button>`;
  }).join("");
  const hb=$("sectionBar").querySelector("[data-home]"); if(hb) hb.addEventListener("click",()=>goHome());
  $("sectionBar").querySelectorAll("[data-sec]").forEach(b=>b.addEventListener("click",()=>openSection(b.getAttribute("data-sec"))));
  // sub-tabs for the active section
  const tools = TOOLS.filter(t=>t.section===window.OPS.currentSection && canSee(t));
  $("nav").innerHTML = tools.map(t=>
    `<button data-tab="${t.key}" class="${t.key===window.OPS.currentTool?'active':''}">${esc(t.label)}${t.phase?` <span class="soon">soon</span>`:''}</button>`).join("");
  $("nav").querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>openTool(b.getAttribute("data-tab"))));
}
function openSection(secKey){
  window.OPS.currentSection = secKey;
  const first = TOOLS.find(t=>t.section===secKey && canSee(t));
  if(first) openTool(first.key); else renderNav();
}
function openTool(key){
  const tool = toolByKey(key);
  if(!tool || !canSee(tool)){ return; }
  window.OPS.currentTool = key;
  window.OPS.currentSection = tool.section;
  renderNav();
  const view = window.OPS.routes[key];
  if(view){ try{ view(); }catch(e){ $("main").innerHTML='<div class="card">Error: '+esc(e.message)+'</div>'; console.error(e); } }
  else { $("main").innerHTML = comingSoon(tool); }
}
window.OPS.openTool = openTool; window.OPS.openSection = openSection; window.OPS.renderNav = renderNav;

function comingSoon(tool){
  return `<div class="eyebrow">${esc(SECTIONS.find(s=>s.key===tool.section).label)}</div><h1>${esc(tool.label)}</h1>
    <div class="callout warn">This module is being built — its navigation slot is in place and it will appear here once ready.</div>`;
}

// ---------- post-login landing page ----------
// Short descriptions shown beneath each landing-page link (professional, not required).
const TOOL_DESC = {
  dashboard:"Status snapshot across all agreements",
  agreements:"Browse, track and manage all agreements",
  new:"Draft a new agreement from a template",
  templates:"Review and edit shared clause templates",
  reviews:"Items awaiting your review or approval",
  vendor_reviews:"Negotiate & risk-assess vendor agreements",
  client_reviews:"Review & risk-assess client agreements",
  vendor_library:"Library of signed vendor agreements",
  client_library:"Library of signed client agreements",
  ai_settings:"Standard AI risk-assessment prompts",
  manual:"How to use the workspace, step by step",
  faqs:"Answers to common questions",
  team:"Manage members, roles and access",
  audit:"System-wide activity trail",
  access_log:"Record of who viewed what",
  portal_help:"Help & frequently asked questions",
};
function renderHome(){
  window.OPS.currentTool="home"; window.OPS.currentSection=null;
  const ext=isExternal();
  const name=esc((profile&&(profile.full_name||profile.email))||(me&&me.email)||"");
  const secs=visibleSections();
  let cards="";
  secs.forEach(s=>{
    const tools=TOOLS.filter(t=>t.section===s.key && canSee(t));
    if(!tools.length) return;
    const links=tools.map(t=>{
      const d=TOOL_DESC[t.key];
      return `<li><a data-go="${t.key}">${esc(t.label)}${d?` <span class="lk-desc">— ${esc(d)}</span>`:""}</a></li>`;
    }).join("");
    cards+=`<div class="home-sec">
      <div class="eyebrow">${esc(s.label)}</div>
      <ul class="home-links">${links}</ul></div>`;
  });
  const helpLinks = ext
    ? `<a data-go="portal_help">Help &amp; FAQs</a>`
    : `<a data-go="manual">User Manual</a><a data-go="faqs">FAQs</a>`;
  $("main").innerHTML=`
    <div class="home-hero">
      <div class="eyebrow">Athena Agreements Studio</div>
      <h1>Welcome${name?(", "+name):""}</h1>
      <p>Select an area below to begin. You can return to this page at any time with the Home button in the header.</p>
      <div class="quick">${helpLinks}</div>
    </div>
    <div class="home-grid">${cards}</div>`;
  $("main").querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",e=>{ e.preventDefault(); openTool(b.getAttribute("data-go")); }));
  renderNav();
}
function goHome(){ renderHome(); }
window.OPS.goHome=goHome; window.OPS.routes.home=renderHome;

// ---------- shared data helpers ----------
async function audit(action, entity, entity_id, note){
  try{ await sb.from("audit_log").insert({ actor:me.id, action, entity, entity_id:String(entity_id||""), note:note||null }); }catch(e){}
}
async function listProfiles(){ const {data}=await sb.from("profiles").select("*").order("created_at"); return data||[]; }
window.OPS.audit=audit; window.OPS.listProfiles=listProfiles;

function statusChip(s){ return `<span class="chip ${s}">${STATUS_LABEL[s]||s}</span>`; }
window.OPS.statusChip = statusChip;

// ---------- file save (Word/JSON downloads) ----------
async function saveBlob(blob, filename, mime, ext){
  if(window.showSaveFilePicker){
    try{
      const handle = await window.showSaveFilePicker({ suggestedName:filename,
        types:[{description:mime||"File", accept:{[mime||"application/octet-stream"]:[ext||""]}}] });
      const w = await handle.createWritable(); await w.write(blob); await w.close();
      flashTop("Saved: "+filename); return;
    }catch(e){ if(e && e.name==="AbortError"){ return; } }
  }
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  flashTop("Downloaded: "+filename);
}
window.OPS.saveBlob = saveBlob;

function flashTop(msg){ let t=$("toast"); if(!t){ t=document.createElement("div"); t.id="toast";
  t.style.cssText="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--green);color:#fff;padding:9px 16px;border-radius:8px;font-weight:700;z-index:120;box-shadow:0 8px 20px rgba(0,0,0,.25)"; document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity="1"; setTimeout(()=>{ t.style.transition="opacity .5s"; t.style.opacity="0"; },1800); }
window.OPS.flashTop = flashTop;

/* ===================== Notifications ===================== */
let _notifs=[];
async function refreshNotifs(){
  if(!me) return;
  const { data }=await sb.from("notifications").select("*").order("created_at",{ascending:false}).limit(50);
  _notifs=data||[];
  const unread=_notifs.filter(n=>!n.is_read).length;
  const c=$("bellCount"); if(c){ c.textContent=unread; c.style.display=unread?"inline-block":"none"; }
}
function renderNotifs(){
  const host=$("notifList"); if(!host) return;
  host.innerHTML = _notifs.length ? _notifs.map(n=>`<div data-nid="${n.id}" data-ag="${n.agreement_id||''}" style="padding:9px 14px;border-bottom:1px solid var(--line);cursor:pointer;${n.is_read?'opacity:.6':'background:#fbfdf8'}">
      <div style="font-size:13px">${esc(n.message)}</div><div class="muted" style="font-size:11px">${fmt(n.created_at)}</div></div>`).join("")
    : '<div class="muted" style="padding:14px">No notifications.</div>';
  host.querySelectorAll("[data-nid]").forEach(el=>el.addEventListener("click",async()=>{
    const nid=el.getAttribute("data-nid"), ag=el.getAttribute("data-ag");
    await sb.from("notifications").update({is_read:true}).eq("id",nid);
    $("notifPanel").classList.add("hidden"); refreshNotifs();
    if(ag && window.OPS.routes.viewAgreementDetail){ openTool("agreements"); window.OPS.routes.viewAgreementDetail(ag); }
  }));
}
function toggleNotif(){ const p=$("notifPanel"); if(p.classList.contains("hidden")){ renderNotifs(); p.classList.remove("hidden"); } else p.classList.add("hidden"); }
async function markAllRead(){ await sb.from("notifications").update({is_read:true}).eq("user_id",me.id).eq("is_read",false); refreshNotifs(); renderNotifs(); }
window.OPS.refreshNotifs = refreshNotifs;

// ---------- pending-approval counter (badge on the Review / Approvals tab) ----------
async function refreshReviewCount(){
  if(!me || isExternal()){ window.OPS.reviewCount=0; return; }
  const admin=isAdmin();
  async function cnt(table, col, val){
    try{ let q=sb.from(table).select("id",{count:"exact",head:true}).eq(col,val);
      if(!admin) q=q.eq("assigned_approver",me.id);
      const { count }=await q; return count||0; }catch(e){ return 0; }
  }
  const parts=await Promise.all([
    cnt("agreements","status","in_review"),
    cnt("pending_actions","status","pending"),
  ]);
  window.OPS.reviewCount = parts.reduce((a,b)=>a+b,0);
  renderNav();
}
window.OPS.refreshReviewCount = refreshReviewCount;
(function(){ const b=$("bell"); if(b) b.addEventListener("click",toggleNotif);
  const mk=$("notifMark"); if(mk) mk.addEventListener("click",markAllRead); })();

/* ===================== Top-bar utilities (Calculator / Calendar / Privacy) ===================== */
function openCalc(){
  const w=window.open("","athenaCalc","width=300,height=430");
  if(!w){ alert("Allow pop-ups to open the calculator."); return; }
  w.document.write(`<!doctype html><title>Calculator</title><style>
    body{font-family:Lato,system-ui,Arial;margin:0;background:#282828}
    #d{color:#fff;text-align:right;font-size:30px;padding:18px 14px;min-height:46px;word-break:break-all}
    .g{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#444}
    button{border:none;font-size:20px;padding:18px 0;background:#3a3a3a;color:#fff;cursor:pointer}
    button:hover{background:#4a4a4a}.op{background:#D99D29}.eq{background:#2C2F71}.fn{background:#555}
    </style><div id="d">0</div><div class="g" id="g"></div><script>
    var e="";function p(v){if(v==="="){try{e=String(Function("return ("+e.replace(/[^-()\\d/*+.%]/g,"")+")")());}catch(_){e="Error";}}
    else if(v==="C"){e="";}else if(v==="back"){e=e.slice(0,-1);}else{e+=v;}d.textContent=e||"0";}
    var keys=["C","back","%","/","7","8","9","*","4","5","6","-","1","2","3","+","0",".","="];
    var g=document.getElementById("g"),d=document.getElementById("d");
    keys.forEach(function(k){var b=document.createElement("button");b.textContent=k==="back"?"⌫":k;
      b.className=(["/","*","-","+"].indexOf(k)>=0?"op":k==="="?"eq":["C","back","%"].indexOf(k)>=0?"fn":"");
      b.onclick=function(){p(k);};g.appendChild(b);});
    document.addEventListener("keydown",function(ev){var k=ev.key;if(k==="Enter")p("=");else if(k==="Backspace")p("back");else if(k==="Escape")p("C");else if("0123456789.+-*/%".indexOf(k)>=0)p(k);});
    <\/script>`);
  w.document.close();
}
function openCalendar(){
  const w=window.open("","athenaCal","width=340,height=360");
  if(!w){ alert("Allow pop-ups to open the calendar."); return; }
  const now=new Date();
  w.document.write(`<!doctype html><title>Calendar</title><style>
    body{font-family:Lato,system-ui,Arial;margin:0;padding:12px;color:#282828}
    .hd{display:flex;align-items:center;gap:8px;margin-bottom:8px}.hd b{flex:1;text-align:center;color:#2C2F71;font-size:16px}
    button{border:1px solid #e2e6df;background:#fff;border-radius:6px;cursor:pointer;padding:4px 9px}
    table{width:100%;border-collapse:collapse}td,th{text-align:center;padding:7px 0;font-size:13px}
    th{color:#6E7191;font-size:11px}td.t{background:#2C2F71;color:#fff;border-radius:50%}
    </style><div class="hd"><button onclick="m(-1)">‹</button><b id="lbl"></b><button onclick="m(1)">›</button></div>
    <table><thead><tr><th>S</th><th>M</th><th>T</th><th>W</th><th>T</th><th>F</th><th>S</th></tr></thead><tbody id="b"></tbody></table>
    <script>var y=${now.getFullYear()},mo=${now.getMonth()},td=${now.getDate()};
    function m(d){mo+=d;if(mo<0){mo=11;y--;}if(mo>11){mo=0;y++;}r();}
    function r(){var f=new Date(y,mo,1).getDay(),n=new Date(y,mo+1,0).getDate();
      document.getElementById("lbl").textContent=new Date(y,mo,1).toLocaleString("en",{month:"long",year:"numeric"});
      var h="<tr>",c=0,i;for(i=0;i<f;i++){h+="<td></td>";c++;}
      for(var day=1;day<=n;day++){if(c%7===0&&c>0)h+="</tr><tr>";var t=(day===td&&mo===${now.getMonth()}&&y===${now.getFullYear()})?" class='t'":"";h+="<td"+t+">"+day+"</td>";c++;}
      h+="</tr>";document.getElementById("b").innerHTML=h;}
    r();<\/script>`);
  w.document.close();
}
function openPrivacy(){
  const b=$("privacyBody"); if(!b) return;
  const who=`<p class="muted">You are signed in as <b>${esc((profile&&profile.email)||(me&&me.email)||"")}</b> · role <b>${esc(isExternal()?"Authorized Partner / Consultant":((profile&&profile.role)||""))}</b>.</p>`;
  b.innerHTML=`<p class="muted">How Athena Agreements Studio handles Athena Infonomics's information.</p>
      <div class="callout"><b>Encryption:</b> all traffic is HTTPS in transit and data is stored encrypted at rest (AES-256, Supabase).</div>
      <ul style="font-size:13px;line-height:1.7">
        <li><b>Confidential to Athena.</b> Agreements and their drafts — including counterparty names, addresses, signatories, terms and commercial details — are confidential information of Athena Infonomics and must be handled accordingly.</li>
        <li><b>Access:</b> not signed in = no access. Sign-up is restricted to Athena's approved e-mail domain (<b>@athenainfonomics.com</b>); the first registered user is the Admin.</li>
        <li><b>Who can see an agreement:</b> its creator, the assigned approver, and admins/approvers — enforced by the database (Row-Level Security), not just the screen.</li>
        <li><b>Roles &amp; permissions</b> are granted per section by an admin under <b>Team &amp; Access</b>.</li>
        <li><b>Ownership:</b> every agreement, draft and document generated in this tool is the property of Athena Infonomics.</li>
        <li><b>Audit:</b> creating, submitting, approving, rejecting, editing and deleting are recorded in the Audit log; opening sensitive records is recorded in the Access log (admins can review).</li>
        <li><b>Deletions</b> are restricted (owner's own drafts / admins) and recorded.</li>
      </ul>
      <p class="muted">Questions about your data? Email <a href="mailto:info@athenainfonomics.com">info@athenainfonomics.com</a>.</p>${who}`;
  $("privacyOverlay").classList.remove("hidden");
}
(function(){
  const h=$("btnHome"); if(h) h.addEventListener("click",goHome);
  const c=$("btnCalc"); if(c) c.addEventListener("click",openCalc);
  const cal=$("btnCalendar"); if(cal) cal.addEventListener("click",openCalendar);
  const p=$("btnPrivacy"); if(p) p.addEventListener("click",openPrivacy);
  const pc=$("privClose"); if(pc) pc.addEventListener("click",()=>$("privacyOverlay").classList.add("hidden"));
  const po=$("privacyOverlay"); if(po) po.addEventListener("click",e=>{ if(e.target.id==="privacyOverlay") po.classList.add("hidden"); });
})();

/* ===================== PWA install ===================== */
if("serviceWorker" in navigator && (location.protocol==="https:"||location.protocol==="http:")){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));
}
