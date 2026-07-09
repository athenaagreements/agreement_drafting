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

async function listProfilesCached(){ if(!window.OPS._profilesCache){ const {data}=await sb().from("profiles").select("id,full_name,email,role").order("full_name"); window.OPS._profilesCache=data||[]; } return window.OPS._profilesCache; }
function nameOf(ps,id){ const p=(ps||[]).find(x=>x.id===id); return p?(p.full_name||p.email):""; }

/* ---------- actions ---------- */
async function notify(userId, message){ try{ if(userId && userId!==me().id) await sb().from("notifications").insert({ user_id:userId, message }); }catch(e){} }

async function approve(table, id, title){
  const { error }=await sb().rpc("approve_agreement",{p_id:id,p_note:null}); if(error){ alert(error.message); return false; }
  // A Reviewer only *recommends*; an Admin / Approver gives final approval. Reflect that honestly.
  const msg = window.OPS.isAdmin() ? "Approved ✓" : "Recommended — sent to an admin for final approval ✓";
  window.OPS.audit("approved",table,id,title||""); window.OPS.flashTop(msg); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount(); return true;
}
async function reject(table, id, note, title){
  const { error }=await sb().rpc("reject_agreement",{p_id:id,p_note:note||null}); if(error){ alert(error.message); return false; }
  window.OPS.audit("rejected",table,id,note||""); window.OPS.flashTop("Rejected"); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount(); return true;
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
    // Admins also see 'recommended' items (an approver has recommended them; an admin must
    // finalise). Non-admin approvers only see the in_review items assigned to them.
    let q=sb().from("agreements").select("*").in("status", admin?["in_review","recommended"]:["in_review"]);
    if(!admin) q=q.eq("assigned_approver",me().id);
    const { data }=await q; const items=(data||[]).map(r=>({table:"agreements",r}));
    if(!items.length){ $("rvAgs").innerHTML='<div class="card muted">Nothing awaiting your review.</div>'; return; }
    const titleOf=(t,r)=> r.title||"";
    $("rvAgs").innerHTML=`<div class="card"><table><thead><tr><th>Type</th><th>Item</th><th>Status</th><th>Submitted by</th><th></th></tr></thead>
      <tbody>${items.map((it,i)=>`<tr><td><span class="tag">Agreement</span></td>
        <td><b>${esc(it.r.title||"")}</b></td>
        <td>${window.OPS.statusChip?window.OPS.statusChip(it.r.status):esc(it.r.status)}</td>
        <td>${esc(nameOf(ps, it.r.created_by))}</td>
        <td><button class="btn green sm" data-act="approve" data-i="${i}">${admin&&it.r.status==="recommended"?"Final approve":"Approve"}</button>
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
    // Storage files can't be removed from SQL, so clean up a deleted upload's file here first.
    if(a.kind==="executed.delete" && a.payload && a.payload.file_path){
      try{ await sb().storage.from("executed-agreements").remove([a.payload.file_path]); }catch(_){}
    }
    // Apply through the SECURITY DEFINER RPC: it authorises this approver, then performs the
    // action with definer rights, marks it applied, and notifies the requester — all server-side.
    // (Doing it client-side ran in the approver's context, where owner-keyed RLS made approved
    //  deletes/edits silently no-op and library uploads hard-fail.)
    const { error } = await sb().rpc("apply_pending_action", { p_id:a.id });
    if(error) throw error;
    window.OPS.audit("approved:"+a.kind, a.target_table||"action", a.target_id||"", a.title);
    window.OPS.flashTop("Approved & applied ✓"); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount();
  }catch(e){
    try{ await sb().from("pending_actions").update({ status:"failed", decided_by:me().id, decided_at:new Date().toISOString(), apply_error:String(e.message||e) }).eq("id",a.id); }catch(_){}
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

window.OPS.approvals = { approve, reject };
window.OPS.routes.reviews = reviewQueue;
})();
