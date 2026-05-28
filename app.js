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
  alertAppt: null,
  charts: { faturamento: null, servicos: null }
};

/* ────── HELPERS ────── */
const $ = id => document.getElementById(id);
const fmt = {
  brl: v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0)),
  time: d => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
  dateFull: d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  dateISO: d => d.toISOString().split('T')[0]
};

function setFeedback(id, msg, type = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'feedback ' + type;
}

/* ────── INFRAESTRUTURA: CARREGAMENTO DE DADOS ────── */
async function loadProfissional() {
  const { data, error } = await sb.from('profissionais').select('*').eq('id', state.user.id).maybeSingle();
  if (error) console.error(error);
  if (data) {
    state.profissional = data;
    $('prof-name').textContent = data.nome;
    $('prof-avatar').textContent = data.nome.charAt(0).toUpperCase();
  }
}

async function loadServicos() {
  const { data, error } = await sb.from('servicos').select('*').order('nome');
  if (!error && data) {
    state.servicos = data;
    renderServicos();
    
    const select = $('appt-servico');
    if (select) {
      select.innerHTML = data.map(s => `<option value="${s.id}">${s.nome} (${fmt.brl(s.preco)})</option>`).join('');
    }
  }
}

async function loadAgenda(date) {
  const startOfDay = new Date(date); startOfDay.setHours(0,0,0,0);
  const endOfDay = new Date(date); endOfDay.setHours(23,59,59,999);

  const { data: appts, error: err1 } = await sb
    .from('agendamentos')
    .select('*, servicos(*)')
    .gte('horario_inicio', startOfDay.toISOString())
    .lte('horario_inicio', endOfDay.toISOString())
    .order('horario_inicio', { ascending: true });

  const { data: blks, error: err2 } = await sb
    .from('bloqueios')
    .select('*')
    .gte('horario_fim', startOfDay.toISOString())
    .lte('horario_inicio', endOfDay.toISOString())
    .order('horario_inicio', { ascending: true });

  if (!err1 && appts) state.agendamentos = appts;
  if (!err2 && blks) state.bloqueios = blks;

  renderTimeline();
}

/* ────── RENDERIZAÇÃO DA AGENDA E TIMELINE ────── */
function renderTimeline() {
  const container = $('timeline-container');
  container.innerHTML = '';

  let itensMesclados = [];

  state.agendamentos.forEach(a => {
    if (state.filterStatus !== 'todos' && a.status !== state.filterStatus) return;
    itensMesclados.push({ ...a, tipoItem: 'agendamento' });
  });

  if (state.filterStatus === 'todos') {
    state.bloqueios.forEach(b => {
      itensMesclados.push({ ...b, tipoItem: 'bloqueio', status: 'bloqueio' });
    });
  }

  itensMesclados.sort((a, b) => new Date(a.horario_inicio) - new Date(b.horario_inicio));

  if (itensMesclados.length === 0) {
    container.innerHTML = '<p class="empty-state">Nenhum registro ou bloqueio para este dia.</p>';
    return;
  }

  itensMesclados.forEach(item => {
    const card = document.createElement('div');
    card.className = 'appt-card';

    if (item.tipoItem === 'bloqueio') {
      card.style.borderLeft = '4px solid var(--danger)';
      card.innerHTML = `
        <div class="appt-time">🔒 ${fmt.time(item.horario_inicio)}</div>
        <div class="appt-info-main">
          <div class="appt-client-name">${item.titulo}</div>
          <div class="appt-service-tag">Intervalo bloqueado até ${fmt.time(item.horario_fim)}</div>
        </div>
        <div class="appt-actions-cell">
          <button class="btn-secondary" style="padding:4px 8px; font-size:11px; border-color:rgba(239,68,68,0.3); color:var(--danger);" onclick="removerBloqueio('${item.id}', event)">Desbloquear</button>
        </div>
      `;
    } else {
      card.innerHTML = `
        <div class="appt-time">⏰ ${fmt.time(item.horario_inicio)}</div>
        <div class="appt-info-main">
          <div class="appt-client-name">${item.nome_cliente}</div>
          <div class="appt-service-tag">${item.servicos?.nome || 'Serviço não identificado'} — <span style="color:var(--gold-light); font-weight:600;">${fmt.brl(item.servicos?.preco)}</span></div>
        </div>
        <div class="appt-actions-cell">
          <span class="pill pill-${item.status}">${item.status}</span>
          ${item.status === 'confirmado' || item.status === 'pendente' ? `
            <button class="btn-icon" style="color:var(--success);" title="Concluir Atendimento" onclick="alterarStatus('${item.id}', 'concluido', event)">✔</button>
            <button class="btn-icon" style="color:var(--danger);" title="Cancelar Agendamento" onclick="alterarStatus('${item.id}', 'cancelado', event)">✖</button>
          ` : ''}
        </div>
      `;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-icon') || e.target.closest('button')) return;
        abrirHistoricoCliente(item.whatsapp_cliente, item.nome_cliente);
      });
    }
    container.appendChild(card);
  });
}

