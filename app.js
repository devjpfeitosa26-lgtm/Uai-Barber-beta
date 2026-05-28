cat > /home/claude/uaibarber/app.js << 'JSEOF'
/* ── UaiBarber app.js v2 ── */
const SUPABASE_URL  = 'https://quzfhkuiduvukuxcmfoq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1emZoa3VpZHV2dWt1eGNtZm9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MDk3OTAsImV4cCI6MjA5NTQ4NTc5MH0.ztjj-YfMwJgbh606RisxEDW2NzMbfrCMOzzC50qaT3M';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* ────── STATE ────── */
const state = {
  user: null,
  profissional: null,
  servicos: [],
  agendamentos: [],
  agendamentosAll: [],
  currentDate: new Date(),
  filterStatus: 'todos',
  activeView: 'agenda',
  realtimeChannel: null,
  alertTarget: null, // { id, nome, whatsapp, servico, horario }
};

/* ────── HELPERS ────── */
const $ = id => document.getElementById(id);
const fmt = {
  brl:       v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0)),
  time:      d => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(d)),
  date:      d => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d),
  dateShort: d => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d),
  isoDate:   d => d.toISOString().slice(0, 10),
  dtBR:      d => new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(d)),
};

function setFb(id, msg, type = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'feedback ' + type;
}

function isToday(date) {
  const t = new Date();
  return date.getDate()===t.getDate() && date.getMonth()===t.getMonth() && date.getFullYear()===t.getFullYear();
}

/* ────── SUBSCRIPTION (mock – substitute with real table when available) ────── */
function loadSubscription() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end   = new Date(today.getFullYear(), today.getMonth()+1, 0);
  const daysTotal = (end - start) / 86400000;
  const daysLeft  = Math.ceil((end - today) / 86400000);
  const pct = Math.round((1 - daysLeft/daysTotal) * 100);

  const dot = $('sub-dot'), titleMini = $('sub-title-mini'),
        detailMini = $('sub-detail-mini'), barMini = $('sub-bar-mini');
  if (daysLeft <= 5)       { dot.className='sub-dot danger';  titleMini.textContent='Expira em breve!'; }
  else if (daysLeft <= 10) { dot.className='sub-dot warning'; titleMini.textContent='Expirando em breve'; }
  else                     { dot.className='sub-dot';         titleMini.textContent='Plano Pro Ativo'; }
  detailMini.textContent = daysLeft + ' dias restantes';
  barMini.style.width = Math.max(5, 100-pct) + '%';

  $('sub-plan-name').textContent = 'Pro Mensal';
  $('sub-expiry').textContent    = fmt.dateShort(end);
  $('sub-days-left').textContent = daysLeft + ' dias';
  $('sub-period-start').textContent = fmt.dateShort(start);
  $('sub-period-end').textContent   = fmt.dateShort(end);
  $('sub-big-bar').style.width = Math.max(5, 100-pct) + '%';

  const badge = $('sub-status-badge'), statusText = $('sub-status-text');
  if      (daysLeft <= 0)  { badge.className='sub-status-badge vencido';   statusText.textContent='Vencida'; $('sub-big-bar').style.background='var(--danger)'; }
  else if (daysLeft <= 5)  { badge.className='sub-status-badge expirando'; statusText.textContent='Expirando'; $('sub-big-bar').style.background='var(--warning)'; }
  else                     { badge.className='sub-status-badge ativo';     statusText.textContent='Ativo'; }
}

