/* ============================================================================
   Athena Agreements Studio — Contract negotiation / review workspace
   Vendor-side and client-side. Stores every version (full history), diffs
   ours-vs-theirs, captures team comments, and runs a Claude risk assessment
   (via the risk-assessment edge function — the API key never touches the browser).
   ============================================================================ */
(function(){
const { $, esc, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const me = ()=>window.OPS.me;
const NBUCKET = "negotiation-files";

const ENTITY_OPTS = ["Athena India","Athena US","Athena Africa","Athena Bangladesh","Tola Data",""];
function kindMeta(kind){
  return kind==="vendor"
    ? { title:"Vendor reviews", eyebrow:"Contract Reviews · Vendor", cp:"Vendor / Consultant", promptKey:"risk_prompt_vendor",
        perspective:"We are Athena engaging a vendor/consultant. Assess the vendor's proposed changes from ATHENA's perspective (protecting Athena as the client/principal)." }
    : { title:"Client reviews", eyebrow:"Contract Reviews · Client", cp:"Client", promptKey:"risk_prompt_client",
        perspective:"We are Athena providing services to a client. Assess the client's agreement/changes from ATHENA's perspective (protecting Athena as the service provider/consultant)." };
}
const SRC_LABEL = { ours:"Athena", theirs:"Counterparty", final:"Final" };
const SRC_COLOR = { ours:"var(--green)", theirs:"var(--orange)", final:"var(--blue)" };

/* ---------- settings + AI helpers ---------- */
async function getSetting(key, dflt){
  try{ const { data }=await sb().from("app_settings").select("value").eq("key",key).single();
    return (data && data.value && typeof data.value.text==="string" && data.value.text) || dflt || ""; }
  catch(e){ return dflt||""; }
}
async function setSetting(key, text){
  const { error }=await sb().from("app_settings").upsert({ key, value:{text}, updated_by:me().id, updated_at:new Date().toISOString() });
  if(error) throw error;
}
async function callAI(payload){
  const { data, error }=await sb().functions.invoke("risk-assessment",{ body:payload });
  if(error){
    let msg=error.message||"Edge function error";
    try{ const ctx=await error.context?.json?.(); if(ctx&&ctx.error) msg=ctx.error; }catch(_){}
    throw new Error(msg);
  }
  if(data && data.error) throw new Error(data.error);
  return data;
}

/* ---------- line diff (LCS) ---------- */
function diffLines(a,b){
  const A=(a||"").split(/\r?\n/), B=(b||"").split(/\r?\n/);
  const n=A.length, m=B.length;
  const dp=Array.from({length:n+1},()=>new Array(m+1).fill(0));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--)
    dp[i][j]=A[i]===B[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  const out=[]; let i=0,j=0;
  while(i<n && j<m){
    if(A[i]===B[j]){ out.push({t:"eq",v:A[i]}); i++; j++; }
    else if(dp[i+1][j]>=dp[i][j+1]){ out.push({t:"del",v:A[i]}); i++; }
    else { out.push({t:"add",v:B[j]}); j++; }
  }
  while(i<n) out.push({t:"del",v:A[i++]});
  while(j<m) out.push({t:"add",v:B[j++]});
  return out;
}
function diffHTML(a,b){
  const rows=diffLines(a,b);
  const line=(bg,mark,v)=>`<div style="padding:1px 6px;background:${bg};white-space:pre-wrap;font:13px/1.5 ui-monospace,Consolas,monospace"><span style="opacity:.5">${mark}</span> ${esc(v||" ")}</div>`;
  return rows.map(r=> r.t==="add"?line("#e3f0d9","+",r.v) : r.t==="del"?line("#fbe0de","−",r.v) : line("transparent"," ",r.v)).join("");
}

/* ---------- list ---------- */
async function list(kind){
  const meta=kindMeta(kind); const m=$("main");
  m.innerHTML=`<div class="eyebrow">${esc(meta.eyebrow)}</div><h1>${esc(meta.title)}</h1>
    <p class="muted">Track a contract through negotiation: store each version, compare Athena's draft against the counterparty's changes, comment as a team, and run an AI risk assessment.</p>
    <div class="row wrap" style="margin:10px 0">
      <input id="ngSearch" placeholder="Search…" style="max-width:280px">
      <div class="spacer"></div>
      <button class="btn green sm" id="ngNew">+ New review</button>
    </div>
    <div id="ngList" class="muted">Loading…</div>`;
  $("ngNew").addEventListener("click",()=>newForm(kind));
  const { data, error }=await sb().from("negotiations").select("*").eq("kind",kind).order("updated_at",{ascending:false});
  if(error){ $("ngList").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  const all=data||[];
  function render(rows){
    $("ngList").innerHTML = rows.length ? `<div class="card"><table><thead><tr>
        <th>Agreement No.</th><th>Title</th><th>${esc(meta.cp)}</th><th>Entity</th><th>Status</th><th>Updated</th></tr></thead>
      <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}">
        <td>${r.agreement_no?esc(r.agreement_no):'<span class="muted">—</span>'}</td>
        <td><b>${esc(r.title||"")}</b></td><td>${esc(r.counterparty||"")}</td>
        <td>${esc(r.entity||"")}</td><td>${window.OPS.statusChip?window.OPS.statusChip(r.status):esc(r.status)}</td>
        <td>${esc(fmtDate(r.updated_at))}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="card muted">No reviews yet.</div>';
    $("ngList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>detail(kind, tr.getAttribute("data-id"))));
  }
  render(all);
  $("ngSearch").addEventListener("input",e=>{ const q=e.target.value.toLowerCase().trim();
    render(!q?all:all.filter(r=>["title","counterparty","entity","status"].some(k=>String(r[k]||"").toLowerCase().includes(q)))); });
}

function newForm(kind){
  const meta=kindMeta(kind); const m=$("main");
  m.innerHTML=`<button class="btn sm" id="ngBack">← Back</button>
    <div class="card" style="margin-top:12px">
      <div class="eyebrow">${esc(meta.eyebrow)}</div><h1>New ${kind} review</h1>
      <div class="fgrid">
        <div class="field full"><label>Title *</label><input id="ng_title" placeholder="e.g. Master Services Agreement — Acme Corp"></div>
        <div class="field"><label>${esc(meta.cp)}</label><input id="ng_cp"></div>
        <div class="field"><label>Athena entity</label><select id="ng_entity">${ENTITY_OPTS.map(o=>`<option>${esc(o)}</option>`).join("")}</select></div>
      </div>
      <div class="row"><button class="btn green" id="ngCreate">Create</button><button class="btn" id="ngCancel">Cancel</button></div>
      <div class="err" id="ngErr"></div>
    </div>`;
  $("ngBack").addEventListener("click",()=>list(kind));
  $("ngCancel").addEventListener("click",()=>list(kind));
  $("ngCreate").addEventListener("click",async()=>{
    const title=$("ng_title").value.trim(); if(!title){ $("ngErr").textContent="Title is required."; return; }
    const row={ kind, title, counterparty:$("ng_cp").value.trim()||null, entity:$("ng_entity").value||null, created_by:me().id };
    const { data:ins, error }=await sb().from("negotiations").insert(row).select().single();
    if(error){ $("ngErr").textContent=error.message; return; }
    window.OPS.audit("created","negotiations",ins.id,title);
    detail(kind, ins.id);
  });
}

/* ---------- detail workspace ---------- */
async function detail(kind, id){
  const meta=kindMeta(kind); const m=$("main");
  m.innerHTML=`<button class="btn sm" id="ngBack">← Back to ${esc(meta.title)}</button><div id="ngHead" class="muted" style="margin-top:12px">Loading…</div>
    <div id="ngVersions"></div><div id="ngDiff"></div><div id="ngAI"></div><div id="ngComments"></div>`;
  $("ngBack").addEventListener("click",()=>list(kind));

  const { data:neg }=await sb().from("negotiations").select("*").eq("id",id).single();
  if(!neg){ $("ngHead").innerHTML='<div class="card">Not found.</div>'; return; }
  const { data:versions }=await sb().from("agreement_versions").select("*").eq("negotiation_id",id).order("created_at",{ascending:true});
  const vers=versions||[];

  $("ngHead").innerHTML=`<div class="card"><div class="row wrap" style="align-items:center">
      <div><div class="eyebrow">${esc(meta.eyebrow)}</div><h1 style="margin:2px 0">${esc(neg.title)}</h1>
        <span class="muted">${esc(neg.counterparty||"")}${neg.entity?" · "+esc(neg.entity):""}${neg.agreement_no?" · No.: "+esc(neg.agreement_no):""}</span></div>
      <div class="spacer"></div>
      <label style="margin:0">Status</label>
      <select id="ngStatus" style="width:auto">${["open","under_review","agreed","approved","executed","closed"].map(s=>`<option ${neg.status===s?'selected':''}>${s}</option>`).join("")}</select>
    </div>
    <div class="row wrap" style="margin-top:8px;align-items:center">
      <label style="margin:0">Agreement No.</label>
      <input id="ngAgno" value="${esc(neg.agreement_no||"")}" placeholder="assigned after approval, before execution" style="max-width:340px">
      <button class="btn sm" id="ngAgnoSave">Save number</button>
    </div></div>`;
  $("ngStatus").addEventListener("change",async()=>{
    const v=$("ngStatus").value; const patch={ status:v, updated_at:new Date().toISOString() };
    if(v==="executed"){ const no=($("ngAgno").value||"").trim();
      if(!no){ alert("Please assign an Agreement Number before setting this to executed."); $("ngStatus").value=neg.status; $("ngAgno").focus(); return; }
      patch.agreement_no=no; }
    const { error }=await sb().from("negotiations").update(patch).eq("id",id);
    if(error){ alert(error.message); $("ngStatus").value=neg.status; return; }
    neg.status=v; if(patch.agreement_no) neg.agreement_no=patch.agreement_no;
    window.OPS.flashTop("Status updated");
  });
  $("ngAgnoSave").addEventListener("click",async()=>{
    const { error }=await sb().from("negotiations").update({ agreement_no:$("ngAgno").value.trim()||null, updated_at:new Date().toISOString() }).eq("id",id);
    if(error){ alert(error.message); return; } window.OPS.flashTop("Agreement number saved ✓");
  });

  renderVersions(kind, neg, vers);
  renderDiff(neg, vers);
  renderAI(kind, neg, vers);
  renderComments(neg, vers);
}

function renderVersions(kind, neg, vers){
  const host=$("ngVersions");
  host.innerHTML=`<div class="card">
    <div class="row"><h3 style="margin:0">Versions &amp; history</h3><div class="spacer"></div>
      <button class="btn green sm" id="ngAddVer">+ Add version</button></div>
    <div id="ngVerList" style="margin-top:8px">${
      vers.length? vers.map(v=>`<div class="evt" style="display:flex;gap:10px;align-items:baseline">
        <span class="tag" style="background:${SRC_COLOR[v.source]||'var(--green)'}">${esc(SRC_LABEL[v.source]||v.source)}</span>
        <b>v${v.version_no}</b> <span>${esc(v.label||"")}</span>
        <span class="spacer"></span>
        <span class="muted">${esc(fmtDate(v.created_at))}</span>
        ${v.file_path?`<a href="#" data-dl="${v.file_path}">📎 file</a>`:''}
        <a href="#" data-view="${v.id}">view</a>
      </div>`).join("")
      : '<div class="muted">No versions yet. Add Athena\'s draft, then the counterparty\'s returned version.</div>'
    }</div>
    <div id="ngVerView"></div>
    <div id="ngVerForm"></div>`;
  $("ngAddVer").addEventListener("click",()=>versionForm(kind, neg, vers));
  host.querySelectorAll("[data-dl]").forEach(a=>a.addEventListener("click",async(e)=>{ e.preventDefault();
    const { data }=await sb().storage.from(NBUCKET).createSignedUrl(a.getAttribute("data-dl"),120);
    if(data&&data.signedUrl) window.open(data.signedUrl,"_blank","noopener"); }));
  host.querySelectorAll("[data-view]").forEach(a=>a.addEventListener("click",(e)=>{ e.preventDefault();
    const v=vers.find(x=>x.id===a.getAttribute("data-view"));
    $("ngVerView").innerHTML=`<div class="card" style="background:#fbfbfd"><div class="row"><b>${esc(SRC_LABEL[v.source]||v.source)} · v${v.version_no}${v.label?" — "+esc(v.label):""}</b><div class="spacer"></div><button class="btn sm" id="ngVerClose">Close</button></div>
      <div style="white-space:pre-wrap;font:13px/1.6 ui-monospace,Consolas,monospace;margin-top:8px">${esc(v.content||"(no text — file only)")}</div></div>`;
    $("ngVerClose").addEventListener("click",()=>{ $("ngVerView").innerHTML=""; }); }));
}

function versionForm(kind, neg, vers){
  const nextNo=(vers.reduce((mx,v)=>Math.max(mx,v.version_no||0),0))+1;
  $("ngVerForm").innerHTML=`<div class="card" style="border-color:var(--green)">
    <h3 style="margin:0 0 8px">Add version v${nextNo}</h3>
    <div class="fgrid">
      <div class="field"><label>Whose version?</label><select id="vf_src">
        <option value="ours">Athena (our draft/position)</option>
        <option value="theirs">Counterparty (their changes)</option>
        <option value="final">Final / agreed</option></select></div>
      <div class="field"><label>Label</label><input id="vf_label" placeholder="e.g. Athena first draft / Vendor markup round 1"></div>
      <div class="field full"><label>Version text (paste the clauses — needed for diff &amp; AI)</label><textarea id="vf_content" style="min-height:180px"></textarea></div>
      <div class="field full"><label>Attach file (optional)</label><input id="vf_file" type="file" accept=".pdf,.docx,.doc"></div>
      <div class="field full"><label>Note</label><input id="vf_note"></div>
    </div>
    <div class="row"><button class="btn green" id="vf_save">Save version</button><button class="btn" id="vf_cancel">Cancel</button></div>
    <div class="err" id="vf_err"></div></div>`;
  $("vf_cancel").addEventListener("click",()=>{ $("ngVerForm").innerHTML=""; });
  $("vf_save").addEventListener("click",async()=>{
    const content=$("vf_content").value.trim();
    const f=$("vf_file").files[0];
    if(!content && !f){ $("vf_err").textContent="Paste the version text or attach a file."; return; }
    $("vf_save").disabled=true; $("vf_err").textContent="";
    const row={ negotiation_id:neg.id, version_no:nextNo, source:$("vf_src").value, label:$("vf_label").value.trim()||null,
      content:content||null, note:$("vf_note").value.trim()||null, created_by:me().id };
    try{
      if(f){ const path=`${neg.id}/${Date.now()}_${f.name.replace(/[^\w.\-]+/g,"_")}`;
        const up=await sb().storage.from(NBUCKET).upload(path,f); if(up.error) throw up.error;
        row.file_path=path; row.file_name=f.name; }
      const { error }=await sb().from("agreement_versions").insert(row); if(error) throw error;
      await sb().from("negotiations").update({ updated_at:new Date().toISOString() }).eq("id",neg.id);
      window.OPS.audit("added_version","negotiations",neg.id,"v"+nextNo);
      window.OPS.flashTop("Version saved ✓"); detail(kind, neg.id);
    }catch(err){ $("vf_err").textContent=err.message||String(err); $("vf_save").disabled=false; }
  });
}

function renderDiff(neg, vers){
  const host=$("ngDiff");
  if(vers.length<2){ host.innerHTML=""; return; }
  const opt=v=>`<option value="${v.id}">${SRC_LABEL[v.source]||v.source} · v${v.version_no}${v.label?" — "+esc(v.label):""}</option>`;
  const ours=vers.filter(v=>v.source==="ours").slice(-1)[0]||vers[0];
  const theirs=vers.filter(v=>v.source==="theirs").slice(-1)[0]||vers[vers.length-1];
  host.innerHTML=`<div class="card"><div class="row wrap" style="align-items:center">
      <h3 style="margin:0">Compare</h3>
      <label style="margin:0 0 0 8px">Base</label><select id="ngDA" style="width:auto">${vers.map(opt).join("")}</select>
      <label style="margin:0">Against</label><select id="ngDB" style="width:auto">${vers.map(opt).join("")}</select>
      <span class="muted" style="margin-left:8px"><span style="background:#fbe0de">removed</span> / <span style="background:#e3f0d9">added</span></span>
    </div><div id="ngDiffOut" style="margin-top:10px;border:1px solid var(--line);border-radius:8px;max-height:420px;overflow:auto"></div></div>`;
  $("ngDA").value=ours.id; $("ngDB").value=theirs.id;
  const run=()=>{ const a=vers.find(v=>v.id===$("ngDA").value), b=vers.find(v=>v.id===$("ngDB").value);
    $("ngDiffOut").innerHTML=diffHTML(a?a.content:"", b?b.content:""); };
  $("ngDA").addEventListener("change",run); $("ngDB").addEventListener("change",run); run();
}

async function renderAI(kind, neg, vers){
  const meta=kindMeta(kind); const host=$("ngAI");
  const prompt=await getSetting(meta.promptKey,"");
  const opt=v=>`<option value="${v.id}">${SRC_LABEL[v.source]||v.source} · v${v.version_no}${v.label?" — "+esc(v.label):""}</option>`;
  const { data:past }=await sb().from("risk_assessments").select("*").eq("negotiation_id",neg.id).order("created_at",{ascending:false});
  host.innerHTML=`<div class="card">
    <div class="row"><h3 style="margin:0">AI risk assessment</h3><div class="spacer"></div>
      ${window.OPS.isAdmin()?'<button class="btn sm" id="ngPromptEdit">Edit standard prompt</button>':''}</div>
    ${prompt?'':'<div class="callout warn">No standard '+kind+' risk-assessment prompt is set yet. '+(window.OPS.isAdmin()?'Add it under <b>Team &amp; Access → AI prompts</b>.':'Ask an admin to add it under Team &amp; Access → AI prompts.')+'</div>'}
    ${vers.length? `<div class="row wrap" style="align-items:center;margin-top:6px">
        <label style="margin:0">Our version</label><select id="aiOurs" style="width:auto"><option value="">— none —</option>${vers.map(opt).join("")}</select>
        <label style="margin:0">Their version</label><select id="aiTheirs" style="width:auto"><option value="">— none —</option>${vers.map(opt).join("")}</select>
        <button class="btn green sm" id="aiRun">Run risk assessment</button>
      </div>`:'<div class="muted" style="margin-top:6px">Add at least one version to assess.</div>'}
    <div id="aiOut" style="margin-top:10px"></div>
    ${past&&past.length?`<div style="margin-top:12px"><b>Previous assessments</b>${past.map(p=>`<div class="evt"><a href="#" data-ra="${p.id}">${esc(fmtDate(p.created_at))} · ${esc(p.model||"")}</a></div>`).join("")}</div>`:''}
  </div>`;
  const ours=vers.filter(v=>v.source==="ours").slice(-1)[0]; const theirs=vers.filter(v=>v.source==="theirs").slice(-1)[0];
  if($("aiOurs")&&ours) $("aiOurs").value=ours.id;
  if($("aiTheirs")&&theirs) $("aiTheirs").value=theirs.id;

  if($("ngPromptEdit")) $("ngPromptEdit").addEventListener("click",()=>window.OPS.openTool("ai_settings"));
  if(host.querySelectorAll)host.querySelectorAll("[data-ra]").forEach(a=>a.addEventListener("click",(e)=>{ e.preventDefault();
    const p=past.find(x=>x.id===a.getAttribute("data-ra")); showResult(p.result); }));

  if($("aiRun")) $("aiRun").addEventListener("click",async()=>{
    if(!prompt){ alert("Set the standard "+kind+" prompt first (Team & Access → AI prompts)."); return; }
    const ov=vers.find(v=>v.id===$("aiOurs").value), tv=vers.find(v=>v.id===$("aiTheirs").value);
    if(!ov && !tv){ alert("Select at least one version."); return; }
    $("aiRun").disabled=true; $("aiOut").innerHTML='<div class="muted">Running risk assessment… this can take a moment.</div>';
    const model=await getSetting("risk_model","claude-sonnet-5");
    try{
      const res=await callAI({ system:meta.perspective, prompt, ourText:ov?ov.content:"", theirText:tv?tv.content:"", model });
      const text=res.text||"(empty response)";
      await sb().from("risk_assessments").insert({ negotiation_id:neg.id, version_id:tv?tv.id:(ov?ov.id:null),
        compared_to:ov?ov.id:null, prompt_key:meta.promptKey, model:res.model||model, result:text, run_by:me().id });
      window.OPS.audit("ai_risk_assessment","negotiations",neg.id,neg.title);
      showResult(text);
    }catch(err){ $("aiOut").innerHTML='<div class="callout warn">Assessment failed: '+esc(err.message||String(err))+'<br><span class="muted">If the edge function is not deployed yet, see supabase/functions/README.md.</span></div>'; }
    $("aiRun").disabled=false;
  });
  function showResult(text){ $("aiOut").innerHTML=`<div class="card" style="background:#fbfbfd"><b>Risk assessment</b>
    <div style="white-space:pre-wrap;line-height:1.6;margin-top:8px">${esc(text)}</div></div>`; }
}

async function renderComments(neg, vers){
  const host=$("ngComments");
  const { data:cs }=await sb().from("review_comments").select("*").eq("negotiation_id",neg.id).order("created_at",{ascending:true});
  if(!window.OPS._profilesCache){ const { data }=await sb().from("profiles").select("id,full_name,email,role").order("full_name"); window.OPS._profilesCache=data||[]; }
  const ps=window.OPS._profilesCache||[];
  const nameOf=id=>{ const p=ps.find(x=>x.id===id); return p?(p.full_name||p.email):"Team member"; };
  const list=cs||[];
  host.innerHTML=`<div class="card"><h3 style="margin:0 0 8px">Review comments</h3>
    <div id="cmtList">${list.length? list.map(c=>`<div class="evt"><b>${esc(nameOf(c.author))}</b> <span class="muted">${esc(fmtDate(c.created_at))}</span>${c.clause_ref?` · <span class="tag">${esc(c.clause_ref)}</span>`:''}<div>${esc(c.body)}</div></div>`).join("") : '<div class="muted">No comments yet.</div>'}</div>
    <div class="fgrid" style="margin-top:8px">
      <div class="field"><label>Clause ref (optional)</label><input id="cmt_ref" placeholder="e.g. 4.2 Indemnity"></div>
      <div class="field full"><label>Comment</label><textarea id="cmt_body"></textarea></div>
    </div>
    <button class="btn green sm" id="cmt_add">Add comment</button><div class="err" id="cmt_err"></div></div>`;
  $("cmt_add").addEventListener("click",async()=>{
    const body=$("cmt_body").value.trim(); if(!body){ $("cmt_err").textContent="Enter a comment."; return; }
    const { error }=await sb().from("review_comments").insert({ negotiation_id:neg.id, clause_ref:$("cmt_ref").value.trim()||null, body, author:me().id });
    if(error){ $("cmt_err").textContent=error.message; return; }
    renderComments(neg, vers);
  });
}

/* ---------- admin: standard prompt settings ---------- */
async function aiSettings(){
  const m=$("main");
  if(!window.OPS.isAdmin()){ m.innerHTML='<div class="card">Admins only.</div>'; return; }
  m.innerHTML=`<div class="eyebrow">Team &amp; Access · AI prompts</div><h1>Risk-assessment prompts</h1>
    <p class="muted">These standard prompts are sent to Claude when a reviewer runs a risk assessment. The client prompt is used on Client reviews; the vendor prompt on Vendor reviews.</p>
    <div class="card"><label>Model</label><input id="set_model" style="max-width:280px">
      <div class="muted" style="margin-top:4px">e.g. claude-sonnet-5 (default) or claude-opus-4-8.</div></div>
    <div class="card"><label>Client-side standard prompt</label><textarea id="set_client" style="min-height:200px"></textarea></div>
    <div class="card"><label>Vendor-side standard prompt</label><textarea id="set_vendor" style="min-height:200px"></textarea></div>
    <div class="row"><button class="btn green" id="set_save">Save prompts</button><div class="err" id="set_err"></div></div>`;
  $("set_model").value=await getSetting("risk_model","claude-sonnet-5");
  $("set_client").value=await getSetting("risk_prompt_client","");
  $("set_vendor").value=await getSetting("risk_prompt_vendor","");
  $("set_save").addEventListener("click",async()=>{
    try{
      await setSetting("risk_model",$("set_model").value.trim()||"claude-sonnet-5");
      await setSetting("risk_prompt_client",$("set_client").value);
      await setSetting("risk_prompt_vendor",$("set_vendor").value);
      window.OPS.flashTop("Prompts saved ✓");
    }catch(err){ $("set_err").textContent=err.message||String(err); }
  });
}

window.OPS.routes.vendor_reviews = ()=>list("vendor");
window.OPS.routes.client_reviews = ()=>list("client");
window.OPS.routes.ai_settings    = aiSettings;
})();
