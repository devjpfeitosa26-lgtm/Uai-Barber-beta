/* ── UaiBarber app.js ── */
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
  bloqueios: [],
  currentDate: new Date(),
  filterStatus: 'todos',
  activeView: 'agenda',
  realtimeChannel: null,
  alertAppt: null, // for whatsapp alert modal
};

/* ────── HELPERS ────── */
const $ = id => document.getElementById(id);
const fmt = {
  brl: v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0)),
  time: d => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(d)),
  date: d => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d),
  dateShort: d => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d),
  isoDate: d => d.toISOString().slice(0, 10),
  dateFull: d => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d)),
};

function setFeedback(id, msg, type = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'feedback ' + type;
}

function isToday(date) {
  const t = new Date();
  return date.getDate() === t.getDate() && date.getMonth() === t.getMonth() && date.getFullYear() === t.getFullYear();
}


function getServiceById(id) {
  return state.servicos.find(s => s.id === id);
}

function addMinutes(dateLike, minutes) {
  return new Date(new Date(dateLike).getTime() + minutes * 60000);
}

function rangesOverlap(startA, endA, startB, endB) {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
}

function formatPeriod(start, end) {
  const sameDay = fmt.isoDate(new Date(start)) === fmt.isoDate(new Date(end));
  if (sameDay) return `${fmt.time(start)} até ${fmt.time(end)}`;
  return `${fmt.dateShort(new Date(start))} ${fmt.time(start)} → ${fmt.dateShort(new Date(end))} ${fmt.time(end)}`;
}

function blockTypeLabel(type) {
  return {
    almoco: 'Almoço',
    ferias: 'Férias',
    folga: 'Folga',
    pausa: 'Pausa',
    personalizado: 'Bloqueio',
  }[type] || 'Bloqueio';
}

function blockTypeDefaultTitle(type) {
  return {
    almoco: 'Horário de almoço',
    ferias: 'Férias',
    folga: 'Dia de folga',
    pausa: 'Pausa na agenda',
    personalizado: 'Horário indisponível',
  }[type] || 'Horário indisponível';
}

/* ────── SUBSCRIPTION (MOCK) ────── */
function loadSubscription() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const daysTotal = (end - start) / 86400000;
  const daysLeft  = Math.ceil((end - today) / 86400000);
  const pct = Math.round((1 - daysLeft / daysTotal) * 100);

  const dot = $('sub-dot');
  const titleMini = $('sub-title-mini');
  const detailMini = $('sub-detail-mini');
  const barMini = $('sub-bar-mini');

  if (daysLeft <= 5) {
    dot.className = 'sub-dot danger';
    titleMini.textContent = 'Expira em breve!';
  } else if (daysLeft <= 10) {
    dot.className = 'sub-dot warning';
    titleMini.textContent = 'Expirando em breve';
  } else {
    dot.className = 'sub-dot';
    titleMini.textContent = 'Plano Pro Ativo';
  }
  detailMini.textContent = `${daysLeft} dias restantes`;
  barMini.style.width = Math.max(5, 100 - pct) + '%';

  $('sub-plan-name').textContent = 'Pro Mensal';
  $('sub-expiry').textContent = fmt.dateShort(end);
  $('sub-days-left').textContent = daysLeft + ' dias';
  $('sub-period-start').textContent = fmt.dateShort(start);
  $('sub-period-end').textContent = fmt.dateShort(end);
  $('sub-big-bar').style.width = Math.max(5, 100 - pct) + '%';

  const badge = $('sub-status-badge');
  const statusText = $('sub-status-text');
  if (daysLeft <= 0) {
    badge.className = 'sub-status-badge vencido';
    statusText.textContent = 'Vencida';
    $('sub-big-bar').style.background = 'var(--danger)';
  } else if (daysLeft <= 5) {
    badge.className = 'sub-status-badge expirando';
    statusText.textContent = 'Expirando';
    $('sub-big-bar').style.background = 'var(--warning)';
  } else {
    badge.className = 'sub-status-badge ativo';
    statusText.textContent = 'Ativo';
  }
}

