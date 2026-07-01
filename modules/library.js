/* ============================================================================
   Athena Agreements Studio — Executed-agreement libraries (Vendor + Client)
   Stores signed agreements: a metadata row in public.executed_agreements plus
   the file itself in the private Storage bucket 'executed-agreements'.
   ============================================================================ */
(function(){
const { $, esc, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const me = ()=>window.OPS.me;
const BUCKET = "executed-agreements";

const ENTITY_OPTS = ["Athena India","Athena US","Athena Africa","Athena Bangladesh","Tola Data",""];
const CAT_OPTS = ["Service Agreement","NDA","Business Development / Teaming","MOU","Independent Contractor","Amendment","Work Order","Other",""];

function kindMeta(kind){
  return kind==="vendor"
    ? { title:"Vendor agreements", eyebrow:"Libraries · Vendor", cpLabel:"Vendor / Consultant" }
    : { title:"Client agreements", eyebrow:"Libraries · Client", cpLabel:"Client" };
}

async function list(kind){
  const meta=kindMeta(kind); const m=$("main");
  m.innerHTML=`<div class="eyebrow">${esc(meta.eyebrow)}</div><h1>${esc(meta.title)}</h1>
    <p class="muted">A searchable library of executed (signed) ${kind} agreements. Upload the final signed copy and its key details.</p>
    <div class="row wrap" style="margin:10px 0">
      <input id="lbSearch" placeholder="Search by title, ${esc(meta.cpLabel.toLowerCase())}, category…" style="max-width:320px">
      <div class="spacer"></div>
      <button class="btn green sm" id="lbNew">+ Upload agreement</button>
    </div>
    <div id="lbList" class="muted">Loading…</div>`;
  $("lbNew").addEventListener("click",()=>form(kind,null));
  const { data, error } = await sb().from("executed_agreements").select("*").eq("kind",kind).order("created_at",{ascending:false});
  if(error){ $("lbList").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  const all=data||[];
  function render(rows){
    $("lbList").innerHTML = rows.length ? `<div class="card"><table><thead><tr>
        <th>Agreement No.</th><th>Title</th><th>${esc(meta.cpLabel)}</th><th>Category</th><th>Entity</th><th>Signed</th><th>File</th></tr></thead>
      <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}">
        <td>${r.agreement_no?esc(r.agreement_no):'<span class="muted">—</span>'}</td>
        <td><b>${esc(r.title||"")}</b></td>
        <td>${esc(r.counterparty||"")}</td>
        <td>${esc(r.category||"")}</td>
        <td>${esc(r.entity||"")}</td>
        <td>${r.signed_date?esc(fmtDate(r.signed_date)):"—"}</td>
        <td>${r.file_path?"📎":"—"}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="card muted">No agreements uploaded yet.</div>';
    $("lbList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>form(kind, all.find(x=>x.id===tr.getAttribute("data-id")))));
  }
  render(all);
  $("lbSearch").addEventListener("input",e=>{
    const q=e.target.value.toLowerCase().trim();
    render(!q?all:all.filter(r=>["title","counterparty","category","entity","agreement_no"].some(k=>String(r[k]||"").toLowerCase().includes(q))));
  });
}

function form(kind, rec){
  const meta=kindMeta(kind); const e=rec||{}; const m=$("main");
  m.innerHTML=`<button class="btn sm" id="lbBack">← Back to ${esc(meta.title)}</button>
    <div class="card" style="margin-top:12px">
      <div class="eyebrow">${esc(meta.eyebrow)}</div><h1>${rec?"Agreement details":"Upload executed agreement"}</h1>
      <div class="fgrid">
        <div class="field full"><label>Title *</label><input id="lb_title" value="${esc(e.title||"")}"></div>
        <div class="field"><label>${esc(meta.cpLabel)}</label><input id="lb_cp" value="${esc(e.counterparty||"")}"></div>
        <div class="field"><label>Category</label><select id="lb_cat">${CAT_OPTS.map(o=>`<option ${String(e.category||"")===o?'selected':''}>${esc(o)}</option>`).join("")}</select></div>
        <div class="field"><label>Athena entity</label><select id="lb_entity">${ENTITY_OPTS.map(o=>`<option ${String(e.entity||"")===o?'selected':''}>${esc(o)}</option>`).join("")}</select></div>
        <div class="field"><label>Signed date</label><input id="lb_signed" type="date" value="${esc(e.signed_date||"")}"></div>
        <div class="field"><label>Agreement No.</label><input id="lb_agno" value="${esc(e.agreement_no||"")}" placeholder="e.g. Athena/FY25-26/001/…"></div>
        <div class="field full"><label>Notes</label><textarea id="lb_notes">${esc(e.notes||"")}</textarea></div>
        <div class="field full"><label>Signed file (PDF / DOCX)</label>
          ${e.file_path?`<div class="muted" style="margin-bottom:6px">Current: 📎 ${esc(e.file_name||"file")} — <a href="#" id="lbDownload">download</a></div>`:''}
          <input id="lb_file" type="file" accept=".pdf,.docx,.doc,application/pdf">
        </div>
      </div>
      <div class="row" style="margin-top:6px">
        <button class="btn green" id="lbSave">${rec?"Save changes":"Upload & save"}</button>
        <button class="btn" id="lbCancel">Cancel</button>
        <div class="spacer"></div>
        ${rec?'<button class="btn sm" id="lbDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}
      </div>
      <div class="err" id="lbErr"></div>
    </div>`;
  $("lbBack").addEventListener("click",()=>list(kind));
  $("lbCancel").addEventListener("click",()=>list(kind));
  if($("lbDownload")) $("lbDownload").addEventListener("click",async(ev)=>{ ev.preventDefault(); await download(e.file_path); });

  $("lbSave").addEventListener("click",async()=>{
    const title=$("lb_title").value.trim();
    if(!title){ $("lbErr").textContent="Title is required."; return; }
    $("lbSave").disabled=true; $("lbErr").textContent="";
    const row={
      kind, title,
      counterparty:$("lb_cp").value.trim()||null,
      category:$("lb_cat").value||null,
      entity:$("lb_entity").value||null,
      signed_date:$("lb_signed").value||null,
      notes:$("lb_notes").value.trim()||null,
      agreement_no:$("lb_agno").value.trim()||null,
    };
    try{
      const f=$("lb_file").files[0];
      if(f){
        const path=`${kind}/${me().id}/${Date.now()}_${f.name.replace(/[^\w.\-]+/g,"_")}`;
        const up=await sb().storage.from(BUCKET).upload(path,f,{upsert:false});
        if(up.error) throw up.error;
        row.file_path=path; row.file_name=f.name;
      }
      if(rec){
        await window.OPS.gateThen({ kind:"executed.edit", title:"Edit "+kind+" agreement: "+title, target_table:"executed_agreements", target_id:rec.id, payload:{patch:row}, doneMsg:"Saved" }, ()=>list(kind));
      }else{
        row.uploaded_by=me().id;
        await window.OPS.gateThen({ kind:"executed.create", title:"Upload "+kind+" agreement: "+title, target_table:"executed_agreements", payload:{row}, doneMsg:"Uploaded" }, ()=>list(kind));
      }
    }catch(err){ $("lbErr").textContent=err.message||String(err); $("lbSave").disabled=false; }
  });

  if($("lbDel")) $("lbDel").addEventListener("click",async()=>{
    if(!confirm("Delete this agreement record"+(e.file_path?" and its file":"")+"?")) return;
    await window.OPS.gateThen({ kind:"executed.delete", title:"Delete "+kind+" agreement: "+(e.title||""), target_table:"executed_agreements", target_id:rec.id, payload:{file_path:e.file_path||null}, doneMsg:"Deleted" }, ()=>list(kind));
  });
}

async function download(path){
  if(!path) return;
  const { data, error }=await sb().storage.from(BUCKET).createSignedUrl(path,120);
  if(error){ alert(error.message); return; }
  if(data && data.signedUrl) window.open(data.signedUrl,"_blank","noopener");
}

window.OPS.routes.vendor_library = ()=>list("vendor");
window.OPS.routes.client_library = ()=>list("client");
})();
