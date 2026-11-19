/* ================= Hub sync: money inputs made in the SCENEDROME Hub flow into these books =================
   Paste the code from Hub → Finance → “Send to Cashflow”. Rows keep a link to their Hub row (hubId), so every
   update edits the same rows; earlier years and anything the Hub doesn't know are left as they are. */
const hk=s=>String(s??"").trim().toLowerCase();
const NEG_HUB=["Deduction","Unpaid leave","Advance repaid"];
function hubSyncApply(P){const st={added:0,updated:0,removed:0,pays:0,entries:0,projects:0,newProjects:0};const m=S.main;const td=today();
  const lists=m.settings.lists=m.settings.lists||{};const addList=(k,v)=>{if(!v)return;const cur=LST(k);if(!cur.includes(v)){lists[k]=[...cur,v]}};
  function rows(list,hub,key,merge,make,fuzzy){hub=hub||[];const ids=new Set(hub.map(h=>h.id));for(let i=list.length-1;i>=0;i--)if(list[i].hubId&&!ids.has(list[i].hubId)){list.splice(i,1);st.removed++}
    const used=new Set();for(const h of hub){let r=list.find(x=>x.hubId===h.id);const was=!!r;if(!r){const k=key(h);if(k)r=list.find(x=>!x.hubId&&!used.has(x)&&key(x)===k)}let fz=false;if(!r&&fuzzy){r=list.find(x=>!x.hubId&&!used.has(x)&&fuzzy(x,h))||null;fz=!!r}
      const fresh=!r;if(!r){r=make();list.push(r);st.added++}else st.updated++;const nf="name" in h?"name":"location" in h?"location":"service";const old=r[nf];merge(r,h,was||fresh);if(!fresh&&old&&(fz||(was&&r.hubName===h[nf])))r[nf]=old;r.hubName=h[nf];r.hubId=h.id;used.add(r)}}
  function pays(arr,hub,cur,rate,same,trust){hub=hub||[];const ids=new Set(hub.map(h=>h.id));for(let i=arr.length-1;i>=0;i--)if(arr[i].hubId&&!ids.has(arr[i].hubId))arr.splice(i,1);
    const used=new Set();for(const h of hub){let x=arr.find(p=>p.hubId===h.id);const linked=!!x;if(!x)x=arr.find(p=>!p.hubId&&!used.has(p)&&same(p,h));
      if(!x){x=T.payment(cur,rate);x.date=h.date||td;x.amount=num(h.amount);x.note=h.note||"";arr.push(x);st.pays++}
      else if(linked||trust){x.amount=num(h.amount);if(h.date)x.date=h.date;if(h.note!==undefined)x.note=h.note}x.hubId=h.id;used.add(x)}}
  function months(r,hubMap){r.paid=r.paid||{};const prev=r.hubPaid||[];const now=Object.keys(hubMap||{});for(const k of prev)if(!now.includes(k))delete r.paid[k];for(const k of now)r.paid[k]=num(hubMap[k]);r.hubPaid=now}
  const B=P.books||{};
  if(B.salaries){rows(m.salaries,B.salaries.rows,h=>hk(h.name),(r,h,trust)=>{r.name=h.name||r.name;r.role=h.role??r.role;r.type=h.type||r.type;if(h.contact)r.contact=h.contact;if(h.start)r.start=h.start;r.end=h.end||"";
      r.active=h.active!==false&&!(h.end&&h.end<td);r.include=h.include!==false;if(h.note)r.note=h.note;addList("empTypes",h.type);months(r,h.paid);
      const H=salHist(r);const hids=new Set((h.salHist||[]).map(x=>x.id));for(let i=H.length-1;i>=0;i--)if(H[i].hubId&&!hids.has(H[i].hubId))H.splice(i,1);
      for(const x of h.salHist||[]){let e=H.find(y=>y.hubId===x.id)||H.find(y=>!y.hubId&&y.from===x.from);if(!e){e={id:uid(),from:x.from,amount:0,note:""};H.push(e)}e.from=x.from;e.amount=num(x.amount);if(x.note)e.note=x.note;e.hubId=x.id}
      salHist(r);r.monthly=salaryAt(r,curYM());
      r.adj=r.adj||[];const aids=new Set((h.adj||[]).map(x=>x.id));for(let i=r.adj.length-1;i>=0;i--)if(r.adj[i].hubId&&!aids.has(r.adj[i].hubId))r.adj.splice(i,1);
      for(const x of h.adj||[]){const neg=NEG_HUB.includes(x.type);const type=neg?"Deduction":(x.type||"Bonus");const reason=[neg&&x.type!=="Deduction"?x.type:"",x.reason||""].filter(Boolean).join(" · ");
        let a=r.adj.find(y=>y.hubId===x.id)||r.adj.find(y=>!y.hubId&&y.date===x.date&&y.type===type&&num(y.amount)===num(x.amount));if(!a){a={id:uid()};r.adj.push(a)}Object.assign(a,{date:x.date,type,amount:Math.abs(num(x.amount)),reason,hubId:x.id})}},()=>T.salary())}
  if(B.office){const o=B.office;
    rows(m.rent,o.rent,h=>hk(h.location),(r,h)=>{r.location=h.location||r.location;r.amount=num(h.amount);r.periodMonths=num(h.periodMonths)||r.periodMonths||3;r.include=h.include!==false;if(h.note)r.note=h.note;r.schedule=r.schedule||[];
      const ids=new Set((h.schedule||[]).map(x=>x.id));for(let i=r.schedule.length-1;i>=0;i--)if(r.schedule[i].hubId&&!ids.has(r.schedule[i].hubId))r.schedule.splice(i,1);
      const usedE=new Set();for(const x of h.schedule||[]){const y=+String(x.due||"").slice(0,4)||m.settings.year;let e=r.schedule.find(z=>z.hubId===x.id)||r.schedule.find(z=>!z.hubId&&!usedE.has(z)&&((z.due&&z.due===x.due)||(!z.due&&num(z.year)===y&&num(z.amount)===num(x.amount))));if(e)usedE.add(e);
        if(!e){const used=r.schedule.filter(z=>num(z.year)===y).map(z=>num(z.q));let q=1;while(used.includes(q))q++;e={id:uid(),year:y,q,due:"",amount:0,paid:0,paidDate:"",note:""};r.schedule.push(e);st.pays++}
        Object.assign(e,{year:y,due:x.due||e.due,amount:num(x.amount),paid:num(x.paid),paidDate:x.paidDate||"",hubId:x.id});if(x.note)e.note=x.note}},()=>T.rentItem());
    m.office=m.office||[];rows(m.office,o.items,h=>hk(h.name),(r,h)=>{Object.assign(r,{name:h.name||r.name,vendor:h.vendor||"",currency:h.currency||"EGP",monthly:num(h.monthly),rate:h.rate??null,start:h.start||"",end:h.end||"",include:h.include!==false});if(h.note)r.note=h.note;months(r,h.paid)},()=>T.officeItem(),(x,h)=>hk(x.name).replace(/[^a-z]/g,'').slice(0,6)===hk(h.name).replace(/[^a-z]/g,'').slice(0,6)&&num(x.monthly)===num(h.monthly)&&!!hk(x.name));
    rows(m.expenses,o.expenses,h=>[h.date,hk(h.category),num(h.cost)].join("|"),(r,h,trust)=>{Object.assign(r,{date:h.date||r.date,category:h.category||r.category,name:h.name||"",serial:h.serial||"",vendor:h.vendor||"",currency:h.currency||"EGP",budget:num(h.budget),cost:num(h.cost),rate:h.rate??null,include:h.include!==false});if(h.note)r.note=h.note;addList("expCats",h.category);
      r.payments=r.payments||[];pays(r.payments,h.payments,r.currency,r.rate,(p,x)=>Math.abs(payEGP(p,r.rate)-toEGP(h.currency||"EGP",x.amount,h.rate))<1,false)},()=>T.expense())}
  if(B.assets){rows(m.assets,B.assets.rows,h=>hk(h.name)+"|"+(h.date||""),(r,h)=>{Object.assign(r,{date:h.date||r.date,category:h.category||r.category,name:h.name||"",serial:h.serial||"",vendor:h.vendor||"",currency:h.currency||"EGP",cost:num(h.cost),rate:h.rate??null,condition:h.condition||r.condition,assignedTo:h.assignedTo||"",location:h.location||"",warranty:h.warranty||"",include:h.include!==false});if(h.note)r.note=h.note;addList("assetCats",h.category);addList("assetCond",h.condition);
      r.payments=r.payments||[];pays(r.payments,h.payments,r.currency,r.rate,(p,x)=>Math.abs(payEGP(p,r.rate)-toEGP(h.currency||"EGP",x.amount,h.rate))<1,false)},()=>T.asset())}
  if(B.subs){rows(m.subscriptions,B.subs.rows,h=>hk(h.service),(s,h)=>{Object.assign(s,{service:h.service||s.service,billing:h.billing||s.billing,currency:h.currency||"EGP",rate:h.rate??null,renewal:h.renewal||"",status:h.status||"Active",include:h.include!==false});if(h.account)s.account=h.account;if(h.note)s.note=h.note;if(h.stopFrom)s.stopFrom=h.stopFrom;
      const H=planHist(s);const ids=new Set((h.planHist||[]).map(x=>x.id));for(let i=H.length-1;i>=0;i--)if(H[i].hubId&&!ids.has(H[i].hubId))H.splice(i,1);
      for(const x of h.planHist||[]){let e=H.find(y=>y.hubId===x.id)||H.find(y=>!y.hubId&&y.from===x.from);if(!e){e={id:uid(),from:x.from,plan:"",price:0,note:""};H.push(e)}Object.assign(e,{from:x.from,price:num(x.price),hubId:x.id});if(x.plan)e.plan=x.plan;if(x.note)e.note=x.note}planHist(s);syncSub(s);
      s.payments=s.payments||[];pays(s.payments,h.payments,s.currency,s.rate,(p,x)=>Math.abs(payEGP(p,s.rate)-toEGP(h.currency||"EGP",x.amount,h.rate))<1&&String(p.date).slice(0,7)===String(x.date).slice(0,7),false)},()=>T.sub())}
  /* projects: names, clients, dates, status, progress — matched once by name, then by their Hub link */
  const STM={active:null,done:null,pitching:"Pitching",cancelled:"Canceled"};const byHub={};const wanted=new Set((P.entries||[]).map(e=>e.project));
  for(const h of P.projects||[]){let p=Object.values(S.projects).find(x=>x.hubId===h.hubId)||Object.values(S.projects).find(x=>!x.hubId&&hk(x.name)===hk(h.name));
    if(!p){if(!wanted.has(h.hubId))continue;p=T.project(h.name);p.income=[];p.costs=[];S.projects[p.id]=p;m.order.push(p.id);st.newProjects++}
    p.hubId=h.hubId;p.name=h.name||p.name;if(h.client)p.client=h.client;if(h.start)p.start=h.start;if(h.due)p.end=h.due;p.progress=Math.max(0,Math.min(100,num(h.prog)));
    let ns=STM[h.status];if(h.status==="active")ns=["Signed","In Production"].includes(p.status)?p.status:"In Production";if(h.status==="done")ns=h.moneyDue?"Delivered $":"Delivered";if(ns)p.status=ns;
    const t=String(h.tax||"").match(/(\d+(?:\.\d+)?)/);if(t&&num(t[1])!==taxPct(p)){if(num(t[1])===num(m.settings.defaultTax))p.taxMode="default";else{p.taxMode="custom";p.taxPct=num(t[1])}}
    if(h.carried&&!p.carryNote)p.carryNote=h.carried;byHub[h.hubId]=p;st.projects++;markDirty("p:"+p.id)}
  /* approved project money from the Hub — each entry is written once */
  m.hubSync=m.hubSync||{};m.hubSync.entries=m.hubSync.entries||{};
  for(const e of P.entries||[]){if(m.hubSync.entries[e.id])continue;const p=byHub[e.project];if(!p)continue;const cur=e.cur&&e.cur!=="EGP"?e.cur:"EGP",rate=cur!=="EGP"?(num(e.rate)||null):null,note=(e.note||"")+(e.by?" · via Hub ("+e.by+")":"");
    if(e.kind==="quote"){const l=T.income();Object.assign(l,{item:e.item,currency:cur,amount:num(e.amount),rate,note:note+(e.due?" · due "+e.due:""),hubEntry:e.id});p.income.push(l)}
    else if(e.kind==="payin"){let l=p.income.find(x=>x.item===e.line)||p.income[0];if(!l){l=T.income();l.item=e.line||"Client payment";l.currency=cur;p.income.push(l)}const x=T.payment(cur,rate);Object.assign(x,{date:e.date||td,amount:num(e.amount),note,hubEntry:e.id});l.payments.push(x)}
    else if(e.kind==="cost"){const l=T.cost();Object.assign(l,{name:e.item,role:e.role,currency:cur,amount:num(e.amount),rate,note,hubEntry:e.id});p.costs.push(l)}
    else if(e.kind==="payout"){let l=p.costs.find(x=>x.name===e.line);if(!l){l=T.cost();l.name=e.line||"Payment";l.currency=cur;p.costs.push(l)}const x=T.payment(cur,rate);Object.assign(x,{date:e.date||td,amount:num(e.amount),note,hubEntry:e.id});l.payments.push(x)}
    m.hubSync.entries[e.id]=p.id;st.entries++;markDirty("p:"+p.id)}
  m.hubSync.at=P.at;m.hubSync.from=P.from||"";markDirty("main");return st}