/* ────── PROFISSIONAL ────── */
async function loadProfissional() {
  const { data, error } = await sb
    .from('profissionais')
    .select('id, nome')
    .eq('id', state.user.id)
    .single();

  if (error || !data) {
    // Profile may not exist yet — create it
    const nome = state.user.user_metadata?.nome || state.user.email?.split('@')[0] || 'Barbeiro';
    const { data: inserted, error: insertErr } = await sb
      .from('profissionais')
      .upsert({ id: state.user.id, nome }, { onConflict: 'id' })
      .select('id, nome')
      .single();
    if (insertErr) throw new Error('Erro ao criar perfil: ' + insertErr.message);
    state.profissional = inserted;
  } else {
    state.profissional = data;
  }

  const initial = (state.profissional.nome || '?').trim().charAt(0).toUpperCase();
  $('user-avatar').textContent = initial;
  $('user-name-sidebar').textContent = state.profissional.nome;
}

/* ────── SERVIÇOS ────── */
async function loadServicos() {
  const { data, error } = await sb
    .from('servicos')
    .select('id, nome, preco, duracao_minutos')
    .eq('prof_id', state.user.id)
    .order('nome');
  if (error) throw new Error('Erro ao carregar serviços.');
  state.servicos = data || [];
  renderServicesGrid();
  renderServiceSelect();
}

