const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const currency=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(n||0);
const moneyCur=(n,cur)=>cur==='USD'?('US$ '+new Intl.NumberFormat('es-AR',{maximumFractionDigits:0}).format(n||0)):currency(n);
const today=new Date().toISOString().slice(0,10);
const curMonth=today.slice(0,7);
const MONTHS_SHORT=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

/* ---------- Datos base ---------- */
const seed={
  categories:['Vivienda','Servicios','Supermercado','Transporte','Salud','Ocio','Viajes','Profesional','Impuestos','Suscripciones','Educación','Tarjetas','Otros'],
  payments:['Efectivo','Tarjeta de débito','Tarjeta de crédito','Transferencia','Billetera virtual'],
  cards:['TC Banco Santa Fe','TC Credicoop','TC Cabal','TC Mercado Pago'],
  movements:[],
  budgets:[],
  goals:[],
  fixed:[]
};

let state=JSON.parse(localStorage.getItem('claro-data-gisela')||JSON.stringify(seed));
/* Migraciones suaves: si venís de una versión anterior, completamos lo que falte */
state.categories=state.categories||seed.categories.slice();
if(!state.categories.includes('Tarjetas'))state.categories.splice(state.categories.length-1,0,'Tarjetas');
if(!state.categories.includes('Otros'))state.categories.push('Otros');
state.payments=state.payments&&state.payments.length?state.payments:seed.payments.slice();
state.cards=state.cards||seed.cards.slice();
state.movements=state.movements||[];
state.budgets=state.budgets||[];
state.goals=state.goals||[];
state.fixed=state.fixed||[];
if(typeof state.saldoInicial==='undefined')state.saldoInicial=null; // dinero en el banco al arrancar
state.saldoFecha=state.saldoFecha||today;

let currentType='expense';
let editingId=null;

function persist(){localStorage.setItem('claro-data-gisela',JSON.stringify(state));render();cloudPush();}