/* ────── PROFISSIONAL ────── */
async function loadProfissional() {
  // Try to load; if not found, upsert from auth metadata (fixes FK for users
  // who existed before the trigger was created)
  let { data, error } = await sb
    .from('profissionais')
    .select('id, nome')
    .eq('id', state.user.id)
    .single();

  if (error || !data) {
    // Row missing — create it now so inserts on servicos/agendamentos work
    const emailPrefix = (state.user.email || '').split('@')[0];
    const nome = state.user.user_metadata?.nome || state.user.user_metadata?.full_name || emailPrefix || 'Profissional';
    const upsertResult = await sb
      .from('profissionais')
      .upsert({ id: state.user.id, nome }, { onConflict: 'id' })
      .select('id, nome')
      .single();
    if (upsertResult.error) throw new Error('Não foi possível criar o perfil: ' + upsertResult.error.message);
    data = upsertResult.data;
  }

  state.profissional = data;
  const initial = (data.nome || '?').trim().charAt(0).toUpperCase();
  $('user-avatar').textContent = initial;
  $('user-name-sidebar').textContent = data.nome;
}

/* ────── SERVIÇOS ────── */
async function loadServicos() {
  // Guard: only run if profissional is loaded
  if (!state.profissional) await loadProfissional();

  const { data, error } = await sb
    .from('servicos')
    .select('id, nome, preco, duracao_minutos')
    .eq('prof_id', state.profissional.id)
    .order('nome');
  if (error) throw new Error('Erro ao carregar serviços: ' + error.message);
  state.servicos = data || [];
  renderServicesGrid();
  renderServiceSelect();
}

function renderServiceSelect() {
  const sel = $('m-servico');
  if (!state.servicos.length) {
    sel.innerHTML = '<option value="">Nenhum serviço cadastrado</option>';
    sel.disabled = true; return;
  }
  sel.disabled = false;
  sel.innerHTML = state.servicos.map(s =>
    `<option value="${s.id}">${s.nome} • ${fmt.brl(s.preco)} • ${s.duracao_minutos}min</option>`
  ).join('');
}

function renderServicesGrid() {
  const grid = $('services-grid');
  if (!state.servicos.length) {
    grid.innerHTML = `
      <button class="btn-add-service" id="btn-add-first-service">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar primeiro serviço
      </button>`;
    $('btn-add-first-service')?.addEventListener('click', openServiceModal);
    return;
  }
  grid.innerHTML = state.servicos.map(s => `
    <div class="service-card">
      <div class="service-name">${s.nome}</div>
      <div class="service-price">${fmt.brl(s.preco)}</div>
      <div class="service-duration">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${s.duracao_minutos} minutos
      </div>
      <div class="service-actions">
        <button class="btn-sm btn-sm-danger" data-delete-service="${s.id}">Remover</button>
      </div>
    </div>
  `).join('') + `
    <button class="btn-add-service" id="btn-add-extra-service">
      <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Novo serviço
    </button>`;
  $('btn-add-extra-service')?.addEventListener('click', openServiceModal);
  grid.querySelectorAll('[data-delete-service]').forEach(btn => {
    btn.addEventListener('click', () => deleteService(btn.dataset.deleteService));
  });
}

async function saveService() {
  const nome    = $('s-nome').value.trim();
  const preco   = parseFloat($('s-preco').value);
  const duracao = parseInt($('s-duracao').value, 10);
  if (!nome || isNaN(preco) || isNaN(duracao) || duracao < 1) {
    setFb('s-feedback', 'Preencha todos os campos corretamente.', 'error'); return;
  }
  $('save-service-btn').disabled = true;
  setFb('s-feedback', 'Salvando...');
  // Use profissional.id (guaranteed to exist after loadProfissional upsert)
  const { error } = await sb.from('servicos').insert({
    prof_id: state.profissional.id,
    nome,
    preco,
    duracao_minutos: duracao,
  });
  if (error) {
    setFb('s-feedback', 'Erro: ' + error.message, 'error');
    $('save-service-btn').disabled = false; return;
  }
  setFb('s-feedback', 'Serviço criado!', 'success');
  await loadServicos();
  setTimeout(closeServiceModal, 600);
  $('save-service-btn').disabled = false;
}

async function deleteService(id) {
  if (!confirm('Remover este serviço?\nAgendamentos existentes não serão afetados.')) return;
  const { error } = await sb.from('servicos').delete().eq('id', id);
  if (error) { alert('Erro ao remover: ' + error.message); return; }
  await loadServicos();
}