A.hubOpen=function(){const L=document.getElementById("layer");const d=document.createElement("div");d.className="modal";const last=S.main.hubSync&&S.main.hubSync.at;
  d.innerHTML=`<div class="box hubbox" role="dialog" aria-modal="true"><h3>Update from the Hub</h3><p>In the Hub open <b>Finance → SCENEDROME Cashflow → Send to Cashflow</b>, then paste the code here or pick the saved file.${last?` Last update: ${esc(fmtDate(String(last).slice(0,10)))}.`:""}</p>
   <textarea id="hubCode" rows="5" placeholder="Paste the sync code" style="width:100%;background:var(--field);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px;font:12px ui-monospace,monospace;box-sizing:border-box"></textarea>
   <div style="margin:8px 0"><label class="btn sm ghost" style="cursor:pointer">Pick a file…<input type="file" id="hubFile" accept="application/json,.json" hidden></label></div>
   <div id="hubSum" class="note" style="min-height:18px"></div>
   <div class="acts"><button class="btn ghost" data-x="0">Cancel</button><button class="btn pri" id="hubGo" disabled>Apply</button></div></div>`;L.appendChild(d);
  let P=null;const ta=d.querySelector("#hubCode"),sum=d.querySelector("#hubSum"),go=d.querySelector("#hubGo");
  const read=t=>{P=null;go.disabled=true;try{const o=JSON.parse(t);if(o.app!=="scenedrome-hub-sync")throw 0;P=o;const b=o.books||{};const c=(x,k)=>x&&x[k]?x[k].length:0;
    const newE=(o.entries||[]).filter(e=>!(S.main.hubSync&&S.main.hubSync.entries&&S.main.hubSync.entries[e.id])).length;
    sum.innerHTML=`From ${esc(o.from||"the Hub")} · ${esc(fmtDate(String(o.at).slice(0,10)))}<br>Manpower ${c(b.salaries,"rows")} · rent ${c(b.office,"rent")} · office ${c(b.office,"items")} · expenses ${c(b.office,"expenses")} · assets ${c(b.assets,"rows")} · subscriptions ${c(b.subs,"rows")} · projects ${(o.projects||[]).length} · new project money ${newE}<br><span style="color:var(--warn)">The Hub’s version of these rows replaces the matching rows here. Earlier years and rows the Hub doesn’t have stay as they are. You can undo right after.</span>`;go.disabled=false}catch(_){sum.textContent=t.trim()?"That isn’t a Hub sync code.":""}};
  ta.addEventListener("input",()=>read(ta.value));d.querySelector("#hubFile").addEventListener("change",async e=>{const f=e.target.files[0];if(f){ta.value=await f.text();read(ta.value)}});
  d.addEventListener("click",e=>{if(e.target.dataset.x==="0"||e.target===d)d.remove()});
  go.addEventListener("click",()=>{if(!P)return;if(!canWrite){toast("This view is read-only");return}pushUndo();let r;try{r=hubSyncApply(P)}catch(err){undo();toast("Couldn’t apply that code — nothing changed");return}d.remove();render();
    toast(`Updated from the Hub: ${r.updated} rows refreshed, ${r.added} added${r.removed?", "+r.removed+" removed":""}, ${r.entries} project money entr${r.entries===1?"y":"ies"}${r.newProjects?", "+r.newProjects+" new project"+(r.newProjects>1?"s":""):""}`,true)});
  setTimeout(()=>ta.focus(),30)};

