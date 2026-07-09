/* ============================================================================
   Athena Agreements Studio — Two-step approval governance
   window.OPS.gate(spec): if the current user is approval-exempt, apply the action
   immediately; otherwise create a pending_action assigned to a chosen approver.
   window.OPS.applyAction(kind,payload,table,id): the central dispatcher that
   actually performs an approved action (also used for exempt users).
   ============================================================================ */
(function(){
const { $, esc } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const me = ()=>window.OPS.me;
const exemptMe = ()=> !!(window.OPS.profile && window.OPS.profile.approval_exempt);
window.OPS.isApprovalExempt = exemptMe;

/* ---------- central apply dispatcher (returns {data,error} or throws) ---------- */
async function applyAction(kind, payload, target_table, target_id){
  payload = payload || {};
  const bucket = "executed-agreements";
  switch(kind){
    case "template.save":
      return await sb().from("template_overrides").upsert({ template_key:payload.templateKey, clauses:payload.payload, updated_by:me().id, updated_at:new Date().toISOString() });
    case "template.reset":
      return await sb().from("template_overrides").delete().eq("template_key", target_id);
    case "agreement.delete":
      return await sb().from("agreements").delete().eq("id", target_id);
    case "agreement.edit":
      return await sb().from("agreements").update(payload.patch||{}).eq("id", target_id);
    case "agreement.execute":
      return await sb().rpc("mark_executed", { p_id:target_id, p_note:payload.note||null });
    case "executed.create":
      return await sb().from("executed_agreements").insert(payload.row||{});
    case "executed.edit":
      return await sb().from("executed_agreements").update(payload.patch||{}).eq("id", target_id);
    case "executed.delete":
      if(payload.file_path){ try{ await sb().storage.from(bucket).remove([payload.file_path]); }catch(e){} }
      return await sb().from("executed_agreements").delete().eq("id", target_id);
    case "negotiation.delete":
      return await sb().from("negotiations").delete().eq("id", target_id);
    default:
      throw new Error("Unknown approval action: "+kind);
  }
}
window.OPS.applyAction = applyAction;

/* ---------- approver picker (modal) → {approver, note} | null ---------- */
async function pickApprover(title){
  const { data } = await sb().from("profiles").select("id,full_name,email,role").in("role",["approver","admin"]).order("full_name");
  const list = (data||[]).filter(p=>p.id!==me().id);
  if(!list.length){ alert("No Reviewer or Admin / Approver is available to approve this yet. Ask an admin to assign roles in Team & Access."); return null; }
  return await new Promise(resolve=>{
    const ov=document.createElement("div");
    ov.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:80;display:flex;align-items:center;justify-content:center";
    ov.innerHTML=`<div style="background:#fff;max-width:440px;width:92%;border-radius:12px;border-top:5px solid var(--green);padding:20px">
      <h2 style="margin:0 0 4px">Send for approval</h2>
      <p class="muted" style="margin:0 0 12px">${esc(title||"This action")} needs a second person to approve it before it takes effect.</p>
      <label>Approver</label>
      <select id="gaSel" style="width:100%">${list.map(p=>`<option value="${p.id}">${esc(p.full_name||p.email)} (${esc(window.OPS.roleLabel(p.role))})</option>`).join("")}</select>
      <label style="margin-top:10px">Note <span class="muted">(optional)</span></label>
      <input id="gaNote" style="width:100%" placeholder="Anything the approver should know">
      <div class="row" style="margin-top:16px;justify-content:flex-end;gap:8px">
        <button class="btn" id="gaCancel">Cancel</button>
        <button class="btn green" id="gaOk">Send for approval</button></div>
    </div>`;
    document.body.appendChild(ov);
    const done=(v)=>{ try{ document.body.removeChild(ov); }catch(e){} resolve(v); };
    ov.querySelector("#gaCancel").onclick=()=>done(null);
    ov.querySelector("#gaOk").onclick=()=>done({ approver:ov.querySelector("#gaSel").value, note:(ov.querySelector("#gaNote").value||"").trim() });
    ov.addEventListener("click",e=>{ if(e.target===ov) done(null); });
  });
}

/* ---------- gate: the single entry point every governed action calls ----------
   spec = { kind, title, target_table, target_id, payload }
   returns { applied:true } | { queued:true } | { cancelled:true } ; throws on error */
async function gate(spec){
  if(exemptMe()){
    const res = await applyAction(spec.kind, spec.payload, spec.target_table, spec.target_id);
    if(res && res.error) throw new Error(res.error.message);
    window.OPS.audit && window.OPS.audit(spec.kind, spec.target_table||"action", spec.target_id||"", spec.title);
    return { applied:true };
  }
  const pick = await pickApprover(spec.title);
  if(!pick) return { cancelled:true };
  const row = { kind:spec.kind, title:spec.title, target_table:spec.target_table||null,
    target_id: spec.target_id!=null ? String(spec.target_id) : null, payload: spec.payload||null,
    note: pick.note||null, requested_by: me().id, assigned_approver: pick.approver };
  const { error } = await sb().from("pending_actions").insert(row);
  if(error) throw new Error(error.message);
  window.OPS.audit && window.OPS.audit("requested:"+spec.kind, spec.target_table||"action", spec.target_id||"", spec.title);
  try{ await sb().from("notifications").insert({ user_id:pick.approver, message:"Approval requested: "+spec.title }); }catch(e){}
  window.OPS.refreshReviewCount && window.OPS.refreshReviewCount();
  return { queued:true };
}
window.OPS.gate = gate;

/* Convenience: run gate and show a standard toast. cb(result) optional (e.g. refresh UI). */
window.OPS.gateThen = async function(spec, cb){
  try{
    const r = await gate(spec);
    if(r.applied) window.OPS.flashTop((spec.doneMsg||"Done")+" ✓");
    else if(r.queued) window.OPS.flashTop("Sent for approval ✓");
    if(cb) cb(r);
    return r;
  }catch(e){ alert((spec.title||"Action")+" failed: "+(e.message||e)); return { error:e }; }
};
})();