/* ---------- Helpers de fechas y totales ---------- */
let extraIncome=[]; // ingresos que vienen en vivo de la app de Facturación (no se guardan en Claro)
let viewMonth=curMonth; // mes que se muestra en el panel
function monthLabel(m){const p=m.split('-');return new Date(+p[0],+p[1]-1,1).toLocaleDateString('es-AR',{month:'long',year:'numeric'});}
function monthBalance(){const mm=monthMovements();return sumByType(mm,'income')-sumByType(mm,'expense')-sumByType(mm,'saving');}
function bankBalance(){const base=Number(state.saldoInicial)||0;const from=state.saldoFecha||today;return base+allMov().filter(m=>m.date>=from).reduce((a,m)=>a+(m.type==='income'?m.amount:-m.amount),0);}
function deriveFactIncome(fact){const out=[];if(!fact)return out;(fact.facturas||[]).forEach(f=>{if(f.cobrado&&Number(f.cobradoMonto)>0)out.push({id:'fact:'+f.id,srcId:'fact:'+f.id,fromFact:true,type:'income',amount:Number(f.cobradoMonto),description:'Cobro '+(f.pagador||'Obra social')+(f.nro?(' · Fact '+f.nro):''),category:'Profesional',payment:'Transferencia',date:f.cobradoFecha||f.fecha,tags:['Obra social','Facturación'],professional:false});});(fact.ingresos||[]).forEach(i=>{if(!Number(i.monto))return;out.push({id:'ing:'+i.id,srcId:'ing:'+i.id,fromFact:true,type:'income',amount:Number(i.monto),description:i.concepto||i.categoria||'Ingreso',category:'Profesional',payment:'Transferencia',date:i.fecha,tags:[i.categoria,'Facturación'].filter(Boolean),professional:false});});return out;}
function allMov(){if(!extraIncome.length)return state.movements;const has={};extraIncome.forEach(m=>has[m.srcId]=1);return state.movements.filter(m=>!(m.srcId&&has[m.srcId])).concat(extraIncome);}
function ym(dateStr){return dateStr.slice(0,7);}
function addMonths(ymStr,delta){let [y,m]=ymStr.split('-').map(Number);let d=new Date(y,m-1+delta,1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
function daysInMonth(ymStr){let [y,m]=ymStr.split('-').map(Number);return new Date(y,m,0).getDate();}
function monthMovements(m=viewMonth){return allMov().filter(mv=>ym(mv.date)===m);}
function sumByType(list,type){return list.filter(m=>m.type===type).reduce((a,m)=>a+m.amount,0);}
function totals(){let all=allMov(),inc=sumByType(all,'income'),out=sumByType(all,'expense'),save=sumByType(all,'saving');return{inc,out,save,balance:inc-out-save};}
function icon(type){return type==='income'?'↓':type==='saving'?'◎':'↑';}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
const catColors=['#81b89b','#e9aa85','#b5a6df','#e0c66e','#88b7c6','#e9a8b3'];

function movementRow(m){const sign=m.type==='income'?'+':'−';return `<div class="movement"><span class="movement-icon ${m.type}">${icon(m.type)}</span><div class="movement-info"><strong>${escapeHtml(m.description)}</strong><span>${escapeHtml(m.category)}${m.card?' · '+escapeHtml(m.card):''} · ${new Date(m.date+'T12:00').toLocaleDateString('es-AR',{day:'numeric',month:'short'})}${m.professional?' · Profesional':''}</span></div><span class="movement-amount ${m.type}">${sign}${currency(m.amount)}</span>${m.fromFact?'<span class="from-fact" title="Viene de tu app de Facturación">Facturación</span>':`<button class="edit-movement" data-id="${m.id}">Editar</button>`}</div>`;}

function categoryTotals(m=viewMonth){let items={};monthMovements(m).filter(mv=>mv.type==='expense').forEach(mv=>items[mv.category]=(items[mv.category]||0)+mv.amount);return Object.entries(items).sort((a,b)=>b[1]-a[1]);}

/* ---------- Render principal ---------- */
function render(){
  const t=totals();
  const bankMode=state.saldoInicial!=null;
  $('#balance').textContent=$('#balance').dataset.hidden==='1'?'••••••':currency(bankMode?bankBalance():monthBalance());
  const esActual=viewMonth===curMonth;
  const lbl=$('#balanceLabel');if(lbl)lbl.textContent=bankMode?'💵 En el banco':('Balance de '+monthLabel(viewMonth));
  const mb=$('#monthButton');if(mb)mb.textContent=(esActual?'Este mes':monthLabel(viewMonth));
  const mn=$('#monthNext');if(mn)mn.disabled=esActual;
  $('#income').textContent=currency(sumByType(monthMovements(),'income'));
  $('#expense').textContent=currency(sumByType(monthMovements(),'expense'));
  const ahoArs=state.goals.filter(g=>(g.currency||'ARS')!=='USD').reduce((a,g)=>a+(Number(g.saved)||0),0);const ahoUsd=state.goals.filter(g=>g.currency==='USD').reduce((a,g)=>a+(Number(g.saved)||0),0);$('#savings').textContent=ahoUsd?(currency(ahoArs)+' · '+moneyCur(ahoUsd,'USD')):currency(ahoArs);
  if(bankMode){const mm=monthMovements();const el=$('#balance').parentElement.querySelector('.balance-change');if(el)el.innerHTML=`En ${monthLabel(viewMonth)}: entró ${currency(sumByType(mm,'income'))} · gastaste ${currency(sumByType(mm,'expense'))}`;}
  else renderComparison();

  const recent=[...allMov()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  $('#recentMovements').innerHTML=recent.map(movementRow).join('')||'<p class="muted">Todavía no hay movimientos.</p>';

  const cats=categoryTotals(),totalCat=cats.reduce((a,c)=>a+c[1],0)||1,max=cats[0]?.[1]||1;
  $('#categoryChart').innerHTML=cats.slice(0,5).map(([name,val],i)=>`<div class="category-row"><i class="category-dot" style="background:${catColors[i%catColors.length]}"></i><div><div class="category-name"><b>${escapeHtml(name)}</b><span>${currency(val)}</span></div><div class="progress-track"><div class="progress-fill" style="width:${val/max*100}%;background:${catColors[i%catColors.length]}"></div></div></div><span>${Math.round(val/totalCat*100)}%</span></div>`).join('')||'<p class="muted">Registrá un gasto para ver la distribución.</p>';

  renderMovements();renderBudgets();renderGoals();renderFixed();renderReports();renderSettingsTags();
}

/* Comparación con el mes anterior */
function renderComparison(){
  const prev=addMonths(viewMonth,-1);
  const curOut=sumByType(monthMovements(viewMonth),'expense');
  const prevOut=sumByType(monthMovements(prev),'expense');
  const el=$('#balance').parentElement.querySelector('.balance-change');
  if(!el)return;
  if(prevOut===0){el.innerHTML=allMov().length?'Todavía no hay datos del mes pasado para comparar.':'Empezá registrando tu primer movimiento';return;}
  const diff=curOut-prevOut,pct=Math.round(Math.abs(diff)/prevOut*100);
  if(diff<=0)el.innerHTML=`▼ Gastaste ${pct}% menos que el mes pasado <em>(${currency(prevOut)})</em>`;
  else el.innerHTML=`▲ Gastaste ${pct}% más que el mes pasado <em>(${currency(prevOut)})</em>`;
}

function renderMovements(){const q=($('#searchInput')?.value||'').toLowerCase(),type=$('#typeFilter')?.value||'';const rows=[...allMov()].filter(m=>!type||m.type===type).filter(m=>JSON.stringify(m).toLowerCase().includes(q)).sort((a,b)=>b.date.localeCompare(a.date));$('#allMovements').innerHTML=rows.map(movementRow).join('')||'<p class="muted">No encontramos movimientos con esos filtros.</p>';}

function spent(category){return monthMovements().filter(m=>m.type==='expense'&&m.category===category).reduce((a,m)=>a+m.amount,0);}
function renderBudgets(){
  const totalLimit=state.budgets.reduce((a,b)=>a+b.limit,0),totalSpent=state.budgets.reduce((a,b)=>a+spent(b.category),0);
  $('#budgetMessage').textContent=state.budgets.length?`Llevás ${currency(totalSpent)} de ${currency(totalLimit)} presupuestados.`:'Todavía no cargaste presupuestos.';
  $('#budgetList').innerHTML=state.budgets.map((b,i)=>{let s=spent(b.category),pct=Math.min(100,s/b.limit*100);return `<article class="budget-card"><div class="card-actions"><button class="mini-btn js-edit-budget" data-i="${i}">Editar</button><button class="mini-btn danger js-del-budget" data-i="${i}">Borrar</button></div><p class="eyebrow">${s>b.limit?'LÍMITE SUPERADO':'PRESUPUESTO MENSUAL'}</p><h2>${escapeHtml(b.category)}</h2><div class="row"><span>Gastado <strong>${currency(s)}</strong></span><span>de ${currency(b.limit)}</span></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${s>b.limit?'#e38878':catColors[i%catColors.length]}"></div></div><div class="row"><span>${Math.round(pct)}% usado</span><span>${currency(Math.max(0,b.limit-s))} disponible</span></div></article>`;}).join('')||'<p class="muted">Agregá un presupuesto para empezar.</p>';
}

function renderGoals(){
  $('#goalList').innerHTML=state.goals.map(g=>{const cur=g.currency||'ARS';let p=g.target?Math.min(100,g.saved/g.target*100):0;return `<article class="goal-card"><div class="card-actions"><button class="mini-btn js-edit-goal" data-id="${g.id}">Editar</button><button class="mini-btn danger js-del-goal" data-id="${g.id}">Borrar</button></div><div class="goal-icon">${g.icon}</div><h2>${escapeHtml(g.name)} ${cur==='USD'?'<span class="cur-chip">US$</span>':''}</h2>${g.place?`<p class="goal-place">📍 ${escapeHtml(g.place)}</p>`:''}<div class="row"><strong>${moneyCur(g.saved,cur)}</strong><span>de ${moneyCur(g.target,cur)}</span></div><div class="progress-track"><div class="progress-fill" style="width:${p}%;background:#a79ae5"></div></div><p class="remaining">Te faltan ${moneyCur(Math.max(0,g.target-g.saved),cur)} · ${Math.round(p)}% alcanzado</p><button class="outline-button contribute" data-id="${g.id}">＋ Registrar aporte</button></article>`;}).join('')||'<p class="muted">Creá un objetivo para darle un nombre a tu ahorro.</p>';
}

/* ---------- Gastos fijos ---------- */
function fixedStatus(f){
  const paid=f.lastPaid===curMonth;
  const due=Math.min(f.dueDay,daysInMonth(curMonth));
  const day=Number(today.slice(8,10));
  const diff=due-day; // días que faltan (negativo = vencido)
  return {paid,due,diff,overdue:!paid&&diff<0,soon:!paid&&diff>=0&&diff<=5};
}
function renderFixed(){
  $('#fixedList').innerHTML=state.fixed.map(f=>{
    const st=fixedStatus(f);
    let chip,chipClass;
    if(st.paid){chip='Pagado este mes';chipClass='ok';}
    else if(st.overdue){chip=`Vencido (día ${st.due})`;chipClass='danger';}
    else if(st.soon){chip=st.diff===0?'Vence hoy':`Vence en ${st.diff} día${st.diff===1?'':'s'}`;chipClass='warn';}
    else{chip=`Vence el día ${st.due}`;chipClass='';}
    return `<article class="budget-card fixed-card"><div class="card-actions"><button class="mini-btn js-edit-fixed" data-id="${f.id}">Editar</button><button class="mini-btn danger js-del-fixed" data-id="${f.id}">Borrar</button></div><p class="eyebrow">${escapeHtml(f.category)}${f.professional?' · PROFESIONAL':''}</p><h2>${escapeHtml(f.name)}</h2><div class="row"><span>Importe <strong>${currency(f.amount)}</strong></span><span>${escapeHtml(f.payment||'')}</span></div><span class="due-chip ${chipClass}">${chip}</span><button class="save-button js-pay-fixed" data-id="${f.id}" ${st.paid?'disabled':''}>${st.paid?'✓ Pagado':'Marcar como pagado'}</button></article>`;
  }).join('')||'<p class="muted">Agregá tus gastos fijos (alquiler, obra social, servicios…) y te aviso cuándo vencen.</p>';
  renderDueBanner();
}
function renderDueBanner(){
  const banner=$('#dueBanner');if(!banner)return;
  const pending=state.fixed.map(fixedStatus).filter(s=>!s.paid);
  const overdue=pending.filter(s=>s.overdue).length;
  const soon=pending.filter(s=>s.soon).length;
  if(overdue+soon===0){banner.hidden=true;return;}
  banner.hidden=false;
  if(overdue){$('#dueTitle').textContent=`Tenés ${overdue} pago${overdue===1?'':'s'} vencido${overdue===1?'':'s'}`;$('#dueMessage').textContent=soon?`Y ${soon} que vence${soon===1?'':'n'} pronto.`:'Tocá para revisarlos y marcarlos como pagados.';}
  else{$('#dueTitle').textContent=`${soon} vencimiento${soon===1?'':'s'} esta semana`;$('#dueMessage').textContent='Tocá para revisarlos y marcarlos como pagados.';}
}
function payFixed(id){
  const f=state.fixed.find(x=>x.id===id);if(!f||f.lastPaid===curMonth)return;
  const due=Math.min(f.dueDay,daysInMonth(curMonth));
  const date=`${curMonth}-${String(due).padStart(2,'0')}`;
  state.movements.push({id:Date.now(),type:'expense',amount:f.amount,description:f.name,category:f.category,payment:f.payment||state.payments[0],card:'',date,tags:(f.tags||[]).slice(),professional:!!f.professional});
  f.lastPaid=curMonth;
  persist();showToast(`"${f.name}" marcado como pagado`);
}

/* ---------- Reportes (datos reales) ---------- */
function renderReports(){
  const cats=categoryTotals();
  $('#professionalTotal').textContent=currency(monthMovements().filter(m=>m.type==='expense'&&m.professional).reduce((a,m)=>a+m.amount,0));
  $('#childTotal').textContent=currency(monthMovements().filter(m=>m.type==='expense'&&(m.tags||[]).map(x=>x.toLowerCase()).includes('hijo')).reduce((a,m)=>a+m.amount,0));
  $('#reportCategories').innerHTML=cats.slice(0,5).map(([n,v],i)=>`<div class="category-row"><i class="category-dot" style="background:${catColors[i%catColors.length]}"></i><div class="category-name"><b>${escapeHtml(n)}</b><span>${currency(v)}</span></div></div>`).join('')||'<p class="muted">Aún no hay gastos.</p>';

  // Barras reales: últimos 6 meses
  const months=[];for(let i=5;i>=0;i--)months.push(addMonths(curMonth,-i));
  const rows=months.map(m=>({m,inc:sumByType(monthMovements(m),'income'),out:sumByType(monthMovements(m),'expense')}));
  const max=Math.max(1,...rows.map(r=>Math.max(r.inc,r.out)));
  if(!allMov().length){$('#barChart').innerHTML='<p class="muted">Todavía no hay datos para comparar.</p>';return;}
  $('#barChart').innerHTML=rows.map(r=>`<div class="bar-group"><i class="bar income" style="height:${r.inc/max*100}%" title="Ingresos ${currency(r.inc)}"></i><i class="bar expense" style="height:${r.out/max*100}%" title="Gastos ${currency(r.out)}"></i><span class="bar-label">${MONTHS_SHORT[Number(r.m.slice(5,7))-1]}</span></div>`).join('');
}

/* ---------- Configuración: categorías y medios de pago ---------- */
function renderSettingsTags(){
  $('#categoryTags').innerHTML=state.categories.map(c=>`<button class="tag js-cat" data-name="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
  const pt=$('#paymentTags');if(pt)pt.innerHTML=state.payments.map(p=>`<button class="tag js-pay" data-name="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('');
  const bi=$('#bankInfo');if(bi)bi.textContent=state.saldoInicial!=null?('Saldo cargado: '+currency(state.saldoInicial)+' (al '+new Date(state.saldoFecha+'T12:00').toLocaleDateString('es-AR',{day:'numeric',month:'short',year:'numeric'})+'). Ahora en el banco: '+currency(bankBalance())):'Todavía no cargaste tu saldo. Tocá el botón para empezar.';
}

/* ---------- Formulario de movimiento ---------- */
function populatePayments(){const sel=$('#movementPayment');const prev=sel.value;sel.innerHTML=state.payments.map(p=>`<option>${escapeHtml(p)}</option>`).join('');if(prev&&state.payments.includes(prev))sel.value=prev;}
function setType(type){currentType=type;$$('.type-tab').forEach(b=>b.classList.toggle('active',b.dataset.type===type));let cats=type==='saving'?['Ahorro',...state.categories]:state.categories;$('#movementCategory').innerHTML=cats.map(c=>`<option>${escapeHtml(c)}</option>`).join('');}
function openMovement(m=null){if(!m||!m.id)m=null;editingId=m?.id??null;$('#movementForm').reset();populatePayments();if(m){setType(m.type);$('#movementAmount').value=m.amount;$('#movementDescription').value=m.description;$('#movementCategory').value=m.category;$('#movementPayment').value=m.payment;$('#movementDate').value=m.date;$('#movementCard').value=m.card||'';$('#movementTags').value=(m.tags||[]).join(', ');$('#movementProfessional').checked=m.professional;}else{setType('expense');$('#movementDate').value=today;}$('#movementDialog').showModal();setTimeout(()=>$('#movementAmount').focus(),50);}

$('#movementForm').addEventListener('submit',e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();const amount=Number($('#movementAmount').value);if(!amount)return;const data={id:editingId||Date.now(),type:currentType,amount,description:$('#movementDescription').value,category:$('#movementCategory').value,payment:$('#movementPayment').value,card:$('#movementCard').value,date:$('#movementDate').value||today,tags:$('#movementTags').value.split(',').map(s=>s.trim()).filter(Boolean),professional:$('#movementProfessional').checked};const index=state.movements.findIndex(m=>m.id===editingId);if(index>=0)state.movements[index]=data;else state.movements.push(data);$('#movementDialog').close();persist();showToast(index>=0?'Movimiento actualizado':'Movimiento guardado');});

/* ---------- Diálogo simple (alta/edición de todo lo demás) ---------- */
function fieldNumber(id,ph,val=''){return `<label>Importe<input id="${id}" type="number" min="1" inputmode="decimal" placeholder="${ph}" value="${val}" required></label>`;}
function openSimple(kind,ref=''){
  const f=$('#simpleFields');const form=$('#simpleForm');form.dataset.kind=kind;form.dataset.ref=ref;let delBtn='';
  if(kind==='budget'){
    $('#simpleEyebrow').textContent='PRESUPUESTO';$('#simpleTitle').textContent='Nueva categoría con tope';
    f.innerHTML='<label>Categoría<select id="simpleCategory"></select></label>'+fieldNumber('simpleAmount','Ej. 80000');
    $('#simpleCategory').innerHTML=state.categories.map(c=>`<option>${escapeHtml(c)}</option>`).join('');
  }else if(kind==='editBudget'){
    const b=state.budgets[Number(ref)];$('#simpleEyebrow').textContent='PRESUPUESTO';$('#simpleTitle').textContent='Editar tope';
    f.innerHTML=`<label>Categoría<input value="${escapeHtml(b.category)}" disabled></label>`+fieldNumber('simpleAmount','',b.limit);
  }else if(kind==='goal'||kind==='editGoal'){
    const g0=kind==='editGoal'?state.goals.find(x=>x.id===Number(ref)):null;
    $('#simpleEyebrow').textContent='OBJETIVO DE AHORRO';$('#simpleTitle').textContent=g0?'Editar objetivo':'Nuevo objetivo';
    f.innerHTML='<label>Nombre<input id="simpleName" placeholder="Ej. Dólares, Plazo fijo, Viaje" value="'+(g0?escapeHtml(g0.name):'')+'" required></label>'
      +'<div class="form-grid"><label>Moneda<select id="simpleCur"><option value="ARS">Pesos ($)</option><option value="USD">Dólares (US$)</option></select></label><label>Ícono<input id="simpleIcon" value="'+(g0?escapeHtml(g0.icon):'✦')+'" maxlength="2"></label></div>'
      +'<label>Meta <span style="font-weight:400">(a cuánto querés llegar)</span><input id="simpleAmount" type="number" min="0" placeholder="Ej. 5000" value="'+(g0?g0.target:'')+'"></label>'
      +'<label>¿Cuánto ya tenés ahorrado? <span style="font-weight:400">(no toca el banco)</span><input id="simpleSaved" type="number" min="0" placeholder="0" value="'+(g0?g0.saved:'')+'"></label>'
      +'<label>¿Dónde está? <span style="font-weight:400">(opcional)</span><input id="simplePlace" placeholder="Ej. IOL, PPI, Banco, Efectivo" value="'+(g0&&g0.place?escapeHtml(g0.place):'')+'"></label>';
    if(g0)$('#simpleCur').value=g0.currency||'ARS';
  }else if(kind==='category'){
    $('#simpleEyebrow').textContent='ORGANIZACIÓN';$('#simpleTitle').textContent='Nueva categoría';
    f.innerHTML='<label>Nombre de categoría<input id="simpleName" placeholder="Ej. Mascotas" required></label>';
  }else if(kind==='editCategory'){
    $('#simpleEyebrow').textContent='CATEGORÍA';$('#simpleTitle').textContent='Editar categoría';
    f.innerHTML=`<label>Nombre<input id="simpleName" value="${escapeHtml(ref)}" required></label>`;
    delBtn='<button type="button" class="delete-button js-delete">Borrar categoría</button>';
  }else if(kind==='payment'){
    $('#simpleEyebrow').textContent='MEDIOS DE PAGO';$('#simpleTitle').textContent='Nuevo medio de pago';
    f.innerHTML='<label>Nombre<input id="simpleName" placeholder="Ej. Naranja X" required></label>';
  }else if(kind==='editPayment'){
    $('#simpleEyebrow').textContent='MEDIO DE PAGO';$('#simpleTitle').textContent='Editar medio de pago';
    f.innerHTML=`<label>Nombre<input id="simpleName" value="${escapeHtml(ref)}" required></label>`;
    delBtn='<button type="button" class="delete-button js-delete">Borrar medio de pago</button>';
  }else if(kind==='fixed'||kind==='editFixed'){
    const f0=kind==='editFixed'?state.fixed.find(x=>x.id===Number(ref)):null;
    $('#simpleEyebrow').textContent='GASTO FIJO';$('#simpleTitle').textContent=f0?'Editar gasto fijo':'Nuevo gasto fijo';
    f.innerHTML=`<label>Nombre<input id="simpleName" placeholder="Ej. Alquiler" value="${f0?escapeHtml(f0.name):''}" required></label>`
      +fieldNumber('simpleAmount','Ej. 250000',f0?f0.amount:'')
      +`<div class="form-grid"><label>Categoría<select id="simpleCategory"></select></label><label>Día de vencimiento<input id="simpleDay" type="number" min="1" max="31" value="${f0?f0.dueDay:10}" required></label></div>`
      +`<label>Medio de pago<select id="simplePayment"></select></label>`
      +`<label class="check-label"><input id="simplePro" type="checkbox" ${f0&&f0.professional?'checked':''}> Es un gasto profesional</label>`;
    $('#simpleCategory').innerHTML=state.categories.map(c=>`<option ${f0&&f0.category===c?'selected':''}>${escapeHtml(c)}</option>`).join('');
    $('#simplePayment').innerHTML=state.payments.map(p=>`<option ${f0&&f0.payment===p?'selected':''}>${escapeHtml(p)}</option>`).join('');
  }else if(kind==='bank'){
    $('#simpleEyebrow').textContent='DINERO EN EL BANCO';$('#simpleTitle').textContent='¿Cuánto tenés hoy?';
    f.innerHTML=fieldNumber('simpleAmount','Lo que tenés hoy',state.saldoInicial!=null?state.saldoInicial:'')
      +`<label>A esta fecha<input id="simpleDate" type="date" value="${state.saldoFecha||today}"></label>`
      +`<p class="small" style="color:var(--muted);margin-top:10px">Poné lo que tenés hoy en el banco/efectivo. De acá en más, cada ingreso y gasto que cargues actualiza este número solo.</p>`;
  }else{ // aporte a objetivo (kind = id numérico)
    const goal=state.goals.find(g=>g.id===+kind);const gc=goal?(goal.currency||'ARS'):'ARS';$('#simpleEyebrow').textContent='APORTE A '+(goal?goal.name.toUpperCase():'');$('#simpleTitle').textContent='Registrar aporte'+(gc==='USD'?' (US$)':'');
    f.innerHTML=fieldNumber('simpleAmount',gc==='USD'?'¿Cuántos dólares sumás?':'¿Cuánto sumás?')+(gc==='USD'?'<p class="small" style="color:var(--muted);margin-top:8px">En dólares. No descuenta de tu "En el banco" (que está en pesos).</p>':'<p class="small" style="color:var(--muted);margin-top:8px">Sale de tu cuenta: descuenta de "En el banco".</p>');
  }
  f.insertAdjacentHTML('beforeend',delBtn);
  $('#simpleDialog').showModal();setTimeout(()=>f.querySelector('input,select')?.focus(),50);
}

function renameCategory(oldName,newName){if(!newName||oldName===newName)return;if(!state.categories.includes(newName))state.categories[state.categories.indexOf(oldName)]=newName;else state.categories=state.categories.filter(c=>c!==oldName);state.movements.forEach(m=>{if(m.category===oldName)m.category=newName;});state.budgets.forEach(b=>{if(b.category===oldName)b.category=newName;});state.fixed.forEach(fx=>{if(fx.category===oldName)fx.category=newName;});}
function deleteCategory(name){if(!state.categories.includes('Otros'))state.categories.push('Otros');state.categories=state.categories.filter(c=>c!==name);state.movements.forEach(m=>{if(m.category===name)m.category='Otros';});state.budgets=state.budgets.filter(b=>b.category!==name);state.fixed.forEach(fx=>{if(fx.category===name)fx.category='Otros';});}
function renamePayment(oldName,newName){if(!newName||oldName===newName)return;if(!state.payments.includes(newName))state.payments[state.payments.indexOf(oldName)]=newName;else state.payments=state.payments.filter(p=>p!==oldName);state.movements.forEach(m=>{if(m.payment===oldName)m.payment=newName;});state.fixed.forEach(fx=>{if(fx.payment===oldName)fx.payment=newName;});}
function deletePayment(name){if(state.payments.length<=1){showToast('Dejá al menos un medio de pago');return false;}const fallback=state.payments.find(p=>p!==name);state.payments=state.payments.filter(p=>p!==name);state.movements.forEach(m=>{if(m.payment===name)m.payment=fallback;});state.fixed.forEach(fx=>{if(fx.payment===name)fx.payment=fallback;});return true;}

$('#simpleForm').addEventListener('submit',e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();const kind=e.currentTarget.dataset.kind,ref=e.currentTarget.dataset.ref;
  if(kind==='budget'){const cat=$('#simpleCategory').value,limit=Number($('#simpleAmount').value);const i=state.budgets.findIndex(b=>b.category===cat);if(i>=0)state.budgets[i].limit=limit;else state.budgets.push({category:cat,limit});}
  else if(kind==='editBudget'){state.budgets[Number(ref)].limit=Number($('#simpleAmount').value);}
  else if(kind==='goal'){state.goals.push({id:Date.now(),name:$('#simpleName').value,target:Number($('#simpleAmount').value),saved:Number($('#simpleSaved').value)||0,icon:$('#simpleIcon').value||'✦',currency:$('#simpleCur').value,place:$('#simplePlace').value.trim()});}
  else if(kind==='editGoal'){const g=state.goals.find(x=>x.id===Number(ref));if(g){g.name=$('#simpleName').value;g.target=Number($('#simpleAmount').value);g.saved=Number($('#simpleSaved').value)||0;g.icon=$('#simpleIcon').value||'✦';g.currency=$('#simpleCur').value;g.place=$('#simplePlace').value.trim();}}
  else if(kind==='category'){let n=$('#simpleName').value.trim();if(n&&!state.categories.includes(n))state.categories.push(n);}
  else if(kind==='editCategory'){renameCategory(ref,$('#simpleName').value.trim());}
  else if(kind==='payment'){let n=$('#simpleName').value.trim();if(n&&!state.payments.includes(n))state.payments.push(n);}
  else if(kind==='editPayment'){renamePayment(ref,$('#simpleName').value.trim());}
  else if(kind==='fixed'||kind==='editFixed'){const data={name:$('#simpleName').value.trim(),amount:Number($('#simpleAmount').value),category:$('#simpleCategory').value,dueDay:Math.min(31,Math.max(1,Number($('#simpleDay').value)||1)),payment:$('#simplePayment').value,professional:$('#simplePro').checked};if(kind==='editFixed'){const fx=state.fixed.find(x=>x.id===Number(ref));Object.assign(fx,data);}else{state.fixed.push({id:Date.now(),lastPaid:null,tags:[],...data});}}
  else if(kind==='bank'){state.saldoInicial=Number($('#simpleAmount').value)||0;state.saldoFecha=$('#simpleDate').value||today;}
  else{let g=state.goals.find(g=>g.id===+kind),amount=Number($('#simpleAmount').value);if(g){g.saved+=amount;if((g.currency||'ARS')!=='USD')state.movements.push({id:Date.now(),type:'saving',amount,description:g.name,category:'Ahorro',payment:state.payments[0],date:today,tags:[],professional:false});}}
  $('#simpleDialog').close();persist();showToast('Guardado correctamente');
});

/* Borrar dentro del diálogo simple (categorías / medios de pago) */
$('#simpleFields').addEventListener('click',e=>{if(!e.target.classList.contains('js-delete'))return;const kind=$('#simpleForm').dataset.kind,ref=$('#simpleForm').dataset.ref;let ok=true;if(kind==='editCategory'){if(confirm(`¿Borrar la categoría "${ref}"? Los movimientos pasarán a "Otros".`))deleteCategory(ref);else ok=false;}else if(kind==='editPayment'){if(confirm(`¿Borrar el medio de pago "${ref}"?`))ok=deletePayment(ref);else ok=false;}if(ok){$('#simpleDialog').close();persist();showToast('Borrado');}});

/* ---------- Navegación ---------- */
function switchView(id){$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===id));window.scrollTo({top:0,behavior:'smooth'});}
$$('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$('#openQuickAdd').onclick=openMovement;$('#openQuickAdd2').onclick=openMovement;$('#mobileAdd').onclick=openMovement;
$('#addBudget').onclick=()=>openSimple('budget');$('#addGoal').onclick=()=>openSimple('goal');$('#addCategory').onclick=()=>openSimple('category');
$('#addPayment')?.addEventListener('click',()=>openSimple('payment'));
$('#setBank')?.addEventListener('click',()=>openSimple('bank'));
$('#addBulkCats')?.addEventListener('click',()=>{const txt=$('#bulkCats').value||'';const names=txt.split(/\n/).map(l=>l.split(/\t|\s{2,}/)[0].trim()).filter(n=>n&&!/^(extras?|fijo|variable)$/i.test(n));let added=0;names.forEach(n=>{if(!state.categories.includes(n)){state.categories.push(n);added++;}});$('#bulkCats').value='';if(added){persist();showToast('Agregué '+added+' categoría'+(added===1?'':'s'));}else showToast('No había categorías nuevas para agregar');});
$('#addFixed')?.addEventListener('click',()=>openSimple('fixed'));
$$('.type-tab').forEach(b=>b.onclick=()=>setType(b.dataset.type));
$('#monthPrev')&&($('#monthPrev').onclick=()=>{viewMonth=addMonths(viewMonth,-1);render();});
$('#monthNext')&&($('#monthNext').onclick=()=>{if(viewMonth<curMonth){viewMonth=addMonths(viewMonth,1);render();}});
$('#monthButton')&&($('#monthButton').onclick=()=>{viewMonth=curMonth;render();});
$('#searchInput').oninput=renderMovements;$('#typeFilter').onchange=renderMovements;

/* Delegación de clics para botones dinámicos */
document.addEventListener('click',e=>{
  const t=e.target;
  const edit=t.closest('.edit-movement');if(edit){openMovement(state.movements.find(m=>m.id===+edit.dataset.id));return;}
  const contribute=t.closest('.contribute');if(contribute){openSimple(contribute.dataset.id);return;}
  if(t.classList.contains('js-cat')){openSimple('editCategory',t.dataset.name);return;}
  if(t.classList.contains('js-pay')){openSimple('editPayment',t.dataset.name);return;}
  if(t.classList.contains('js-edit-budget')){openSimple('editBudget',t.dataset.i);return;}
  if(t.classList.contains('js-del-budget')){if(confirm('¿Borrar este presupuesto?')){state.budgets.splice(Number(t.dataset.i),1);persist();showToast('Presupuesto borrado');}return;}
  if(t.classList.contains('js-edit-goal')){openSimple('editGoal',t.dataset.id);return;}
  if(t.classList.contains('js-del-goal')){if(confirm('¿Borrar este objetivo de ahorro?')){state.goals=state.goals.filter(g=>g.id!==+t.dataset.id);persist();showToast('Objetivo borrado');}return;}
  if(t.classList.contains('js-edit-fixed')){openSimple('editFixed',t.dataset.id);return;}
  if(t.classList.contains('js-del-fixed')){if(confirm('¿Borrar este gasto fijo?')){state.fixed=state.fixed.filter(f=>f.id!==+t.dataset.id);persist();showToast('Gasto fijo borrado');}return;}
  if(t.classList.contains('js-pay-fixed')){payFixed(+t.dataset.id);return;}
});

/* ---------- Tema, visibilidad, toast ---------- */
function showToast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400);}
$('#themeToggle').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('claro-dark',document.body.classList.contains('dark'));$('#themeToggle').innerHTML=document.body.classList.contains('dark')?'☀ <span>Modo claro</span>':'☾ <span>Modo oscuro</span>';};
if(localStorage.getItem('claro-dark')==='true')$('#themeToggle').click();
$('#visibility').onclick=()=>{let hidden=$('#balance').dataset.hidden==='1';$('#balance').dataset.hidden=hidden?'':'1';$('#balance').textContent=hidden?currency(state.saldoInicial!=null?bankBalance():monthBalance()):'••••••';};