function renderServiceSelect() {
  const sel = $('m-servico');
  if (!state.servicos.length) {
    sel.innerHTML = '<option value="">Nenhum serviço cadastrado</option>';
    sel.disabled = true;
    return;
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
    document.getElementById('btn-add-first-service')?.addEventListener('click', openServiceModal);
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
  `).join('');

  grid.innerHTML += `
    <button class="btn-add-service" id="btn-add-extra-service">
      <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Novo serviço
    </button>`;
  document.getElementById('btn-add-extra-service')?.addEventListener('click', openServiceModal);

  grid.querySelectorAll('[data-delete-service]').forEach(btn => {
    btn.addEventListener('click', () => deleteService(btn.dataset.deleteService));
  });
}

async function saveService() {
  // Guarantee profissional exists before inserting service (fixes FK error)
  if (!state.profissional) {
    setFeedback('s-feedback', 'Perfil não carregado. Recarregue a página.', 'error');
    return;
  }

  const nome    = $('s-nome').value.trim();
  const preco   = parseFloat($('s-preco').value);
  const duracao = parseInt($('s-duracao').value, 10);

  if (!nome || isNaN(preco) || isNaN(duracao)) {
    setFeedback('s-feedback', 'Preencha todos os campos.', 'error'); return;
  }

  $('save-service-btn').disabled = true;
  setFeedback('s-feedback', 'Salvando...');

  // Ensure prof row exists (safety upsert)
  await sb.from('profissionais').upsert(
    { id: state.user.id, nome: state.profissional.nome },
    { onConflict: 'id' }
  );

  const { error } = await sb.from('servicos').insert({
    prof_id: state.user.id, nome, preco, duracao_minutos: duracao
  });

  if (error) {
    setFeedback('s-feedback', 'Erro: ' + error.message, 'error');
    $('save-service-btn').disabled = false;
    return;
  }

  setFeedback('s-feedback', 'Serviço criado!', 'success');
  await loadServicos();
  setTimeout(closeServiceModal, 600);
  $('save-service-btn').disabled = false;
}

async function deleteService(id) {
  if (!confirm('Remover este serviço? Agendamentos existentes não serão afetados.')) return;
  await sb.from('servicos').delete().eq('id', id);
  await loadServicos();
}

/* ────── AGENDAMENTOS ────── */
async function loadAgenda(date) {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end   = new Date(date); end.setHours(23, 59, 59, 999);

  const [apptRes, blockRes] = await Promise.all([
    sb
      .from('agendamentos')
      .select('id, nome_cliente, whatsapp_cliente, horario_inicio, status, servico_id, servicos(nome, preco, duracao_minutos)')
      .eq('prof_id', state.user.id)
      .gte('horario_inicio', start.toISOString())
      .lte('horario_inicio', end.toISOString())
      .order('horario_inicio', { ascending: true }),
    sb
      .from('bloqueios_agenda')
      .select('id, titulo, tipo, inicio, fim, observacao')
      .eq('prof_id', state.user.id)
      .lt('inicio', end.toISOString())
      .gt('fim', start.toISOString())
      .order('inicio', { ascending: true }),
  ]);

  if (apptRes.error) throw new Error(apptRes.error.message);
  if (blockRes.error) throw new Error(blockRes.error.message);

  state.agendamentos = apptRes.data || [];
  state.bloqueios = blockRes.data || [];
  renderTimeline();
  renderDaySummary();
  renderBlockedList();
  updateBadge();
}

async function loadMonthAgenda() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const { data } = await sb
    .from('agendamentos')
    .select('id, nome_cliente, horario_inicio, status, servicos(nome, preco)')
    .eq('prof_id', state.user.id)
    .gte('horario_inicio', start.toISOString())
    .lte('horario_inicio', end.toISOString())
    .order('horario_inicio', { ascending: false });

  state.agendamentosAll = data || [];
  renderOverview();
}

function apptMatchesFilter(item) {
  if (state.filterStatus === 'todos') return true;
  return item.status === state.filterStatus;
}

function renderTimeline() {
  const tl = $('timeline');
  const filtered = state.agendamentos.filter(apptMatchesFilter);

  const items = [
    ...state.bloqueios.map(item => ({ kind: 'bloqueio', start: item.inicio, raw: item })),
    ...filtered.map(item => ({ kind: 'agendamento', start: item.horario_inicio, raw: item })),
  ].sort((a, b) => new Date(a.start) - new Date(b.start));

  $('agenda-count').textContent = `${filtered.length} agendamento${filtered.length !== 1 ? 's' : ''} • ${state.bloqueios.length} bloqueio${state.bloqueios.length !== 1 ? 's' : ''}`;

  if (!items.length) {
    tl.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>${state.filterStatus !== 'todos' ? 'Nenhum agendamento com esse filtro e nenhum bloqueio ativo nesse dia.' : isToday(state.currentDate) ? 'Nenhum agendamento ou bloqueio para hoje.<br>Use os botões <strong>Novo agendamento</strong> ou <strong>Bloquear horário</strong>.' : 'Nenhum agendamento ou bloqueio nesse dia.'}</p>
      </div>`;
    return;
  }

  tl.innerHTML = items.map(entry => {
    if (entry.kind === 'bloqueio') {
      const item = entry.raw;
      return `
      <div class="appt-card blocked" data-block-id="${item.id}">
        <div>
          <div class="appt-time">${fmt.time(item.inicio)}</div>
          <div class="appt-time-end">até ${fmt.time(item.fim)}</div>
        </div>
        <div>
          <div class="appt-client">${item.titulo}</div>
          <div class="appt-service">${blockTypeLabel(item.tipo)}</div>
          ${item.observacao ? `<div class="block-note">${item.observacao}</div>` : ''}
        </div>
        <div class="appt-right">
          <span class="block-pill">${blockTypeLabel(item.tipo)}</span>
          <div class="appt-actions">
            <button class="btn-icon cancel" data-action="delete-block" data-id="${item.id}" title="Remover bloqueio">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>`;
    }

    const item = entry.raw;
    const endTime = item.servicos?.duracao_minutos
      ? new Date(new Date(item.horario_inicio).getTime() + item.servicos.duracao_minutos * 60000)
      : null;

    const canComplete = ['pendente', 'confirmado'].includes(item.status);
    const canCancel   = ['pendente', 'confirmado'].includes(item.status);
    const hasWhatsapp = !!item.whatsapp_cliente;

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
          ${hasWhatsapp ? `<button class="btn-icon whatsapp-alert" data-action="alert" data-id="${item.id}" title="Enviar alerta WhatsApp">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          </button>` : ''}
          ${canComplete ? `<button class="btn-icon complete" data-action="complete" data-id="${item.id}" title="Marcar como concluído">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          </button>` : ''}
          ${canCancel ? `<button class="btn-icon cancel" data-action="cancel" data-id="${item.id}" title="Cancelar">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  tl.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.dataset.action === 'complete') updateApptStatus(btn.dataset.id, 'concluido');
      if (btn.dataset.action === 'cancel')   updateApptStatus(btn.dataset.id, 'cancelado');
      if (btn.dataset.action === 'alert')    openAlertModal(btn.dataset.id);
      if (btn.dataset.action === 'delete-block') deleteBlock(btn.dataset.id);
    });
  });
}

function renderDaySummary() {
  const active = state.agendamentos.filter(a => a.status !== 'cancelado');
  const fat = active.reduce((acc, a) => acc + Number(a.servicos?.preco || 0), 0);
  const blockedMinutes = state.bloqueios.reduce((acc, item) => acc + Math.max(0, (new Date(item.fim) - new Date(item.inicio)) / 60000), 0);

  $('side-faturamento').textContent = fmt.brl(fat);
  $('side-faturamento-sub').textContent = `${active.length} atendimento${active.length !== 1 ? 's' : ''}`;

  const summary = $('day-summary');
  const counts = { confirmado: 0, pendente: 0, concluido: 0, cancelado: 0 };
  state.agendamentos.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++; });

  summary.innerHTML = [
    { label: 'Confirmados', key: 'confirmado', color: 'var(--success)' },
    { label: 'Pendentes',   key: 'pendente',   color: 'var(--warning)' },
    { label: 'Concluídos',  key: 'concluido',  color: 'var(--info)' },
    { label: 'Cancelados',  key: 'cancelado',  color: 'var(--danger)' },
    { label: 'Bloqueios',   value: state.bloqueios.length, color: 'var(--warning)' },
    { label: 'Horas bloqueadas', value: `${(blockedMinutes / 60).toFixed(blockedMinutes % 60 === 0 ? 0 : 1)}h`, color: 'var(--gold-light)' },
  ].map(r => `
    <div class="slot-row">
      <span class="slot-time">${r.label}</span>
      <span style="font-size:14px;font-weight:700;color:${r.color}">${r.value ?? counts[r.key]}</span>
    </div>`).join('');
}

function renderBlockedList() {
  const list = $('blocked-slots-list');
  if (!list) return;

  if (!state.bloqueios.length) {
    list.innerHTML = '<div class="block-summary-empty">Nenhum bloqueio cadastrado para este dia.</div>';
    return;
  }

  list.innerHTML = state.bloqueios.map(item => `
    <div class="block-mini">
      <div class="block-mini-title">${item.titulo}</div>
      <div class="block-mini-time">${formatPeriod(item.inicio, item.fim)}</div>
      <div class="block-mini-time">${blockTypeLabel(item.tipo)}</div>
    </div>
  `).join('');
}

function renderOverview() {
  const today = new Date();
  const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(today); todayEnd.setHours(23, 59, 59, 999);

  const todayItems = state.agendamentosAll.filter(a => {
    const d = new Date(a.horario_inicio);
    return d >= todayStart && d <= todayEnd && a.status !== 'cancelado';
  });
  const fat = todayItems.reduce((acc, a) => acc + Number(a.servicos?.preco || 0), 0);

  $('ov-fat-dia').textContent = fmt.brl(fat);
  $('ov-fat-sub').textContent = `${todayItems.length} atendimento${todayItems.length !== 1 ? 's' : ''}`;
  $('ov-clientes').textContent = todayItems.length;

  const monthActive = state.agendamentosAll.filter(a => a.status !== 'cancelado');
  $('ov-mes').textContent = monthActive.length;

  const future = state.agendamentosAll
    .filter(a => new Date(a.horario_inicio) > new Date() && ['confirmado', 'pendente'].includes(a.status))
    .sort((a, b) => new Date(a.horario_inicio) - new Date(b.horario_inicio));

  if (future.length) {
    $('ov-proximo').textContent = fmt.time(future[0].horario_inicio);
    $('ov-proximo-sub').textContent = future[0].nome_cliente;
  } else {
    $('ov-proximo').textContent = '–';
    $('ov-proximo-sub').textContent = 'sem próximos agendamentos';
  }

  const recent = state.agendamentosAll.slice(0, 8);
  const list = $('ov-recent-list');
  if (!recent.length) {
    list.innerHTML = '<div class="empty-state" style="padding:24px"><p>Nenhum agendamento no mês.</p></div>';
    return;
  }
  list.innerHTML = recent.map(a => `
    <div class="appt-card" style="margin-bottom:6px">
      <div>
        <div class="appt-time" style="font-size:15px">${fmt.time(a.horario_inicio)}</div>
        <div class="appt-time-end">${fmt.dateShort(new Date(a.horario_inicio))}</div>
      </div>
      <div>
        <div class="appt-client">${a.nome_cliente}</div>
        <div class="appt-service">${a.servicos?.nome || 'Serviço'}</div>
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
  await loadMonthAgenda();
}

async function saveAppointment() {
  const nome     = $('m-nome').value.trim();
  const whatsapp = $('m-whatsapp').value.trim();
  const servId   = $('m-servico').value;
  const data     = $('m-data').value;
  const hora     = $('m-hora').value;

  if (!nome || !whatsapp || !servId || !data || !hora) {
    setFeedback('m-feedback', 'Preencha todos os campos.', 'error'); return;
  }

  const service = getServiceById(servId);
  if (!service) {
    setFeedback('m-feedback', 'Selecione um serviço válido.', 'error'); return;
  }

  $('save-appt-btn').disabled = true;
  setFeedback('m-feedback', 'Salvando...');

  const horario_inicio = new Date(`${data}T${hora}:00`).toISOString();
  const horario_fim = addMinutes(horario_inicio, Number(service.duracao_minutos || 0)).toISOString();

  const [conflictRes, blockRes] = await Promise.all([
    sb
      .from('agendamentos')
      .select('id, horario_inicio, servicos(duracao_minutos)')
      .eq('prof_id', state.user.id)
      .in('status', ['pendente', 'confirmado'])
      .gte('horario_inicio', new Date(`${data}T00:00:00`).toISOString())
      .lte('horario_inicio', new Date(`${data}T23:59:59`).toISOString()),
    sb
      .from('bloqueios_agenda')
      .select('id, titulo, tipo, inicio, fim')
      .eq('prof_id', state.user.id)
      .lt('inicio', horario_fim)
      .gt('fim', horario_inicio)
      .limit(1),
  ]);

  const overlappingAppt = (conflictRes.data || []).find(item => {
    const itemEnd = addMinutes(item.horario_inicio, Number(item.servicos?.duracao_minutos || 0));
    return rangesOverlap(horario_inicio, horario_fim, item.horario_inicio, itemEnd);
  });

  if (overlappingAppt) {
    setFeedback('m-feedback', 'Já existe um agendamento ativo nesse intervalo.', 'error');
    $('save-appt-btn').disabled = false; return;
  }

  if (blockRes.data?.length) {
    const block = blockRes.data[0];
    setFeedback('m-feedback', `Esse horário está bloqueado: ${block.titulo}.`, 'error');
    $('save-appt-btn').disabled = false; return;
  }

  const { error } = await sb.from('agendamentos').insert({
    prof_id: state.user.id,
    servico_id: servId,
    nome_cliente: nome,
    whatsapp_cliente: whatsapp,
    horario_inicio,
    status: 'confirmado',
  });

  if (error) { setFeedback('m-feedback', error.message, 'error'); $('save-appt-btn').disabled = false; return; }

  setFeedback('m-feedback', 'Agendamento salvo!', 'success');
  state.currentDate = new Date(`${data}T${hora}:00`);
  await loadAgenda(state.currentDate);
  await loadMonthAgenda();
  updateDateLabel();
  setTimeout(closeApptModal, 500);
  $('save-appt-btn').disabled = false;
}

/* ────── WHATSAPP ALERT MODAL ────── */
const ALERT_TEMPLATES = [
  {
    id: 'lembrete',
    icon: '🔔',
    label: 'Lembrete de corte',
    text: (appt) => `Olá, ${appt.nome_cliente}! 👋\n\nPassando para lembrar que você tem um agendamento na *UaiBarber* ${fmt.dateFull(appt.horario_inicio) ? 'marcado para ' + fmt.dateFull(appt.horario_inicio) : ''}.\n\nEstamos te esperando! ✂️`,
  },
  {
    id: 'cancelamento',
    icon: '❌',
    label: 'Aviso de cancelamento',
    text: (appt) => `Olá, ${appt.nome_cliente}!\n\nInfelizmente precisamos *cancelar* seu agendamento que estava marcado para ${fmt.dateFull(appt.horario_inicio)}.\n\nPedimos desculpas pelo inconveniente. Entre em contato para reagendarmos! 🙏`,
  },
  {
    id: 'reagendamento',
    icon: '📅',
    label: 'Proposta de reagendamento',
    text: (appt) => `Olá, ${appt.nome_cliente}! 😊\n\nGostaríamos de *remarcar* seu atendimento que estava para ${fmt.dateFull(appt.horario_inicio)}.\n\nQual horário fica melhor para você? Responda aqui e já agendamos! ✂️`,
  },
  {
    id: 'confirmacao',
    icon: '✅',
    label: 'Confirmação de horário',
    text: (appt) => `Olá, ${appt.nome_cliente}! ✅\n\nSeu agendamento está *confirmado* para ${fmt.dateFull(appt.horario_inicio)}.\n\nQualquer dúvida, é só chamar. Te esperamos! 💈`,
  },
  {
    id: 'personalizada',
    icon: '✏️',
    label: 'Mensagem personalizada',
    text: (appt) => `Olá, ${appt.nome_cliente}! `,
  },
];

function openAlertModal(apptId) {
  const appt = state.agendamentos.find(a => a.id === apptId);
  if (!appt) return;
  state.alertAppt = appt;

  $('alert-client-name').textContent = appt.nome_cliente;
  $('alert-client-phone').textContent = appt.whatsapp_cliente;
  $('alert-appt-info').textContent = `${appt.servicos?.nome || 'Serviço'} • ${fmt.time(appt.horario_inicio)}`;

  // Render template chips
  const chips = $('alert-template-chips');
  chips.innerHTML = ALERT_TEMPLATES.map(t => `
    <button class="alert-chip" data-template="${t.id}">
      <span>${t.icon}</span> ${t.label}
    </button>
  `).join('');

  chips.querySelectorAll('.alert-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chips.querySelectorAll('.alert-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const tpl = ALERT_TEMPLATES.find(t => t.id === chip.dataset.template);
      if (tpl) $('alert-message').value = tpl.text(appt);
    });
  });

  // Select first template by default
  const defaultTpl = ALERT_TEMPLATES[0];
  chips.querySelector('[data-template="lembrete"]')?.classList.add('active');
  $('alert-message').value = defaultTpl.text(appt);

  $('modal-alert').classList.add('open');
}