/* ────── RECURSO: HISTÓRICO COMPLETO DO CLIENTE ────── */
async function abrirHistoricoCliente(whatsapp, nome) {
  $('hist-nome-cliente').textContent = nome;
  $('hist-whatsapp-cliente').textContent = `WhatsApp: ${whatsapp}`;

  const { data: appts, error } = await sb
    .from('agendamentos')
    .select('*, servicos(nome, preco)')
    .eq('whatsapp_cliente', whatsapp)
    .order('horario_inicio', { ascending: false });

  if (error || !appts) {
    alert('Erro ao processar histórico do cliente.');
    return;
  }

  const concluidos = appts.filter(a => a.status === 'concluido');
  const totalCortes = concluidos.length;
  const gastoTotal = concluidos.reduce((acc, c) => acc + Number(c.servicos?.preco || 0), 0);
  const ticketMedio = totalCortes > 0 ? gastoTotal / totalCortes : 0;

  $('hist-total-cortes').textContent = totalCortes;
  $('hist-total-gasto').textContent = fmt.brl(gastoTotal);
  $('hist-ticket-medio').textContent = fmt.brl(ticketMedio);

  const container = $('hist-lista-cortes');
  container.innerHTML = appts.map(a => `
    <div class="appt-card" style="grid-template-columns:1fr auto; padding:10px 12px; font-size:13px; background:rgba(255,255,255,0.01)">
      <div>
        <div style="font-weight:600;">${a.servicos?.nome || 'Serviço Removido'}</div>
        <div style="font-size:11px; color:var(--muted);">${fmt.dateFull(a.horario_inicio)}</div>
      </div>
      <div style="text-align:right;">
        <span class="pill pill-${a.status}" style="font-size:9px; padding:2px 6px;">${a.status}</span>
        <div style="font-weight:700; color:var(--gold-light); margin-top:4px;">${fmt.brl(a.servicos?.preco)}</div>
      </div>
    </div>
  `).join(appts.length === 0 ? '<p class="empty-state">Nenhum atendimento no histórico.</p>' : '');

  $('modal-historico').classList.add('open');
}

/* ────── RECURSO: BLOQUEIO DE HORÁRIOS ────── */
async function salvarBloqueio() {
  const titulo = $('bloqueio-titulo').value.trim();
  const inicio = $('bloqueio-inicio').value;
  const fim = $('bloqueio-fim').value;

  if (!titulo || !inicio || !fim) {
    setFeedback('bloqueio-feedback', 'Por favor, preencha todos os campos.', 'error');
    return;
  }
  if (new Date(fim) <= new Date(inicio)) {
    setFeedback('bloqueio-feedback', 'O horário final deve ser após o início.', 'error');
    return;
  }

  const { error } = await sb.from('bloqueios').insert({
    prof_id: state.user.id,
    titulo,
    horario_inicio: new Date(inicio).toISOString(),
    horario_fim: new Date(fim).toISOString()
  });

  if (error) {
    setFeedback('bloqueio-feedback', 'Falha ao salvar: ' + error.message, 'error');
  } else {
    setFeedback('bloqueio-feedback', 'Horário bloqueado com sucesso!', 'success');
    $('bloqueio-titulo').value = ''; $('bloqueio-inicio').value = ''; $('bloqueio-fim').value = '';
    setTimeout(() => {
      $('modal-bloqueio').classList.remove('open');
      loadAgenda(state.currentDate);
    }, 1000);
  }
}