/* ---------- Exportar / respaldo ---------- */
function download(content,name,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href);}
$('#exportCsv').onclick=()=>{let h=['Fecha','Tipo','Importe','Descripción','Categoría','Medio de pago','Etiquetas','Profesional'];let rows=state.movements.map(m=>[m.date,m.type,m.amount,m.description,m.category,m.payment,(m.tags||[]).join('|'),m.professional?'Sí':'No']);download('﻿'+[h,...rows].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\n'),'claro-movimientos.csv','text/csv;charset=utf-8');};
$('#backupData').onclick=()=>download(JSON.stringify(state,null,2),'claro-respaldo.json','application/json');
$('#restoreData').onchange=e=>{const file=e.target.files[0];if(!file)return;const r=new FileReader();r.onload=()=>{try{const data=JSON.parse(r.result);state=data;state.payments=state.payments||seed.payments.slice();state.fixed=state.fixed||[];state.categories=state.categories||seed.categories.slice();state.budgets=state.budgets||[];state.goals=state.goals||[];state.movements=state.movements||[];persist();showToast('Copia restaurada');}catch{showToast('El archivo no es válido');}};r.readAsText(file);};

/* ---------- Importar ingresos desde la app de Facturación ---------- */
function importFacturacion(data,opts){
  const bySrc={};state.movements.forEach(m=>{if(m.srcId)bySrc[m.srcId]=m;});
  let added=0,updated=0;
  const upsert=(srcId,mv)=>{const ex=bySrc[srcId];if(ex){if(ex.amount!==mv.amount||ex.date!==mv.date||ex.description!==mv.description){Object.assign(ex,mv,{id:ex.id,srcId});updated++;}}else{const nuevo={id:Date.now()+Math.floor(Math.random()*100000),srcId,...mv};state.movements.push(nuevo);bySrc[srcId]=nuevo;added++;}};
  if(opts.facturas&&Array.isArray(data.facturas)){
    data.facturas.filter(f=>f.cobrado&&Number(f.cobradoMonto)>0).forEach(f=>{
      upsert('fact:'+f.id,{type:'income',amount:Number(f.cobradoMonto),description:'Cobro '+(f.pagador||'Obra social')+(f.nro?(' · Fact '+f.nro):''),category:'Profesional',payment:'Transferencia',date:f.fecha,tags:['Obra social','Facturación'],professional:false});
    });
  }
  if(opts.ingresos&&Array.isArray(data.ingresos)){
    data.ingresos.forEach(i=>{if(!Number(i.monto))return;
      upsert('ing:'+i.id,{type:'income',amount:Number(i.monto),description:i.concepto||i.categoria||'Ingreso',category:'Profesional',payment:'Transferencia',date:i.fecha,tags:[i.categoria,'Facturación'].filter(Boolean),professional:false});
    });
  }
  return {added,updated};
}
$('#importFact')?.addEventListener('change',e=>{const file=e.target.files[0];if(!file)return;const opts={facturas:$('#impFacturas')?.checked,ingresos:$('#impIngresos')?.checked};if(!opts.facturas&&!opts.ingresos){showToast('Elegí al menos una opción');e.target.value='';return;}const r=new FileReader();r.onload=()=>{try{const data=JSON.parse(r.result);const res=importFacturacion(data,opts);persist();const msg=`Importado: ${res.added} nuevos, ${res.updated} actualizados`;const info=$('#importInfo');if(info)info.textContent=msg;showToast(msg);}catch(err){showToast('El archivo no es válido');}finally{e.target.value='';}};r.readAsText(file);});

/* ---------- Sincronización con Supabase (nube) ---------- */
const SB_CFG=window.CLARO_SUPABASE;
let sb=null,cloudReady=false,applyingRemote=false,pushTimer=null;
function normalizeState(){state.categories=state.categories||seed.categories.slice();state.payments=state.payments&&state.payments.length?state.payments:seed.payments.slice();state.cards=state.cards||seed.cards.slice();state.movements=state.movements||[];state.budgets=state.budgets||[];state.goals=state.goals||[];state.fixed=state.fixed||[];if(typeof state.saldoInicial==='undefined')state.saldoInicial=null;state.saldoFecha=state.saldoFecha||today;}
function showAuth(){const o=$('#authOverlay');if(o)o.hidden=false;}
function hideAuth(){const o=$('#authOverlay');if(o)o.hidden=true;}
function updateSyncUI(ok,msg,email){const s=$('#syncStatus');if(s)s.innerHTML=ok?'<i></i> Sincronizado en la nube ✓':'<i class="off"></i> '+(msg||'Guardado solo en esta compu');const u=$('#syncUser');if(u)u.textContent=ok&&email?('Conectada como '+email):(ok?'':'Entrá para sincronizar entre tus dispositivos.');const lo=$('#logoutBtn');if(lo)lo.hidden=!ok;const li=$('#loginBtn');if(li)li.hidden=ok;}
function initCloud(){
  if(!SB_CFG||!window.supabase){updateSyncUI(false,'Sin conexión a la nube');return;}
  sb=window.supabase.createClient(SB_CFG.url,SB_CFG.anonKey);
  showAuth();
  sb.auth.getSession().then(({data})=>{if(data&&data.session)onLogin(data.session);});
  sb.auth.onAuthStateChange((_e,session)=>{if(session&&!cloudReady)onLogin(session);});
}
let loginStarted=false;
async function onLogin(session){if(loginStarted)return;loginStarted=true;hideAuth();await cloudPull();await pullFacturacion();cloudReady=true;updateSyncUI(true,null,session?.user?.email);}
async function pullFacturacion(){if(!sb)return;const {data,error}=await sb.from('fin_app_state').select('data').eq('app','facturacion').maybeSingle();if(error){console.warn('pullFact',error);return;}extraIncome=deriveFactIncome(data&&data.data);render();}
async function cloudPull(){
  if(!sb)return;
  const {data,error}=await sb.from('fin_app_state').select('data').eq('app',SB_CFG.app).maybeSingle();
  if(error){console.warn('pull',error);return;}
  if(data&&data.data&&Object.keys(data.data).length){applyingRemote=true;state=data.data;normalizeState();localStorage.setItem('claro-data-gisela',JSON.stringify(state));render();applyingRemote=false;}
  else{await cloudPush(true);}
}
async function cloudPush(force){
  if(!sb||applyingRemote||(!cloudReady&&!force))return;
  const {error}=await sb.from('fin_app_state').upsert({app:SB_CFG.app,data:state,updated_at:new Date().toISOString()});
  if(error){console.warn('push',error);updateSyncUI(false,'No se pudo guardar en la nube');}
  else if(cloudReady||force){const s=$('#syncStatus');if(s)s.innerHTML='<i></i> Sincronizado en la nube ✓';}
}
function authMsg(error){const m=(error&&error.message||'').toLowerCase();if(m.includes('invalid login'))return 'Mail o contraseña incorrectos. Fijate mayúsculas o espacios.';if(m.includes('email not confirmed'))return 'Tu email todavía no está confirmado. Revisá tu correo (y spam).';if(m.includes('failed to fetch')||m.includes('network'))return 'Sin conexión a internet. Probá de nuevo.';return 'No se pudo entrar: '+(error&&error.message||'error desconocido');}
$('#authForm')?.addEventListener('submit',async e=>{e.preventDefault();if(!sb){$('#authError').textContent='La nube no cargó. Revisá tu internet y recargá.';$('#authError').hidden=false;return;}const email=$('#authEmail').value.trim(),password=$('#authPassword').value,err=$('#authError'),btn=$('#authSubmit');err.hidden=true;btn.disabled=true;btn.textContent='Ingresando…';const {data,error}=await sb.auth.signInWithPassword({email,password});btn.disabled=false;btn.textContent='Ingresar';if(error){console.warn('login error',error);err.textContent=authMsg(error);err.hidden=false;}else if(data&&data.session){onLogin(data.session);}});
$('#authForgot')?.addEventListener('click',async()=>{const email=$('#authEmail').value.trim(),err=$('#authError');if(!email){err.textContent='Escribí tu mail arriba y volvé a tocar el enlace.';err.hidden=false;return;}if(!sb)return;const {error}=await sb.auth.resetPasswordForEmail(email);err.style.color='';err.hidden=false;err.textContent=error?('No se pudo enviar: '+error.message):('Te enviamos un mail a '+email+' para crear una contraseña nueva. Revisá tu correo (y spam).');});
$('#authOffline')?.addEventListener('click',()=>{hideAuth();updateSyncUI(false,'Trabajando sin conexión (solo esta compu)');});
$('#loginBtn')?.addEventListener('click',()=>showAuth());
$('#logoutBtn')?.addEventListener('click',async()=>{if(sb)await sb.auth.signOut();cloudReady=false;updateSyncUI(false,'Sesión cerrada');showAuth();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&cloudReady){cloudPull();pullFacturacion();}});
window.addEventListener('focus',()=>{if(cloudReady){cloudPull();pullFacturacion();}});

/* ---------- Arranque ---------- */
$('#dateLabel').textContent=new Date().toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'});
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
render();
initCloud();