function closeAlertModal() {
  $('modal-alert').classList.remove('open');
  state.alertAppt = null;
}

function sendWhatsappAlert() {
  const appt = state.alertAppt;
  if (!appt) return;
  const msg = $('alert-message').value.trim();
  if (!msg) { alert('Digite uma mensagem antes de enviar.'); return; }

  let phone = appt.whatsapp_cliente.replace(/\D/g, '');
  if (!phone.startsWith('55')) phone = '55' + phone;

  const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
  closeAlertModal();
}

/* ────── DATE NAVIGATION ────── */
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
  agenda:     ['Agenda', 'Seus agendamentos'],
  overview:   ['Visão Geral', 'Resumo do seu negócio'],
  servicos:   ['Serviços', 'Gerencie seu catálogo'],
  assinatura: ['Assinatura', 'Plano e renovação'],
};

function switchView(name) {
  state.activeView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  const [title, sub] = viewTitles[name] || ['–', ''];
  $('topbar-title').textContent = title;
  $('topbar-sub').textContent   = sub;

  if (name === 'overview') loadMonthAgenda();
}

function updateBadge() {
  const active = state.agendamentos.filter(a => ['pendente', 'confirmado'].includes(a.status));
  $('badge-agenda').textContent = active.length;
}

/* ────── MODALS ────── */
function openApptModal() {
  const now = new Date();
  $('m-data').value = fmt.isoDate(now);
  $('m-hora').value = `${String(now.getHours()).padStart(2,'0')}:${String(Math.ceil(now.getMinutes()/5)*5 % 60).padStart(2,'0')}`;
  setFeedback('m-feedback', '');
  $('modal-agendamento').classList.add('open');
}
function closeApptModal() {
  $('modal-agendamento').classList.remove('open');
  $('m-nome').value = '';
  $('m-whatsapp').value = '';
  $('save-appt-btn').disabled = false;
}

