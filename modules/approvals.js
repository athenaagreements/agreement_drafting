/* ============================================================================
   Athena Agreements Studio — Review / Approvals
   One consolidated queue: each user sees only agreements assigned to them for
   review (admins see everything in_review). Approve/reject run through the
   database RPCs so the workflow rules are enforced server-side.
   ============================================================================ */
(function(){
const { $, esc, fmt, fmtDate, money } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const me = ()=>window.OPS.me;

const TYPES = {
  agreements:  { label:"Agreement", title:r=>r.title||"" },
};
const labelOf = (table,r)=>{ const t=TYPES[table]; if(!t) return "Item"; const l=t.label; return typeof l==="function"?l(r):l; };

async function listProfilesCached(){ if(!window.OPS._profilesCache){ const {data}=await sb().from("profiles").select("id,full_name,email,role").order("full_name"); window.OPS._profilesCache=data||[]; } return window.OPS._profilesCache; }
function nameOf(ps,id){ const p=(ps||[]).find(x=>x.id===id); return p?(p.full_name||p.email):""; }

/* ---------- actions ---------- */
async function notify(userId, message){ try{ if(userId && userId!==me().id) await sb().from("notifications").insert({ user_id:userId, message }); }catch(e){} }

async function submit(table, id, approverId, title){
  const { error }=await sb().from(table).update({ approval_status:"submitted", submitted_by:me().id, submitted_at:new Date().toISOString(), assigned_approver:approverId||null, reject_note:null }).eq("id",id);
  if(error){ alert(error.message); return false; }
  window.OPS.audit("submitted",table,id,title||"");
  await notify(approverId, "Review requested: "+labelOf(table,{})+" "+(title||""));
  window.OPS.refreshNotifs(); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount(); return true;
}
async function approve(table, id, title){
  if(table==="agreements"){ const { error }=await sb().rpc("approve_agreement",{p_id:id,p_note:null}); if(error){ alert(error.message); return false; } }
  else { const { error }=await sb().from(table).update({ approval_status:"approved", approved_by:me().id, approved_at:new Date().toISOString() }).eq("id",id); if(error){ alert(error.message); return false; } }
  window.OPS.audit("approved",table,id,title||""); window.OPS.flashTop("Approved ✓"); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount(); return true;
}
async function reject(table, id, note, title){
  if(table==="agreements"){ const { error }=await sb().rpc("reject_agreement",{p_id:id,p_note:note||null}); if(error){ alert(error.message); return false; } }
  else { const { error }=await sb().from(table).update({ approval_status:"rejected", approved_by:me().id, approved_at:new Date().toISOString(), reject_note:note||null }).eq("id",id); if(error){ alert(error.message); return false; } }
  window.OPS.audit("rejected",table,id,note||""); window.OPS.flashTop("Rejected"); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount(); return true;
}

/* ---------- embeddable approval bar ---------- */
// host = a DOM element; rec = the saved DB row; refresh = () => reload the form
async function bar(table, rec, host, refresh){
  if(!host) return;
  const st = rec.approval_status||"draft";
  const ps = await listProfilesCached();
  const amApprover = rec.assigned_approver===me().id || window.OPS.isAdmin();
  let html = `<div class="card" style="background:#fbfdf8"><div class="row wrap" style="align-items:center">
    <b>Approval:</b> ${window.OPS.statusChip(st==="submitted"?"in_review":st)} `;
  if(st==="draft"||st==="rejected"){
    html += `<span class="muted">Assign reviewer</span>
      <select id="apApprover" style="width:auto;max-width:220px">${ps.filter(p=>p.id!==me().id).map(p=>`<option value="${p.id}">${esc(p.full_name||p.email)} (${p.role})</option>`).join("")}</select>
      <button class="btn orange sm" id="apSubmit">Submit for review</button>`;
    if(st==="rejected" && rec.reject_note) html += `<div class="muted" style="flex-basis:100%;margin-top:6px">Rejected: ${esc(rec.reject_note)}</div>`;
  } else if(st==="submitted"){
    html += `<span class="muted">Awaiting ${esc(nameOf(ps,rec.assigned_approver)||"reviewer")}</span>`;
    if(amApprover) html += ` <button class="btn green sm" id="apApprove">Approve</button> <button class="btn sm" id="apReject" style="color:#a3322a;border-color:#e4b4b4">Reject…</button>`;
  } else if(st==="approved"){
    html += `<span class="muted">Approved by ${esc(nameOf(ps,rec.approved_by)||"")} ${rec.approved_at?("· "+fmtDate(rec.approved_at)):""}</span>`;
  }
  html += `</div></div>`;
  host.innerHTML = html;
  if($("apSubmit")) $("apSubmit").addEventListener("click",async()=>{ if(await submit(table,rec.id,$("apApprover").value,labelOf(table,rec)+" "+TYPES[table].title(rec))) refresh&&refresh(); });
  if($("apApprove")) $("apApprove").addEventListener("click",async()=>{ if(await approve(table,rec.id,TYPES[table].title(rec))) refresh&&refresh(); });
  if($("apReject")) $("apReject").addEventListener("click",async()=>{ const n=prompt("Reason for rejection:"); if(n===null)return; if(await reject(table,rec.id,n,TYPES[table].title(rec))) refresh&&refresh(); });
}

/* ---------- consolidated Review queue ---------- */
async function reviewQueue(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Review / Approvals</div><h1>My review queue</h1>
    <p class="muted">Items submitted for your review and actions awaiting your approval. ${window.OPS.isAdmin()?"As an admin you also see everything pending.":""}</p>
    <h3 style="margin-top:14px">Agreements awaiting review</h3><div id="rvAgs" class="muted">Loading…</div>
    <h3 style="margin-top:22px">Actions awaiting approval</h3><div id="rvActions" class="muted">Loading…</div>`;
  const admin=window.OPS.isAdmin();
  const ps=await listProfilesCached();
  // ---- agreements (own status workflow: draft → in_review → approved/rejected → executed) ----
  (async()=>{
    let q=sb().from("agreements").select("*").eq("status","in_review");
    if(!admin) q=q.eq("assigned_approver",me().id);
    const { data }=await q; const items=(data||[]).map(r=>({table:"agreements",r}));
    if(!items.length){ $("rvAgs").innerHTML='<div class="card muted">Nothing awaiting your review.</div>'; return; }
    const titleOf=(t,r)=> r.title||"";
    $("rvAgs").innerHTML=`<div class="card"><table><thead><tr><th>Type</th><th>Item</th><th>Submitted by</th><th></th></tr></thead>
      <tbody>${items.map((it,i)=>`<tr><td><span class="tag">Agreement</span></td>
        <td><b>${esc(it.r.title||"")}</b></td>
        <td>${esc(nameOf(ps, it.r.created_by))}</td>
        <td><button class="btn green sm" data-act="approve" data-i="${i}">Approve</button>
            <button class="btn sm" data-act="reject" data-i="${i}" style="color:#a3322a;border-color:#e4b4b4">Reject</button>
            <button class="btn sm" data-act="open" data-i="${i}">Open</button></td></tr>`).join("")}</tbody></table></div>`;
    $("rvAgs").querySelectorAll("[data-act]").forEach(b=>b.addEventListener("click",async()=>{
      const it=items[+b.getAttribute("data-i")]; const act=b.getAttribute("data-act");
      if(act==="approve"){ if(await approve(it.table,it.r.id,titleOf(it.table,it.r))) reviewQueue(); }
      else if(act==="reject"){ const n=prompt("Reason for rejection:"); if(n===null)return; if(await reject(it.table,it.r.id,n,titleOf(it.table,it.r))) reviewQueue(); }
      else { openItem(it); }
    }));
  })();
  // ---- generic pending actions (deletes, template changes, edits, status changes, uploads) ----
  renderActions(admin, ps);
}
async function renderActions(admin, ps){
  const host=$("rvActions"); if(!host) return;
  let q=sb().from("pending_actions").select("*").eq("status","pending").order("created_at",{ascending:true});
  if(!admin) q=q.eq("assigned_approver",me().id);
  const { data }=await q; const acts=data||[];
  if(!acts.length){ host.innerHTML='<div class="card muted">No actions awaiting your approval.</div>'; return; }
  host.innerHTML=`<div class="card"><table><thead><tr><th>Action</th><th>Requested by</th><th>Note</th><th></th></tr></thead>
    <tbody>${acts.map((a,i)=>`<tr>
      <td><b>${esc(a.title)}</b><div class="muted">${esc(a.kind)}</div></td>
      <td>${esc(nameOf(ps,a.requested_by))}</td>
      <td>${esc(a.note||"")}</td>
      <td><button class="btn green sm" data-pa="approve" data-i="${i}">Approve</button>
          <button class="btn sm" data-pa="reject" data-i="${i}" style="color:#a3322a;border-color:#e4b4b4">Reject</button></td></tr>`).join("")}</tbody></table></div>`;
  host.querySelectorAll("[data-pa]").forEach(b=>b.addEventListener("click",async()=>{
    const a=acts[+b.getAttribute("data-i")]; const act=b.getAttribute("data-pa");
    if(act==="approve"){ await approveAction(a); } else { const n=prompt("Reason for rejection (optional):"); if(n===null)return; await rejectAction(a,n); }
    reviewQueue();
  }));
}
async function approveAction(a){
  try{
    const res=await window.OPS.applyAction(a.kind, a.payload, a.target_table, a.target_id);
    if(res && res.error) throw new Error(res.error.message);
    await sb().from("pending_actions").update({ status:"applied", decided_by:me().id, decided_at:new Date().toISOString(), applied_at:new Date().toISOString() }).eq("id",a.id);
    window.OPS.audit("approved:"+a.kind, a.target_table||"action", a.target_id||"", a.title);
    await notify(a.requested_by, "Approved: "+a.title);
    window.OPS.flashTop("Approved & applied ✓"); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount();
  }catch(e){
    await sb().from("pending_actions").update({ status:"failed", decided_by:me().id, decided_at:new Date().toISOString(), apply_error:String(e.message||e) }).eq("id",a.id);
    alert("Could not apply this action: "+(e.message||e));
  }
}
async function rejectAction(a,note){
  await sb().from("pending_actions").update({ status:"rejected", decided_by:me().id, decided_at:new Date().toISOString(), note:note||a.note }).eq("id",a.id);
  window.OPS.audit("rejected:"+a.kind, a.target_table||"action", a.target_id||"", note||"");
  await notify(a.requested_by, "Rejected: "+a.title);
  window.OPS.flashTop("Rejected"); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount();
}
function openItem(it){
  if(it.table==="agreements"){ window.OPS.openTool("agreements"); if(window.OPS.routes.viewAgreementDetail) window.OPS.routes.viewAgreementDetail(it.r.id); }
}

window.OPS.approvals = { submit, approve, reject, bar };
window.OPS.routes.reviews = reviewQueue;
})();