/* ────── AGENDAMENTOS ────── */
async function loadAgenda(date) {
  const start = new Date(date); start.setHours(0,0,0,0);
  const end   = new Date(date); end.setHours(23,59,59,999);
  const { data, error } = await sb
    .from('agendamentos')
    .select('id, nome_cliente, whatsapp_cliente, horario_inicio, status, servico_id, servicos(nome, preco, duracao_minutos)')
    .eq('prof_id', state.profissional.id)
    .gte('horario_inicio', start.toISOString())
    .lte('horario_inicio', end.toISOString())
    .order('horario_inicio', { ascending: true });
  if (error) throw new Error(error.message);
  state.agendamentos = data || [];
  renderTimeline();
  renderDaySummary();
  updateBadge();
}

async function loadMonthAgenda() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59);
  const { data } = await sb
    .from('agendamentos')
    .select('id, nome_cliente, horario_inicio, status, servicos(nome, preco)')
    .eq('prof_id', state.profissional.id)
    .gte('horario_inicio', start.toISOString())
    .lte('horario_inicio', end.toISOString())
    .order('horario_inicio', { ascending: false });
  state.agendamentosAll = data || [];
  renderOverview();
}

function renderTimeline() {
  const tl = $('timeline');
  const filtered = state.agendamentos.filter(a =>
    state.filterStatus === 'todos' || a.status === state.filterStatus
  );
  $('agenda-count').textContent = `${filtered.length} agendamento${filtered.length !== 1 ? 's' : ''}`;
  if (!filtered.length) {
    tl.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>${state.filterStatus !== 'todos'
          ? 'Nenhum agendamento com esse filtro.'
          : isToday(state.currentDate)
            ? 'Nenhum agendamento hoje. Use <strong>Novo agendamento</strong> para criar um.'
            : 'Nenhum agendamento nesse dia.'}</p>
      </div>`; return;
  }
  tl.innerHTML = filtered.map(item => {
    const endTime = item.servicos?.duracao_minutos
      ? new Date(new Date(item.horario_inicio).getTime() + item.servicos.duracao_minutos * 60000) : null;
    const active = ['pendente','confirmado'].includes(item.status);
    return `
    <div class="appt-card" data-id="${item.id}">
      <div>
        <div class="appt-time">${fmt.time(item.horario_inicio)}</div>
        ${endTime ? `<div class="appt-time-end">até ${fmt.time(endTime)}</div>` : ''}
      </div>
      <div>
        <div class="appt-client">${item.nome_cliente}</div>
        <div class="appt-service">${item.servicos?.nome || 'Serviço'}</div>
        ${item.whatsapp_cliente ? `<div class="appt-phone">📱 ${item.whatsapp_cliente}</div>` : ''}
      </div>
      <div class="appt-right">
        <div class="appt-price">${item.servicos?.preco ? fmt.brl(item.servicos.preco) : '–'}</div>
        <span class="pill pill-${item.status}">${item.status}</span>
        <div class="appt-actions">
          <button class="btn-icon alert-btn" data-action="alert" data-id="${item.id}" title="Enviar alerta WhatsApp">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          </button>
          ${active ? `
          <button class="btn-icon complete" data-action="complete" data-id="${item.id}" title="Concluído">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="btn-icon cancel" data-action="cancel" data-id="${item.id}" title="Cancelar">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  tl.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const item = state.agendamentos.find(a => a.id === id);
      if (btn.dataset.action === 'complete') updateApptStatus(id, 'concluido');
      if (btn.dataset.action === 'cancel')   updateApptStatus(id, 'cancelado');
      if (btn.dataset.action === 'alert' && item) openAlertModal(item);
    });
  });
}

function renderDaySummary() {
  const active = state.agendamentos.filter(a => a.status !== 'cancelado');
  const fat = active.reduce((acc, a) => acc + Number(a.servicos?.preco || 0), 0);
  $('side-faturamento').textContent = fmt.brl(fat);
  $('side-faturamento-sub').textContent = `${active.length} atendimento${active.length !== 1 ? 's' : ''}`;
  const counts = { confirmado:0, pendente:0, concluido:0, cancelado:0 };
  state.agendamentos.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++; });
  $('day-summary').innerHTML = [
    { label:'Confirmados', key:'confirmado', color:'var(--success)' },
    { label:'Pendentes',   key:'pendente',   color:'var(--warning)' },
    { label:'Concluídos',  key:'concluido',  color:'var(--info)' },
    { label:'Cancelados',  key:'cancelado',  color:'var(--danger)' },
  ].map(r => `<div class="slot-row"><span class="slot-time">${r.label}</span><span style="font-size:14px;font-weight:700;color:${r.color}">${counts[r.key]}</span></div>`).join('');
}

function renderOverview() {
  const today = new Date();
  const ts = new Date(today); ts.setHours(0,0,0,0);
  const te = new Date(today); te.setHours(23,59,59,999);
  const todayItems = state.agendamentosAll.filter(a => {
    const d = new Date(a.horario_inicio);
    return d>=ts && d<=te && a.status!=='cancelado';
  });
  const fat = todayItems.reduce((acc,a) => acc + Number(a.servicos?.preco||0), 0);
  $('ov-fat-dia').textContent  = fmt.brl(fat);
  $('ov-fat-sub').textContent  = `${todayItems.length} atendimento${todayItems.length!==1?'s':''}`;
  $('ov-clientes').textContent = todayItems.length;
  $('ov-mes').textContent      = state.agendamentosAll.filter(a => a.status!=='cancelado').length;

  const future = state.agendamentosAll
    .filter(a => new Date(a.horario_inicio) > new Date() && ['confirmado','pendente'].includes(a.status))
    .sort((a,b) => new Date(a.horario_inicio)-new Date(b.horario_inicio));
  $('ov-proximo').textContent     = future.length ? fmt.time(future[0].horario_inicio) : '–';
  $('ov-proximo-sub').textContent = future.length ? future[0].nome_cliente : 'sem próximos';

  const list = $('ov-recent-list');
  if (!state.agendamentosAll.length) {
    list.innerHTML = '<div class="empty-state" style="padding:24px"><p>Nenhum agendamento no mês.</p></div>'; return;
  }
  list.innerHTML = state.agendamentosAll.slice(0, 8).map(a => `
    <div class="appt-card" style="margin-bottom:6px">
      <div>
        <div class="appt-time" style="font-size:15px">${fmt.time(a.horario_inicio)}</div>
        <div class="appt-time-end">${fmt.dateShort(new Date(a.horario_inicio))}</div>
      </div>
      <div>
        <div class="appt-client">${a.nome_cliente}</div>
        <div class="appt-service">${a.servicos?.nome||'Serviço'}</div>
      </div>
      <div class="appt-right">
        <div class="appt-price">${a.servicos?.preco ? fmt.brl(a.servicos.preco) : '–'}</div>
        <span class="pill pill-${a.status}">${a.status}</span>
      </div>
    </div>`).join('');
}

async function updateApptStatus(id, status) {
  await sb.from('agendamentos').update({ status }).eq('id', id);
  await loadAgenda(state.currentDate);
  if (state.activeView === 'overview') await loadMonthAgenda();
}

async function saveAppointment() {
  const nome     = $('m-nome').value.trim();
  const whatsapp = $('m-whatsapp').value.trim();
  const servId   = $('m-servico').value;
  const data     = $('m-data').value;
  const hora     = $('m-hora').value;
  if (!nome || !whatsapp || !servId || !data || !hora) {
    setFb('m-feedback', 'Preencha todos os campos.', 'error'); return;
  }
  $('save-appt-btn').disabled = true;
  setFb('m-feedback', 'Verificando...');
  const horario_inicio = new Date(`${data}T${hora}:00`).toISOString();
  const { data: conflict } = await sb
    .from('agendamentos').select('id')
    .eq('prof_id', state.profissional.id)
    .eq('horario_inicio', horario_inicio)
    .in('status', ['pendente','confirmado']).limit(1);
  if (conflict?.length) {
    setFb('m-feedback', 'Já existe um agendamento neste horário.', 'error');
    $('save-appt-btn').disabled = false; return;
  }
  const { error } = await sb.from('agendamentos').insert({
    prof_id: state.profissional.id,
    servico_id: servId,
    nome_cliente: nome,
    whatsapp_cliente: whatsapp,
    horario_inicio,
    status: 'confirmado',
  });
  if (error) {
    setFb('m-feedback', 'Erro: ' + error.message, 'error');
    $('save-appt-btn').disabled = false; return;
  }
  setFb('m-feedback', 'Agendamento salvo!', 'success');
  state.currentDate = new Date(`${data}T${hora}:00`);
  updateDateLabel();
  await loadAgenda(state.currentDate);
  setTimeout(closeApptModal, 500);
  $('save-appt-btn').disabled = false;
}

/* ══════════════════════════════════════
   WHATSAPP ALERT SYSTEM
   ══════════════════════════════════════ */
const WA_TEMPLATES = [
  {
    id: 'confirmacao',
    label: 'Confirmação de horário',
    icon: '✅',
    color: '#22c55e',
    build: (d) =>
      `Olá, ${d.nome}! 👋 Passando para *confirmar* seu agendamento:\n\n` +
      `✂️ Serviço: *${d.servico}*\n` +
      `📅 Data/Hora: *${d.horario}*\n` +
      `📍 ${d.barbearia}\n\n` +
      `Por favor, confirme sua presença respondendo *SIM*. 😊`,
  },
  {
    id: 'lembrete',
    label: 'Lembrete de horário',
    icon: '⏰',
    color: '#3b82f6',
    build: (d) =>
      `Olá, ${d.nome}! ⏰ Lembrando do seu horário:\n\n` +
      `✂️ Serviço: *${d.servico}*\n` +
      `🕐 Horário: *${d.horario}*\n\n` +
      `Te esperamos! 💈`,
  },
  {
    id: 'cancelamento',
    label: 'Aviso de cancelamento',
    icon: '❌',
    color: '#ef4444',
    build: (d) =>
      `Olá, ${d.nome}. Infelizmente precisamos *cancelar* seu agendamento:\n\n` +
      `✂️ Serviço: *${d.servico}*\n` +
      `📅 Data/Hora: *${d.horario}*\n\n` +
      `Pedimos desculpas pelo inconveniente. Entre em contato para *remarcar*. 🙏`,
  },
  {
    id: 'remarcacao',
    label: 'Solicitar remarcação',
    icon: '🔄',
    color: '#f59e0b',
    build: (d) =>
      `Olá, ${d.nome}! Gostaríamos de *remarcar* seu horário:\n\n` +
      `✂️ Serviço: *${d.servico}*\n` +
      `📅 Horário anterior: *${d.horario}*\n\n` +
      `Por favor, responda com sua *nova disponibilidade* para reagendarmos. 📅`,
  },
  {
    id: 'personalizada',
    label: 'Mensagem personalizada',
    icon: '✏️',
    color: '#8b5cf6',
    build: () => '',
  },
];

function openAlertModal(item) {
  state.alertTarget = {
    id:       item.id,
    nome:     item.nome_cliente,
    whatsapp: (item.whatsapp_cliente || '').replace(/\D/g, ''),
    servico:  item.servicos?.nome || 'Serviço',
    horario:  fmt.dtBR(item.horario_inicio),
    barbearia: state.profissional?.nome || 'nossa barbearia',
  };

  // Render template buttons
  const grid = $('alert-template-grid');
  grid.innerHTML = WA_TEMPLATES.map(t => `
    <button class="tpl-btn" data-tpl="${t.id}" style="--tpl-color:${t.color}">
      <span class="tpl-icon">${t.icon}</span>
      <span class="tpl-label">${t.label}</span>
    </button>`).join('');

  // Set phone
  $('alert-phone').value = state.alertTarget.whatsapp;

  // Clear preview
  $('alert-preview').value = '';
  $('alert-preview').placeholder = 'Selecione um modelo acima para pré-visualizar a mensagem...';
  $('btn-send-alert').disabled = true;
  setFb('alert-feedback', '');

  // Bind template clicks
  grid.querySelectorAll('.tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.tpl-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const tpl = WA_TEMPLATES.find(t => t.id === btn.dataset.tpl);
      const msg = tpl.build(state.alertTarget);
      $('alert-preview').value = msg;
      $('alert-preview').placeholder = '';
      $('btn-send-alert').disabled = false;
      // Personalizada: focus textarea
      if (btn.dataset.tpl === 'personalizada') {
        $('alert-preview').focus();
        $('alert-preview').placeholder = 'Digite sua mensagem personalizada aqui...';
      }
    });
  });

  $('modal-alert').classList.add('open');
}

function closeAlertModal() {
  $('modal-alert').classList.remove('open');
  state.alertTarget = null;
}

function sendWhatsAppAlert() {
  const phone = $('alert-phone').value.replace(/\D/g,'');
  const msg   = $('alert-preview').value.trim();
  if (!phone || phone.length < 10) {
    setFb('alert-feedback', 'Número de WhatsApp inválido.', 'error'); return;
  }
  if (!msg) {
    setFb('alert-feedback', 'Selecione ou escreva uma mensagem.', 'error'); return;
  }
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
  setFb('alert-feedback', 'WhatsApp aberto! Envie a mensagem no app. ✅', 'success');
  setTimeout(closeAlertModal, 1800);
}

/* ────── DATE NAV ────── */
function updateDateLabel() {
  $('current-date-label').textContent = isToday(state.currentDate)
    ? 'Hoje, ' + fmt.date(state.currentDate)
    : fmt.date(state.currentDate);
  $('topbar-sub').textContent = isToday(state.currentDate)
    ? 'Seus agendamentos de hoje'
    : `Agendamentos de ${fmt.dateShort(state.currentDate)}`;
}
function changeDate(offset) {
  state.currentDate = new Date(state.currentDate);
  state.currentDate.setDate(state.currentDate.getDate() + offset);
  updateDateLabel();
  loadAgenda(state.currentDate);
}

/* ────── VIEW SWITCHING ────── */
const viewTitles = {
  agenda:     ['Agenda',       'Seus agendamentos'],
  overview:   ['Visão Geral',  'Resumo do seu negócio'],
  servicos:   ['Serviços',     'Gerencie seu catálogo'],
  assinatura: ['Assinatura',   'Plano e renovação'],
};
function switchView(name) {
  state.activeView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + name)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const [title, sub] = viewTitles[name] || ['–',''];
  $('topbar-title').textContent = title;
  $('topbar-sub').textContent   = sub;
  if (name === 'overview') loadMonthAgenda();
}
function updateBadge() {
  const n = state.agendamentos.filter(a => ['pendente','confirmado'].includes(a.status)).length;
  $('badge-agenda').textContent = n;
}

/* ────── MODALS ────── */
function openApptModal() {
  const now = new Date();
  $('m-data').value = fmt.isoDate(now);
  $('m-hora').value = `${String(now.getHours()).padStart(2,'0')}:${String(Math.ceil(now.getMinutes()/5)*5%60).padStart(2,'0')}`;
  setFb('m-feedback','');
  $('modal-agendamento').classList.add('open');
}
function closeApptModal() {
  $('modal-agendamento').classList.remove('open');
  $('m-nome').value = ''; $('m-whatsapp').value = '';
  $('save-appt-btn').disabled = false;
}
function openServiceModal() {
  setFb('s-feedback','');
  $('s-nome').value=''; $('s-preco').value=''; $('s-duracao').value='';
  $('modal-servico').classList.add('open');
}
function closeServiceModal() {
  $('modal-servico').classList.remove('open');
  $('save-service-btn').disabled = false;
}

/* ────── REALTIME ────── */
function startRealtime() {
  if (state.realtimeChannel) sb.removeChannel(state.realtimeChannel);
  state.realtimeChannel = sb
    .channel('agendamentos-' + state.user.id)
    .on('postgres_changes', { event:'*', schema:'public', table:'agendamentos', filter:`prof_id=eq.${state.user.id}` },
      async () => { await loadAgenda(state.currentDate); })
    .subscribe();
}

/* ────── LOGOUT ────── */
async function logout() {
  try { await sb.auth.signOut(); } catch(e) { /* ignore */ }
  window.location.replace('./index.html');
}

/* ────── MOBILE ────── */
function openSidebar()  { $('sidebar').classList.add('open'); $('sidebar-overlay').classList.add('open'); }
function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebar-overlay').classList.remove('open'); }

/* ────── BIND ALL EVENTS ────── */
function bindEvents() {
  $('logout-btn').addEventListener('click', logout);

  document.querySelectorAll('.nav-item[data-view]').forEach(btn =>
    btn.addEventListener('click', () => { switchView(btn.dataset.view); closeSidebar(); })
  );

  $('prev-day').addEventListener('click', () => changeDate(-1));
  $('next-day').addEventListener('click', () => changeDate(1));
  $('go-today').addEventListener('click', () => {
    state.currentDate = new Date(); updateDateLabel(); loadAgenda(state.currentDate);
  });

  $('open-modal-btn').addEventListener('click', openApptModal);
  $('close-modal-btn').addEventListener('click', closeApptModal);
  $('save-appt-btn').addEventListener('click', saveAppointment);
  $('modal-agendamento').addEventListener('click', e => { if (e.target===$('modal-agendamento')) closeApptModal(); });

  $('open-service-modal-btn').addEventListener('click', openServiceModal);
  $('close-service-modal-btn').addEventListener('click', closeServiceModal);
  $('save-service-btn').addEventListener('click', saveService);
  $('modal-servico').addEventListener('click', e => { if (e.target===$('modal-servico')) closeServiceModal(); });

  // Alert modal
  $('close-alert-btn').addEventListener('click', closeAlertModal);
  $('btn-send-alert').addEventListener('click', sendWhatsAppAlert);
  $('modal-alert').addEventListener('click', e => { if (e.target===$('modal-alert')) closeAlertModal(); });

  $('status-filter').querySelectorAll('.status-chip').forEach(chip =>
    chip.addEventListener('click', () => {
      $('status-filter').querySelectorAll('.status-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.filterStatus = chip.dataset.filter;
      renderTimeline();
    })
  );

  $('refresh-btn').addEventListener('click', async () => {
    await loadAgenda(state.currentDate);
    if (state.activeView === 'overview') await loadMonthAgenda();
  });

  $('btn-renew-sub')?.addEventListener('click', () =>
    alert('Entre em contato para renovar sua assinatura:\n📱 WhatsApp: (62) 9 9999-0000')
  );
  $('btn-history-sub')?.addEventListener('click', () =>
    alert('Histórico de pagamentos em breve disponível neste painel.')
  );

  $('mobile-menu-btn').addEventListener('click', openSidebar);
  $('sidebar-overlay').addEventListener('click', closeSidebar);
}

/* ────── INIT ────── */
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.replace('./index.html'); return; }
  state.user = session.user;

  bindEvents();
  updateDateLabel();

  try {
    await loadProfissional();  // upsert ensures row exists → fixes FK error
    await loadServicos();
    await loadAgenda(state.currentDate);
    loadSubscription();
    startRealtime();
  } catch(err) {
    $('timeline').innerHTML = `<div class="empty-state"><p style="color:#f87171">Erro: ${err.message}</p></div>`;
    console.error(err);
  }
}

init();
JSEOF