function openServiceModal() {
  setFeedback('s-feedback', '');
  $('s-nome').value = '';
  $('s-preco').value = '';
  $('s-duracao').value = '';
  $('modal-servico').classList.add('open');
}
function closeServiceModal() {
  $('modal-servico').classList.remove('open');
  $('save-service-btn').disabled = false;
}

function syncBlockTitle(force = false) {
  const title = $('b-titulo');
  if (!title) return;
  if (force || title.dataset.auto === 'true' || !title.value.trim()) {
    title.value = blockTypeDefaultTitle($('b-tipo').value);
    title.dataset.auto = 'true';
  }
}

function openBlockModal() {
  const selectedDate = fmt.isoDate(state.currentDate || new Date());
  $('b-tipo').value = 'almoco';
  $('b-data-inicio').value = selectedDate;
  $('b-hora-inicio').value = '12:00';
  $('b-data-fim').value = selectedDate;
  $('b-hora-fim').value = '13:00';
  $('b-observacao').value = '';
  $('b-titulo').value = '';
  $('b-titulo').dataset.auto = 'true';
  syncBlockTitle(true);
  setFeedback('b-feedback', '');
  $('modal-bloqueio').classList.add('open');
}

function closeBlockModal() {
  $('modal-bloqueio').classList.remove('open');
  $('save-block-btn').disabled = false;
}