async function removerBloqueio(id, event) {
  event.stopPropagation();
  if (confirm('Tem certeza que deseja remover este bloqueio de horário?')) {
    await sb.from('bloqueios').delete().eq('id', id);
    loadAgenda(state.currentDate);
  }
}

/* ────── RECURSO: RELATÓRIO FINANCEIRO VISUAL ────── */
async function renderizarRelatoriosVisuais() {
  const { data: appts, error } = await sb.from('agendamentos').select('*, servicos(*)');
  if (error || !appts) return;

  const concluidos = appts.filter(a => a.status === 'concluido');
  const faturamentoTotal = concluidos.reduce((acc, c) => acc + Number(c.servicos?.preco || 0), 0);
  const totalConcluidos = concluidos.length;
  const ticketMedio = totalConcluidos > 0 ? faturamentoTotal / totalConcluidos : 0;

  const contagemServicos = {};
  concluidos.forEach(a => {
    const nome = a.servicos?.nome || 'Não identificado';
    contagemServicos[nome] = (contagemServicos[nome] || 0) + 1;
  });
  const servicoMaisVendido = Object.keys(contagemServicos).reduce((a, b) => contagemServicos[a] > contagemServicos[b] ? a : b, '-');

  $('rep-ticket-medio').textContent = fmt.brl(ticketMedio);
  $('rep-servico-topo').textContent = servicoMaisVendido;
  $('rep-faturamento-total').textContent = fmt.brl(faturamentoTotal);
  $('rep-total-concluidos').textContent = totalConcluidos;

  const faturamentoPorDia = {};
  concluidos.forEach(a => {
    const dataFormatada = new Date(a.horario_inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    faturamentoPorDia[dataFormatada] = (faturamentoPorDia[dataFormatada] || 0) + Number(a.servicos?.preco || 0);
  });

  if (state.charts.faturamento) state.charts.faturamento.destroy();
  if (state.charts.servicos) state.charts.servicos.destroy();

  const ctxFaturamento = $('chartFaturamento').getContext('2d');
  state.charts.faturamento = new Chart(ctxFaturamento, {
    type: 'line',
    data: {
      labels: Object.keys(faturamentoPorDia),
      datasets: [{
        label: 'Ganhos do Dia (R$)',
        data: Object.values(faturamentoPorDia),
        borderColor: '#c9933a',
        backgroundColor: 'rgba(201,147,58,0.08)',
        borderWidth: 2,
        fill: true,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8896a8' }, grid: { color: 'rgba(255,255,255,0.03)' } },
        y: { ticks: { color: '#8896a8' }, grid: { color: 'rgba(255,255,255,0.03)' } }
      }
    }
  });

  const ctxServicos = $('chartServicos').getContext('2d');
  state.charts.servicos = new Chart(ctxServicos, {
    type: 'doughnut',
    data: {
      labels: Object.keys(contagemServicos),
      datasets: [{
        data: Object.values(contagemServicos),
        backgroundColor: ['#c9933a', '#e8b56a', '#3b82f6', '#22c55e', '#a855f7', '#f97316'],
        borderColor: '#0c1118',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#eef0f4', boxWidth: 12 } } }
    }
  });
}

/* ────── CRIAÇÃO DE SERVIÇOS (CORRIGIDO) ────── */
async function salvarServico() {
  const nome = $('service-nome').value.trim();
  const preco = $('service-preco').value;
  const duracao = $('service-duracao').value;

  if (!nome || !preco || !duracao) {
    setFeedback('service-feedback', 'Por favor, preencha todos os campos do serviço.', 'error');
    return;
  }

  const { error } = await sb.from('servicos').insert({
    prof_id: state.user.id,
    nome: nome,
    preco: parseFloat(preco),
    duracao_minutos: parseInt(duracao)
  });

  if (error) {
    setFeedback('service-feedback', 'Erro ao salvar serviço: ' + error.message, 'error');
  } else {
    setFeedback('service-feedback', 'Serviço cadastrado com sucesso!', 'success');
    $('service-nome').value = ''; $('service-preco').value = ''; $('service-duracao').value = '';
    
    setTimeout(async () => {
      $('modal-service').classList.remove('open');
      await loadServicos(); // Atualiza a lista na tela e no select
    }, 1000);
  }
}

function renderServicos() {
  const container = $('services-container');
  if (!container) return;
  container.innerHTML = state.servicos.map(s => `
    <div class="appt-card" style="grid-template-columns: 1fr auto;">
      <div>
        <div class="appt-client-name">${s.nome}</div>
        <div class="appt-service-tag">Duração: ${s.duracao_minutos} min | Valor: <span style="color:var(--gold-light); font-weight:600;">${fmt.brl(s.preco)}</span></div>
      </div>
      <div>
        <button class="btn-secondary" style="padding:6px 12px; font-size:12px;" onclick="removerServico('${s.id}')">Excluir</button>
      </div>
    </div>
  `).join(state.servicos.length === 0 ? '<p class="empty-state">Nenhum serviço cadastrado.</p>' : '');
}

async function removerServico(id) {
  if (confirm('Deseja mesmo remover este serviço?')) {
    await sb.from('servicos').delete().eq('id', id);
    loadServicos();
  }
}

/* ────── CONTROLE DE STATUS E AGENDAMENTOS MANUAIS ────── */
async function alterarStatus(id, novoStatus, event) {
  if (event) event.stopPropagation();
  const { error } = await sb.from('agendamentos').update({ status: novoStatus }).eq('id', id);
  if (!error) loadAgenda(state.currentDate);
}

async function criarAgendamentoManual() {
  const nome = $('appt-nome').value.trim();
  const whatsapp = $('appt-whatsapp').value.trim();
  const servicoId = $('appt-servico').value;
  const horario = $('appt-horario').value;

  if (!nome || !whatsapp || !servicoId || !horario) {
    setFeedback('appt-feedback', 'Preencha todos os dados.', 'error'); return;
  }

  const { error } = await sb.from('agendamentos').insert({
    prof_id: state.user.id,
    servico_id: servicoId,
    nome_cliente: nome,
    whatsapp_cliente: whatsapp,
    horario_inicio: new Date(horario).toISOString()
  });

  if (error) {
    setFeedback('appt-feedback', error.message, 'error');
  } else {
    setFeedback('appt-feedback', 'Agendado com sucesso!', 'success');
    $('appt-nome').value = ''; $('appt-whatsapp').value = '';
    setTimeout(() => { $('modal-appt').classList.remove('open'); loadAgenda(state.currentDate); }, 1000);
  }
}

/* ────── EVENT BINDINGS (OUVINTES DE INTERAÇÃO) ────── */
function updateDateLabel() {
  $('current-date-lbl').textContent = state.currentDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function bindEvents() {
  // Controle de Abas do Menu Lateral
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

      btn.classList.add('active');
      const target = btn.dataset.target;
      if ($(target)) $(target).classList.add('active');

      if (target === 'view-agenda') { $('topbar-title').textContent = 'Agenda'; $('topbar-subtitle').textContent = 'Gerencie horários e atendimentos do dia'; }
      if (target === 'view-relatorios') { $('topbar-title').textContent = 'Relatórios'; $('topbar-subtitle').textContent = 'Análise de performance e ticket médio'; renderizarRelatoriosVisuais(); }
      if (target === 'view-servicos') { $('topbar-title').textContent = 'Serviços'; $('topbar-subtitle').textContent = 'Configure o menu e catálogo da barbearia'; }
      if (target === 'view-assinatura') { $('topbar-title').textContent = 'Assinatura'; $('topbar-subtitle').textContent = 'Faturamento e licença do ecossistema'; }
      
      closeSidebar();
    });
  });

  // Navegação de datas
  $('btn-prev-day').addEventListener('click', () => { state.currentDate.setDate(state.currentDate.getDate() - 1); updateDateLabel(); loadAgenda(state.currentDate); });
  $('btn-next-day').addEventListener('click', () => { state.currentDate.setDate(state.currentDate.getDate() + 1); updateDateLabel(); loadAgenda(state.currentDate); });

  // Mapeamento dos Modais (Inclusão e Correção do fluxo de Serviços)
  $('btn-open-bloqueio').addEventListener('click', () => { $('bloqueio-feedback').className = 'feedback'; $('modal-bloqueio').classList.add('open'); });
  $('btn-cancelar-bloqueio').addEventListener('click', () => $('modal-bloqueio').classList.remove('open'));
  $('btn-salvar-bloqueio').addEventListener('click', salvarBloqueio);
  $('btn-fechar-historico').addEventListener('click', () => $('modal-historico').classList.remove('open'));

  $('btn-new-appt').addEventListener('click', () => { $('appt-feedback').className = 'feedback'; $('modal-appt').classList.add('open'); });
  $('btn-cancelar-appt').addEventListener('click', () => $('modal-appt').classList.remove('open'));
  $('btn-salvar-appt').addEventListener('click', criarAgendamentoManual);

  // GATILHOS CORRIGIDOS PARA O MODAL DE SERVIÇOS
  $('btn-add-service').addEventListener('click', () => { $('service-feedback').className = 'feedback'; $('modal-service').classList.add('open'); });
  $('btn-cancelar-service').addEventListener('click', () => $('modal-service').classList.remove('open'));
  $('btn-salvar-service').addEventListener('click', salvarServico);

  // Filtros de status da Timeline
  $('status-filter').querySelectorAll('.status-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('status-filter').querySelectorAll('.status-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.filterStatus = chip.dataset.filter;
      renderTimeline();
    });
  });

  $('refresh-btn').addEventListener('click', () => loadAgenda(state.currentDate));
  $('logout-btn').addEventListener('click', async () => { await sb.auth.signOut(); window.location.replace('./index.html'); });
  $('btn-close-alert').addEventListener('click', () => $('modal-alert').classList.remove('open'));

  // Mobile Menu
  $('mobile-menu-btn').addEventListener('click', () => { $('sidebar').classList.add('open'); $('sidebar-overlay').style.display = 'block'; });
  $('sidebar-overlay').addEventListener('click', closeSidebar);
}

function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebar-overlay').style.display = 'none'; }

/* ────── REALTIME ────── */
function startRealtime() {
  state.realtimeChannel = sb.channel('mudancas-agenda')
    .on('postgres_changes', { event: 'INSERT', pattern: 'public', table: 'agendamentos' }, async (payload) => {
      const { data: appt } = await sb.from('agendamentos').select('*, servicos(*)').eq('id', payload.new.id).maybeSingle();
      if (appt) {
        $('alert-content').innerHTML = `
          <strong>Cliente:</strong> ${appt.nome_cliente}<br>
          <strong>Serviço:</strong> ${appt.servicos?.nome}<br>
          <strong>Horário:</strong> ${fmt.dateFull(appt.horario_inicio)}
        `;
        $('modal-alert').classList.add('open');
        loadAgenda(state.currentDate);
      }
    })
    .subscribe();
}

/* ────── INICIALIZAÇÃO ────── */
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
    startRealtime();
  } catch (e) {
    console.error('Erro na inicialização do painel:', e);
  }
}

window.addEventListener('DOMContentLoaded', init);
