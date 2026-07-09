/* ============================================================================
   Athena Agreements Studio — Agreement section (the original Agreement Studio)
   Views: agreements list, new/edit, approvals, detail, team+access, templates,
   audit, and the embedded Studio document editor. Registered into OPS.routes.
   Relies on globals from app.js: sb, me, profile, $, esc, fmt, statusChip,
   audit, listProfiles, isAdmin, isApprover.
   ============================================================================ */
(function(){
const R = window.OPS.routes;
const back = ()=> window.OPS.openTool("agreements");

async function listAgreements(filter){
  let q = sb.from("agreements").select("*, creator:created_by(full_name,email), approver:assigned_approver(full_name,email)").order("updated_at",{ascending:false});
  if(filter==="mine") q=q.eq("created_by", me.id);
  if(filter==="review") q=q.eq("status","in_review");
  if(filter==="draft") q=q.eq("status","draft");
  const { data, error } = await q;
  if(error){ console.error(error); return []; }
  return data||[];
}

async function viewAgreements(){
  const m=$("main"); m.innerHTML=`<div class="eyebrow">Agreement</div><h1>Agreements</h1>
    <div class="row" style="margin:10px 0"><button class="btn sm" data-f="all">All</button>
    <button class="btn sm" data-f="draft">Drafts</button>
    <button class="btn sm" data-f="mine">Mine</button>
    <button class="btn sm" data-f="review">In review</button>
    <div class="spacer"></div><button class="btn green sm" id="newBtn">+ New agreement</button></div>
    <div id="listHost" class="muted">Loading…</div>`;
  $("newBtn").addEventListener("click",()=>window.OPS.openTool("new"));
  m.querySelectorAll("[data-f]").forEach(b=>b.addEventListener("click",()=>load(b.getAttribute("data-f"))));
  async function load(f){
    const rows=await listAgreements(f==="all"?null:f);
    $("listHost").innerHTML = rows.length? `<table><thead><tr><th>Agreement No.</th><th>Title</th><th>Counterparty</th><th>Type</th><th>Status</th><th>Owner</th><th>Updated</th></tr></thead>
      <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}">
        <td>${r.agreement_no?("<b>"+esc(r.agreement_no)+"</b>"):'<span class="muted">—</span>'}</td>
        <td><b>${esc(r.title)}</b></td><td>${esc(r.counterparty||"")}</td><td>${esc(r.category||"")}</td>
        <td>${statusChip(r.status)}</td><td>${esc((r.creator&&(r.creator.full_name||r.creator.email))||"")}</td><td class="muted">${fmt(r.updated_at)}</td>
      </tr>`).join("")}</tbody></table>` : '<div class="card muted">No agreements yet. Click “New agreement”.</div>';
    $("listHost").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>viewDetail(tr.getAttribute("data-id"))));
  }
  load("all");
}

function viewForm(existing){
  const e=existing||{};
  const m=$("main"); m.innerHTML=`<div class="eyebrow">${existing?"Edit":"Create"}</div><h1>${existing?"Edit agreement":"New agreement"}</h1>
    <div class="card">
    <div class="fgrid">
      <div class="field full"><label>Title</label><input id="fTitle" value="${esc(e.title||"")}" placeholder="e.g. Non-Disclosure Agreement — Acme Advisors"></div>
      <div class="field"><label>Counterparty</label><input id="fCp" value="${esc(e.counterparty||"")}" placeholder="Consultant / party name"></div>
      <div class="field"><label>Type</label><select id="fCat">
        ${["NDA","Service Agreement","Service Agreement + NDA","MOU","Teaming Agreement","Non-Compete Agreement","SA Amendment","Independent Contractor Agreement"].map(c=>`<option ${e.category===c?'selected':''}>${c}</option>`).join("")}</select></div>
      <div class="field"><label>Template key (optional)</label><input id="fTpl" value="${esc(e.template_key||"")}" placeholder="nda_india / nda_us …"></div>
      <div class="field"><label>Assign approver</label><select id="fApp"></select></div>
      <div class="field full"><label>Draft data (JSON from the desktop Studio — optional)</label>
        <textarea id="fData" placeholder='Paste a "Save JSON draft" export here, or use Import.'>${e.data?esc(JSON.stringify(e.data,null,2)):""}</textarea>
        <div class="row" style="margin-top:6px"><button class="btn sm" id="impBtn">Import JSON file…</button>
        <span class="muted">Links this record to a draft built in the offline Studio.</span></div>
      </div>
    </div>
    <div class="row"><button class="btn green" id="saveBtn">${existing?"Save changes":"Create (as Draft)"}</button>
      <button class="btn" id="cancelBtn">Cancel</button></div>
    <div class="err" id="fErr"></div>
    </div>`;
  listProfiles().then(ps=>{
    const approvers=ps.filter(p=>p.role==="approver"||p.role==="admin");
    $("fApp").innerHTML = '<option value="">— none —</option>'+approvers.map(p=>`<option value="${p.id}" ${e.assigned_approver===p.id?'selected':''}>${esc(p.full_name||p.email)} (${esc(window.OPS.roleLabel(p.role))})</option>`).join("");
  });
  $("impBtn").addEventListener("click",()=>{ $("jsonImport").onchange=ev=>{ const f=ev.target.files[0]; if(!f)return;
    const r=new FileReader(); r.onload=()=>{ try{ const o=JSON.parse(r.result); $("fData").value=JSON.stringify(o.draft||o,null,2);
      if(!$("fTitle").value && o.draft){ $("fTitle").value=(o.draft.title||"")+" — "+((o.draft.fields&&o.draft.fields.cpName)||""); }
    }catch(err){ alert("Not valid JSON"); } }; r.readAsText(f); $("jsonImport").value=""; }; $("jsonImport").click();
  });
  $("cancelBtn").addEventListener("click",back);
  $("saveBtn").addEventListener("click",async()=>{
    const title=$("fTitle").value.trim(); if(!title){ $("fErr").textContent="Title is required."; return; }
    let data=null; const raw=$("fData").value.trim(); if(raw){ try{ data=JSON.parse(raw); }catch(e){ $("fErr").textContent="Draft data is not valid JSON."; return; } }
    const rec={ title, counterparty:$("fCp").value.trim(), category:$("fCat").value, template_key:$("fTpl").value.trim()||null,
      assigned_approver:$("fApp").value||null, data };
    if(existing){
      const { error }=await sb.from("agreements").update(rec).eq("id",existing.id);
      if(error){ $("fErr").textContent=error.message; return; }
      await audit("edited","agreement",existing.id,"edited fields"); viewDetail(existing.id);
    }else{
      rec.created_by=me.id; rec.status="draft";
      const { data:ins, error }=await sb.from("agreements").insert(rec).select().single();
      if(error){ $("fErr").textContent=error.message; return; }
      await audit("created","agreement",ins.id,title); viewDetail(ins.id);
    }
  });
}

async function viewDetail(id){
  const { data:r, error }=await sb.from("agreements").select("*, creator:created_by(full_name,email), approver:assigned_approver(full_name,email)").eq("id",id).single();
  if(error||!r){ $("main").innerHTML='<div class="card">Not found.</div>'; return; }
  const { data:events }=await sb.from("audit_log").select("*, who:actor(full_name,email)").eq("entity","agreement").eq("entity_id",id).order("created_at",{ascending:false});
  const owner = r.created_by===me.id;
  const isExec = r.status==="executed";
  const canEditDoc  = !isExec && ( (owner && (r.status==="draft"||r.status==="rejected")) || isApprover() );
  const canSubmit   = owner && (r.status==="draft"||r.status==="rejected");
  const adminCanDecide    = isAdmin() && (r.status==="in_review"||r.status==="recommended");
  const approverCanDecide = profile.role==="approver" && r.status==="in_review" && !owner;
  const canApprove = adminCanDecide || approverCanDecide;
  const canReject  = (adminCanDecide || approverCanDecide);
  const approveLabel = isAdmin() ? "Approve (final)" : "Approve & recommend";
  // The drafter (owner) now owns the closing steps: assign number → download → mark executed.
  const canExecute = (owner || isApprover()) && r.status==="approved";
  const canNumber  = (owner || isApprover()) && r.status==="approved";
  const canDownload= (owner || isApprover()) && (r.status==="approved" || isExec) && !!r.data;
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="back">← Back</button>
    <div class="card" style="margin-top:12px">
      <div class="row"><div><div class="eyebrow">${esc(r.category||"")}</div><h1 style="margin:2px 0">${esc(r.title)}</h1></div>
        <div class="spacer"></div>${statusChip(r.status)}</div>
      <p class="muted">Counterparty: <b>${esc(r.counterparty||"—")}</b> · Template: ${esc(r.template_key||"—")} ·
        Owner: ${esc((r.creator&&(r.creator.full_name||r.creator.email))||"")} ·
        Approver: ${esc((r.approver&&(r.approver.full_name||r.approver.email))||"unassigned")} · Agreement No.: <b>${esc(r.agreement_no||"—")}</b></p>
      ${r.status==="recommended"?'<div class="callout">Reviewed and <b>recommended</b> — awaiting an <b>admin</b> for final approval.</div>':''}
      <div class="row wrap" style="margin-top:8px">
        ${canEditDoc?'<button class="btn green sm" id="editdoc">✎ Open document editor</button>':''}
        <button class="btn sm" id="editmeta">Edit details</button>
        ${canSubmit?'<button class="btn orange sm" id="submit">Submit for review</button>':''}
        ${canApprove?`<button class="btn green sm" id="approve">${approveLabel}</button>`:''}
        ${canReject?'<button class="btn sm" id="reject" style="color:#a3322a;border-color:#e4b4b4">Reject…</button>':''}
        ${canDownload?'<button class="btn green sm" id="getdoc">⬇ Download document (Word / PDF)</button>':''}
        ${canExecute?'<button class="btn blue sm" id="execute">Mark executed (signed)</button>':''}
        ${r.data?'<button class="btn sm" id="dl">Download draft JSON</button>':''}
        ${(isAdmin()||(owner&&r.status==='draft'))?'<button class="btn sm" id="del" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}
      </div>
      ${ canNumber ? `<div class="callout warn" style="margin-top:10px"><b>Assign the agreement number</b>, then <b>download</b> the document to send for signature. Mark it <b>executed</b> once both parties have signed.
        <div class="row wrap" style="margin-top:6px"><input id="agNo" placeholder="e.g. Athena/FY25-26/001/Counterparty" value="${esc(r.agreement_no||"")}" style="max-width:360px"><button class="btn sm" id="agNoSave">Save number</button></div></div>` : "" }
    </div>
    <div class="card"><h3>History</h3>
      ${ (events&&events.length)? events.map(ev=>`<div class="evt"><b>${esc(ev.action)}</b> — ${esc((ev.who&&(ev.who.full_name||ev.who.email))||"")} <span class="muted">· ${fmt(ev.created_at)}</span>${ev.note?`<br>${esc(ev.note)}`:""}</div>`).join("") : '<div class="muted">No history yet.</div>' }
    </div>`;
  $("back").addEventListener("click",back);
  if($("editdoc")) $("editdoc").addEventListener("click",()=>viewStudio(r));
  if($("editmeta")) $("editmeta").addEventListener("click",()=>viewForm(r));
  if($("submit")) $("submit").addEventListener("click",()=>runRpc("submit_for_review",{p_id:r.id},r.id));
  if($("approve")) $("approve").addEventListener("click",()=>runRpc("approve_agreement",{p_id:r.id,p_note:null},r.id));
  if($("reject")) $("reject").addEventListener("click",()=>{ const note=prompt("Reason for rejection / changes requested:"); if(note===null) return; runRpc("reject_agreement",{p_id:r.id,p_note:note||null},r.id); });
  if($("getdoc")) $("getdoc").addEventListener("click",()=>{
    window.OPS.flashTop("Opening the Save, download & submit page…");
    viewStudio(r, {panel:"finalise"});
  });
  if($("execute")) $("execute").addEventListener("click",()=>{
    if(!r.agreement_no){ alert("Please assign an Agreement Number (and click “Save number”) before marking this agreement executed."); const el=$("agNo"); if(el) el.focus(); return; }
    if(!confirm("Mark this agreement EXECUTED?\n\nDo this only once BOTH parties have signed. (When we connect the e-signature tool, this will happen automatically.)")) return;
    runRpc("mark_executed", { p_id:r.id, p_note:null }, r.id);
  });
  if($("dl")) $("dl").addEventListener("click",()=>{ const blob=new Blob([JSON.stringify({draft:r.data},null,2)],{type:"application/json"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=(r.title||"agreement")+".json"; a.click(); });
  if($("del")) $("del").addEventListener("click",async()=>{ if(!confirm("Delete this agreement?"))return;
    await window.OPS.gateThen({ kind:"agreement.delete", title:"Delete agreement: "+(r.title||""), target_table:"agreements", target_id:id, doneMsg:"Deleted" }, ()=>back()); });
  if($("agNoSave")) $("agNoSave").addEventListener("click",async()=>{ const v=$("agNo").value.trim();
    const { error }=await sb.from("agreements").update({ agreement_no:v||null }).eq("id",r.id);
    if(error){ alert(error.message); return; }
    await audit("agreement_no_set","agreement",r.id,v||"(cleared)"); window.OPS.flashTop("Agreement number saved ✓"); viewDetail(r.id); });
}
async function runRpc(fn, args, agId){
  const { error }=await sb.rpc(fn, args);
  if(error){ alert(error.message); return; }
  window.OPS.refreshNotifs(); viewDetail(agId);
}

async function viewTeam(){
  const m=$("main"); m.innerHTML=`<div class="eyebrow">Administration</div><h1>Team &amp; access</h1>
    <div class="callout">The first person to sign up is the <b>admin</b>. Assign roles, then grant each person access to the specific <b>Administration</b> tools they need.</div>
    <h3>Roles</h3><div id="teamHost" class="muted">Loading…</div>
    <h3 style="margin-top:22px">Tool access</h3>
    <p class="muted">Pick a section, tick the tools each member may use, then <b>Save changes</b>. Changes across sections are saved together. Admins always have full access.</p>
    <div class="row wrap" style="margin-bottom:8px"><label style="margin:0">Section</label><select id="permSection" style="width:auto"></select>
      <div class="spacer"></div><button class="btn green sm" id="permSave">Save changes</button><span id="permStatus" class="muted"></span></div>
    <div id="permHost" class="muted">Loading…</div>`;
  const ps=await listProfiles();
  $("teamHost").innerHTML=`<table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th style="text-align:center">Approvals required</th><th>Joined</th></tr></thead><tbody>
    ${ps.map(p=>`<tr><td>${esc(p.full_name||"")}</td><td>${esc(p.email||"")}</td>
      <td><select data-uid="${p.id}" ${p.id===me.id?'disabled':''}>
        ${["admin","approver","drafter","viewer"].map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${esc(window.OPS.roleLabel(r))}</option>`).join("")}
      </select></td>
      <td style="text-align:center"><input type="checkbox" style="width:auto" data-exempt="${p.id}" ${p.approval_exempt?'':'checked'} title="Ticked = this person's actions must be approved by someone else before they take effect"></td>
      <td class="muted">${fmt(p.created_at)}</td></tr>`).join("")}
  </tbody></table><p class="muted">Tip: you cannot change your own role (prevents lock-out). Untick <b>Approvals required</b> to let a person's actions take effect immediately without a second approver.</p>`;
  $("teamHost").querySelectorAll("select[data-uid]").forEach(s=>s.addEventListener("change",async()=>{
    const { error }=await sb.rpc("admin_set_role",{ target:s.getAttribute("data-uid"), new_role:s.value });
    if(error) alert(error.message); else { s.style.borderColor="var(--green)"; }
  }));
  $("teamHost").querySelectorAll("input[data-exempt]").forEach(cb=>cb.addEventListener("change",async()=>{
    const { error }=await sb.rpc("admin_set_approval_exempt",{ target:cb.getAttribute("data-exempt"), val:!cb.checked });
    if(error){ alert(error.message); cb.checked=!cb.checked; } else { window.OPS.flashTop("Approval setting updated ✓"); }
  }));

  // ----- Tool access: select a section, edit locally, then Save -----
  const PT=window.OPS.PERMISSIONED_TOOLS, CAPS=window.OPS.CAPABILITIES||[];
  const groups=window.OPS.SECTIONS.filter(s=>PT.some(t=>t.section===s.key)).map(s=>({key:s.key,label:s.label,tools:PT.filter(t=>t.section===s.key)}));
  groups.push({key:"_caps",label:"Capabilities",tools:CAPS});
  const members=ps.filter(p=>p.role!=="admin");
  const { data:permRows }=await sb.from("app_permissions").select("user_id,tool_key");
  let granted=new Set((permRows||[]).map(r=>r.user_id+"|"+r.tool_key));
  let working=new Set(granted);
  $("permSection").innerHTML=groups.map(g=>`<option value="${g.key}">${esc(g.label)}</option>`).join("");
  function renderPerm(){
    if(!members.length){ $("permHost").innerHTML='<div class="muted">No non-admin members yet.</div>'; return; }
    const g=groups.find(x=>x.key===$("permSection").value)||groups[0];
    $("permHost").innerHTML=`<div style="overflow:auto"><table><thead><tr><th>Member</th>${g.tools.map(t=>`<th style="text-align:center">${esc(t.label)}</th>`).join("")}</tr></thead>
      <tbody>${members.map(p=>`<tr><td><b>${esc(p.full_name||p.email)}</b><br><span class="muted">${esc(window.OPS.roleLabel(p.role))}</span></td>
        ${g.tools.map(t=>`<td style="text-align:center"><input type="checkbox" style="width:auto" data-u="${p.id}" data-t="${t.key}" ${working.has(p.id+"|"+t.key)?"checked":""}></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    $("permHost").querySelectorAll("input[type=checkbox]").forEach(cb=>cb.addEventListener("change",()=>{
      const k=cb.getAttribute("data-u")+"|"+cb.getAttribute("data-t");
      if(cb.checked) working.add(k); else working.delete(k);
      $("permStatus").textContent=" unsaved changes…"; $("permStatus").style.color="var(--orange)";
    }));
  }
  $("permSection").addEventListener("change",renderPerm);
  $("permSave").addEventListener("click",async()=>{
    const all=new Set([...granted,...working]); const changes=[];
    all.forEach(k=>{ if(working.has(k)!==granted.has(k)){ const i=k.indexOf("|"); changes.push({u:k.slice(0,i),t:k.slice(i+1),grant:working.has(k)}); } });
    if(!changes.length){ $("permStatus").textContent=" nothing to save"; $("permStatus").style.color="var(--muted)"; return; }
    $("permSave").disabled=true; $("permStatus").textContent=" saving…";
    for(const c of changes){ const { error }=await sb.rpc("admin_set_permission",{ target:c.u, p_tool:c.t, p_grant:c.grant }); if(error){ alert(error.message); } }
    granted=new Set(working); $("permSave").disabled=false;
    $("permStatus").textContent=" ✓ saved "+changes.length+" change(s)"; $("permStatus").style.color="var(--green)";
  });
  renderPerm();
}

async function viewTemplates(){
  const m=$("main"); m.innerHTML=`<div class="eyebrow">Standards</div><h1>Shared templates</h1>
    <div class="callout"><b>Easiest way to edit a template:</b> open <b>New agreement</b>, pick the template, edit the clauses inline, then go to <b>Save, download &amp; submit → “Save as team template”</b>. It becomes the standard for the whole team, and this list tracks it. Use the advanced JSON editor below only if you need it.</div>
    <h3 style="margin-top:6px">Customised templates</h3><div id="tList" class="muted">Loading…</div>
    <details style="margin-top:18px"><summary class="muted" style="cursor:pointer">Advanced: edit template clauses as JSON</summary>
      <div class="field" style="margin-top:8px"><label>Template key</label><input id="tKey" placeholder="nda_india"></div>
      <div class="field"><label>Payload (JSON: an array of clauses, or an object with clauses/annex/intro/closing)</label><textarea id="tJson" style="min-height:200px" placeholder='{ "clauses":[ { "id":"scope", "title":"Scope", "body":"<p>…</p>", "on":true } ] }'></textarea></div>
      <div class="row"><button class="btn sm" id="tLoad">Load</button><button class="btn green sm" id="tSave">Save to team</button></div>
      <div class="err" id="tErr"></div>
    </details>`;
  async function refresh(){ const { data }=await sb.from("template_overrides").select("template_key, updated_at, updater:updated_by(full_name,email)").order("updated_at",{ascending:false});
    $("tList").innerHTML=(data&&data.length)? `<table><thead><tr><th>Template</th><th>Updated by</th><th>When</th><th></th></tr></thead><tbody>${data.map(x=>`<tr><td><b>${esc(x.template_key)}</b></td><td>${esc((x.updater&&(x.updater.full_name||x.updater.email))||"")}</td><td class="muted">${fmt(x.updated_at)}</td><td><button class="btn sm" data-reset="${esc(x.template_key)}" style="color:#a3322a;border-color:#e4b4b4">Reset to original</button></td></tr>`).join("")}</tbody></table>`:'<div class="muted">No customised templates yet — all templates use their original built-in text.</div>';
    $("tList").querySelectorAll("[data-reset]").forEach(b=>b.addEventListener("click",async()=>{ const k=b.getAttribute("data-reset");
      if(!confirm('Reset "'+k+'" to the original built-in template for the whole team?')) return;
      await window.OPS.gateThen({ kind:"template.reset", title:"Reset template to original: "+k, target_table:"template_overrides", target_id:k, doneMsg:"Reset" }, ()=>refresh()); })); }
  $("tLoad").addEventListener("click",async()=>{ const k=$("tKey").value.trim(); if(!k)return;
    const { data }=await sb.from("template_overrides").select("clauses").eq("template_key",k).single();
    $("tJson").value = data? JSON.stringify(data.clauses,null,2) : ""; if(!data) $("tErr").textContent="No override for that key yet — paste clauses to create one."; else $("tErr").textContent=""; });
  $("tSave").addEventListener("click",async()=>{ const k=$("tKey").value.trim(); let clauses;
    try{ clauses=JSON.parse($("tJson").value); }catch(e){ $("tErr").textContent="Clauses must be valid JSON."; return; }
    if(!k){ $("tErr").textContent="Template key required."; return; }
    await window.OPS.gateThen({ kind:"template.save", title:"Save team template (JSON): "+k, target_table:"template_overrides", target_id:k, payload:{ templateKey:k, payload:clauses }, doneMsg:"Saved for the team" }, ()=>{ $("tErr").innerHTML='<span class="ok">Done.</span>'; refresh(); });
  });
  refresh();
}

async function viewAudit(){
  const m=$("main"); m.innerHTML=`<div class="eyebrow">Compliance</div><h1>Audit log</h1><div id="aHost" class="muted">Loading…</div>`;
  const { data }=await sb.from("audit_log").select("*, who:actor(full_name,email)").order("created_at",{ascending:false}).limit(200);
  $("aHost").innerHTML=(data&&data.length)? `<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Note</th></tr></thead><tbody>
    ${data.map(e=>`<tr><td class="muted">${fmt(e.created_at)}</td><td>${esc((e.who&&(e.who.full_name||e.who.email))||"")}</td><td><b>${esc(e.action)}</b></td><td>${esc(e.entity)} ${esc(e.entity_id||"")}</td><td>${esc(e.note||"")}</td></tr>`).join("")}
  </tbody></table>`:'<div class="muted">No activity yet.</div>';
}

/* ---------- embedded Studio document editor ---------- */
let currentEdit=null;
let studioOpenPanel=null;   // which studio panel to open on (e.g. "finalise" for a download)
function viewStudio(rec, opts){
  currentEdit = rec || null;
  studioOpenPanel = (opts && opts.panel) || null;
  window.OPS.currentTool="new"; window.OPS.renderNav();
  const m=$("main");
  // Full-bleed wrapper: header row + iframe share the same 38px (≈1cm) side gutter, so the
  // "New agreement" label lines up with the iframe's left edge and "Back to list" with its right.
  m.innerHTML = `<div style="position:relative;left:50%;right:50%;width:100vw;margin-left:-50vw;margin-right:-50vw;padding:0 38px;box-sizing:border-box">
      <div class="row" style="margin-bottom:8px;align-items:center">
        <div class="eyebrow">${rec?"Edit document":"New agreement"}</div>
        <span class="muted" style="margin-left:8px">${rec?esc(rec.title||""):"Pick a template, fill it in, then “Save to cloud” — it’s added to Agreements automatically."}</span>
        <div class="spacer"></div>
        <button class="btn sm" id="stClose">${rec?"← Back to agreement":"← Back to list"}</button>
      </div>
      <div style="position:relative;height:calc(100vh - 150px)">
        <div id="stLoading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--soft-green);border:1px solid var(--line);border-radius:10px;color:var(--muted);font-size:14px;z-index:2;transition:opacity .35s ease">
          <div style="text-align:center"><div style="font-size:24px;margin-bottom:8px">📄</div>Opening the document…</div>
        </div>
        <iframe id="studioFrame" title="Document editor" style="position:absolute;inset:0;width:100%;height:100%;border:1px solid var(--line);border-radius:10px;background:#fff;opacity:0;transition:opacity .35s ease"></iframe>
      </div>
    </div>`;
  const f=$("studioFrame");
  // Fade the editor in once it has loaded AND had a moment to render the requested panel,
  // so the switch feels smooth instead of flashing the template gallery first.
  f.addEventListener("load",()=>{ setTimeout(()=>{
    if($("studioFrame")) $("studioFrame").style.opacity="1";
    const l=$("stLoading"); if(l){ l.style.opacity="0"; setTimeout(()=>{ if(l&&l.parentNode) l.parentNode.removeChild(l); },380); }
  }, 430); });
  f.src = "studio.html?ts="+Date.now();
  $("stClose").addEventListener("click",()=>closeStudio());
}
function closeStudio(){
  if(currentEdit){ const id=currentEdit.id; currentEdit=null; viewDetail(id); }
  else window.OPS.openTool("agreements");
}
async function saveStudioDraft(d){
  if(!d){ return null; }
  const cp = (d.fields && d.fields.cpName) || "";
  const baseTitle = d.title || "Agreement";
  const title = cp ? (baseTitle + " — " + cp) : baseTitle;
  const cat = d.cat || null; const tplKey = d.templateKey || null;
  if(!currentEdit){
    const rec={ title, counterparty:cp||null, category:cat, template_key:tplKey, status:"draft", created_by:me.id, data:d };
    const { data:ins, error }=await sb.from("agreements").insert(rec).select().single();
    if(error){ alert("Save failed: "+error.message); return null; }
    currentEdit=ins; await audit("created","agreement",ins.id,title); window.OPS.flashTop("Added to Agreements ✓");
  } else {
    const patch={ data:d };
    if(cp) patch.counterparty=cp; if(title) patch.title=title;
    if(cat && !currentEdit.category) patch.category=cat;
    if(tplKey && !currentEdit.template_key) patch.template_key=tplKey;
    const { error }=await sb.from("agreements").update(patch).eq("id",currentEdit.id);
    if(error){ alert("Save failed: "+error.message); return null; }
    currentEdit=Object.assign(currentEdit,patch); await audit("edited","agreement",currentEdit.id,"document updated in editor"); window.OPS.flashTop("Saved to cloud ✓");
  }
  return currentEdit;
}
async function sendStudioReviewers(f){
  const { data }=await sb.from("profiles").select("id,full_name,email,role").in("role",["approver","admin"]).order("full_name");
  const revs=(data||[]).filter(p=>p.id!==me.id);   // can't send to yourself
  f.contentWindow.postMessage({ type:"app-reviewers", reviewers:revs }, "*");
}
async function sendStudioOverrides(f){
  const { data }=await sb.from("template_overrides").select("template_key,clauses");
  const map={}; (data||[]).forEach(r=>{ map[r.template_key]=r.clauses; });
  f.contentWindow.postMessage({ type:"app-overrides", overrides:map, canEditTemplates: !!(window.OPS.isApprover && window.OPS.isApprover()) }, "*");
}
async function saveStudioTemplate(msg, f){
  const r = await window.OPS.gateThen({ kind:"template.save", title:"Save team template: "+msg.templateKey, target_table:"template_overrides", target_id:msg.templateKey, payload:{ templateKey:msg.templateKey, payload:msg.payload }, doneMsg:"Team template saved" });
  if(r && r.applied){ f.contentWindow.postMessage({ type:"app-template-saved", ok:true, templateKey:msg.templateKey, payload:msg.payload }, "*"); }
  else if(r && r.queued){ f.contentWindow.postMessage({ type:"app-template-saved", ok:false, templateKey:msg.templateKey, error:"Sent for approval — the template will update once an approver approves." }, "*"); }
  else { f.contentWindow.postMessage({ type:"app-template-saved", ok:false, templateKey:msg.templateKey, error:(r&&r.error?String(r.error.message||r.error):"cancelled") }, "*"); }
}
async function resetStudioTemplate(msg, f){
  const r = await window.OPS.gateThen({ kind:"template.reset", title:"Reset template to original: "+msg.templateKey, target_table:"template_overrides", target_id:msg.templateKey, doneMsg:"Template reset" });
  if(r && r.applied){ f.contentWindow.postMessage({ type:"app-template-reset", ok:true, templateKey:msg.templateKey }, "*"); }
  else if(r && r.queued){ f.contentWindow.postMessage({ type:"app-template-reset", ok:false, templateKey:msg.templateKey, error:"Sent for approval — will reset once approved." }, "*"); }
  else { f.contentWindow.postMessage({ type:"app-template-reset", ok:false, templateKey:msg.templateKey, error:(r&&r.error?String(r.error.message||r.error):"cancelled") }, "*"); }
}
async function submitStudioDraft(msg, f){
  const rec = await saveStudioDraft(msg.draft);
  if(!rec){ f.contentWindow.postMessage({type:"app-submitted", ok:false, error:"save failed"}, "*"); return; }
  if(msg.reviewerId){
    await sb.from("agreements").update({ assigned_approver: msg.reviewerId }).eq("id", rec.id);
    currentEdit.assigned_approver = msg.reviewerId;
  }
  const { error }=await sb.rpc("submit_for_review", { p_id: rec.id, p_note: msg.note||null });
  if(error){ f.contentWindow.postMessage({type:"app-submitted", ok:false, error:error.message}, "*"); return; }
  await audit("submitted","agreement",rec.id, msg.note||"Submitted for review");
  window.OPS.flashTop("Sent for review ✓"); window.OPS.refreshReviewCount && window.OPS.refreshReviewCount();
  f.contentWindow.postMessage({type:"app-submitted", ok:true}, "*");
}
window.addEventListener("message",function(ev){
  const f=$("studioFrame"); if(!f || ev.source!==f.contentWindow) return;
  const msg=ev.data||{};
  if(msg.type==="app-ready"){
    // Carry the assigned agreement number into the document so it prints top-left.
    const d = currentEdit ? Object.assign({}, currentEdit.data||{}, { agreementNo: currentEdit.agreement_no || (currentEdit.data&&currentEdit.data.agreementNo) || "" }) : null;
    f.contentWindow.postMessage({type:"app-load", draft: d, panel: studioOpenPanel}, "*"); studioOpenPanel=null; sendStudioReviewers(f); sendStudioOverrides(f);
  }
  else if(msg.type==="app-save"){ saveStudioDraft(msg.draft); }
  else if(msg.type==="app-submit"){ submitStudioDraft(msg, f); }
  else if(msg.type==="app-save-template"){ saveStudioTemplate(msg, f); }
  else if(msg.type==="app-reset-template"){ resetStudioTemplate(msg, f); }
  else if(msg.type==="app-close"){ closeStudio(); }
});

// register routes
R.agreements = viewAgreements;
R.new        = ()=>viewStudio(null);
R.templates  = viewTemplates;
R.team       = viewTeam;
R.audit      = viewAudit;
R.viewAgreementDetail = viewDetail;
})();