async function saveBlock() {
  const tipo = $('b-tipo').value;
  const titulo = $('b-titulo').value.trim() || blockTypeDefaultTitle(tipo);
  const dataInicio = $('b-data-inicio').value;
  const horaInicio = $('b-hora-inicio').value;
  const dataFim = $('b-data-fim').value;
  const horaFim = $('b-hora-fim').value;
  const observacao = $('b-observacao').value.trim();

  if (!tipo || !dataInicio || !horaInicio || !dataFim || !horaFim) {
    setFeedback('b-feedback', 'Preencha início e fim do bloqueio.', 'error'); return;
  }

  const inicio = new Date(`${dataInicio}T${horaInicio}:00`);
  const fim = new Date(`${dataFim}T${horaFim}:00`);
  if (!(inicio < fim)) {
    setFeedback('b-feedback', 'A data final precisa ser maior que a inicial.', 'error'); return;
  }

  $('save-block-btn').disabled = true;
  setFeedback('b-feedback', 'Salvando bloqueio...');

  const [apptRes, blockRes] = await Promise.all([
    sb
      .from('agendamentos')
      .select('id, nome_cliente, horario_inicio, servicos(duracao_minutos)')
      .eq('prof_id', state.user.id)
      .in('status', ['pendente', 'confirmado'])
      .lt('horario_inicio', fim.toISOString())
      .gte('horario_inicio', new Date(inicio.getTime() - 24 * 60 * 60000).toISOString()),
    sb
      .from('bloqueios_agenda')
      .select('id, titulo')
      .eq('prof_id', state.user.id)
      .lt('inicio', fim.toISOString())
      .gt('fim', inicio.toISOString())
      .limit(1),
  ]);

  const overlappingAppt = (apptRes.data || []).find(item => {
    const itemEnd = addMinutes(item.horario_inicio, Number(item.servicos?.duracao_minutos || 0));
    return rangesOverlap(inicio, fim, item.horario_inicio, itemEnd);
  });

  if (overlappingAppt) {
    setFeedback('b-feedback', `Já existe um agendamento ativo nesse período: ${overlappingAppt.nome_cliente}.`, 'error');
    $('save-block-btn').disabled = false;
    return;
  }

  if (blockRes.data?.length) {
    setFeedback('b-feedback', `Já existe um bloqueio sobreposto: ${blockRes.data[0].titulo}.`, 'error');
    $('save-block-btn').disabled = false;
    return;
  }

  const { error } = await sb.from('bloqueios_agenda').insert({
    prof_id: state.user.id,
    titulo,
    tipo,
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    observacao: observacao || null,
  });

  if (error) {
    setFeedback('b-feedback', error.message, 'error');
    $('save-block-btn').disabled = false;
    return;
  }

  setFeedback('b-feedback', 'Bloqueio salvo com sucesso!', 'success');
  state.currentDate = new Date(inicio);
  updateDateLabel();
  await loadAgenda(state.currentDate);
  setTimeout(closeBlockModal, 500);
}

async function deleteBlock(id) {
  if (!confirm('Remover este bloqueio da agenda?')) return;
  await sb.from('bloqueios_agenda').delete().eq('id', id);
  await loadAgenda(state.currentDate);
}

/* ────── REALTIME ────── */
function startRealtime() {
  if (state.realtimeChannel) sb.removeChannel(state.realtimeChannel);
  state.realtimeChannel = sb
    .channel('agenda-live-' + state.user.id)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'agendamentos',
      filter: `prof_id=eq.${state.user.id}`
    }, async () => {
      await loadAgenda(state.currentDate);
      if (state.activeView === 'overview') await loadMonthAgenda();
    })
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'bloqueios_agenda',
      filter: `prof_id=eq.${state.user.id}`
    }, async () => {
      await loadAgenda(state.currentDate);
    })
    .subscribe();
}

/* ────── LOGOUT ────── */
async function logout() {
  try { await sb.auth.signOut(); } catch (e) {}
  window.location.replace('./index.html');
}

/* ────── MOBILE MENU ────── */
function openSidebar() {
  $('sidebar').classList.add('open');
  $('sidebar-overlay').classList.add('open');
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('open');
}

/* ────── BIND EVENTS ────── */
function bindEvents() {
  $('logout-btn').addEventListener('click', logout);

  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      closeSidebar();
    });
  });

  $('prev-day').addEventListener('click', () => changeDate(-1));
  $('next-day').addEventListener('click', () => changeDate(1));
  $('go-today').addEventListener('click', () => {
    state.currentDate = new Date();
    updateDateLabel();
    loadAgenda(state.currentDate);
  });

  $('open-modal-btn').addEventListener('click', openApptModal);
  $('close-modal-btn').addEventListener('click', closeApptModal);
  $('save-appt-btn').addEventListener('click', saveAppointment);
  $('modal-agendamento').addEventListener('click', e => { if (e.target === $('modal-agendamento')) closeApptModal(); });

  $('open-block-modal-btn').addEventListener('click', openBlockModal);
  $('close-block-modal-btn').addEventListener('click', closeBlockModal);
  $('save-block-btn').addEventListener('click', saveBlock);
  $('modal-bloqueio').addEventListener('click', e => { if (e.target === $('modal-bloqueio')) closeBlockModal(); });
  $('b-tipo').addEventListener('change', () => syncBlockTitle(true));
  $('b-titulo').addEventListener('input', () => { $('b-titulo').dataset.auto = 'false'; });

  $('open-service-modal-btn').addEventListener('click', openServiceModal);
  $('close-service-modal-btn').addEventListener('click', closeServiceModal);
  $('save-service-btn').addEventListener('click', saveService);
  $('modal-servico').addEventListener('click', e => { if (e.target === $('modal-servico')) closeServiceModal(); });

  // Alert modal
  $('close-alert-modal-btn').addEventListener('click', closeAlertModal);
  $('send-alert-btn').addEventListener('click', sendWhatsappAlert);
  $('modal-alert').addEventListener('click', e => { if (e.target === $('modal-alert')) closeAlertModal(); });

  $('status-filter').querySelectorAll('.status-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('status-filter').querySelectorAll('.status-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.filterStatus = chip.dataset.filter;
      renderTimeline();
    });
  });

  $('refresh-btn').addEventListener('click', async () => {
    await loadAgenda(state.currentDate);
    if (state.activeView === 'overview') await loadMonthAgenda();
  });

  $('btn-renew-sub')?.addEventListener('click', () => {
    alert('Entre em contato via WhatsApp para renovar sua assinatura:\n📱 (62) 9 9999-0000');
  });
  $('btn-history-sub')?.addEventListener('click', () => {
    alert('Histórico de pagamentos em breve disponível neste painel.');
  });

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
    await loadProfissional();
    await loadServicos();
    await loadAgenda(state.currentDate);
    loadSubscription();
    startRealtime();
  } catch (err) {
    $('timeline').innerHTML = `<div class="empty-state"><p>Erro: ${err.message}</p></div>`;
  }
}

init();
