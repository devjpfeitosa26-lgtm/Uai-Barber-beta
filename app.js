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
  charts: { faturamento: null, servicos: null },
  onboarding: {
    etapaAtual: 1,
    nomeTemp: '',
    servicoCriadoId: null
  }
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
  const fim    = $('bloqueio-fim').value;

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

/* ────── CRIAÇÃO DE SERVIÇOS ────── */
async function salvarServico() {
  const nome    = $('service-nome').value.trim();
  const preco   = $('service-preco').value;
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
      await loadServicos();
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
  const nome      = $('appt-nome').value.trim();
  const whatsapp  = $('appt-whatsapp').value.trim();
  const servicoId = $('appt-servico').value;
  const horario   = $('appt-horario').value;

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

/* ══════════════════════════════════════════════════════════════
   ────── ONBOARDING GUIADO ──────────────────────────────────
   Ativado automaticamente no 1º acesso (sem serviços cadastrados)
   e manualmente via botão "?" a qualquer momento.
   ══════════════════════════════════════════════════════════════ */

/**
 * Gera o link do bot personalizado para o barbeiro.
 * O slug é baseado no ID do usuário (primeiros 8 chars) para garantir unicidade.
 */
function gerarLinkBot(userId) {
  const slug = userId.replace(/-/g, '').substring(0, 10);
  return `https://uaibarber.app/bot/${slug}`;
}

/**
 * Controla qual etapa do onboarding está visível.
 * Esconde todas as slides e exibe apenas a etapa desejada.
 */
function irParaEtapaOnb(etapa) {
  state.onboarding.etapaAtual = etapa;

  // Esconde todas as etapas
  document.querySelectorAll('.onb-slide').forEach(el => {
    el.style.display = 'none';
  });

  // Exibe a etapa alvo
  const alvo = $(`onb-step-${etapa}`);
  if (alvo) alvo.style.display = 'block';
}

/**
 * Abre o modal de onboarding.
 * Sempre inicia do Passo 1 e limpa os campos para permitir revisão.
 */
function abrirOnboarding() {
  // Pré-preenche o campo de nome se o barbeiro já tem cadastro (revisita)
  if (state.profissional?.nome) {
    $('onb-input-nome').value = state.profissional.nome;
  } else {
    $('onb-input-nome').value = '';
  }

  // Limpa os campos de serviço e feedbacks
  $('onb-input-servnome').value    = '';
  $('onb-input-servpreco').value   = '';
  $('onb-input-servduracao').value = '';

  ['onb-feedback-1', 'onb-feedback-2', 'onb-feedback-3'].forEach(id => {
    setFeedback(id, '', '');
  });

  // Vai para o passo 1 e abre o modal
  irParaEtapaOnb(1);
  $('modal-onboarding').classList.add('open');
}

/**
 * PASSO 1 — Salva o nome comercial do barbeiro.
 * Atualiza o nome na tabela `profissionais` e avança para o passo 2.
 */
async function onbSalvarNome() {
  const nome = $('onb-input-nome').value.trim();
  if (!nome) {
    setFeedback('onb-feedback-1', 'Por favor, informe o nome da barbearia.', 'error');
    return;
  }

  const btn = $('onb-btn-proximo-1');
  btn.textContent = 'Salvando...';
  btn.disabled = true;

  // UPDATE apenas — o trigger on_auth_user_created já garante que a linha existe.
  // Upsert/insert quebraria o RLS pois não há política de INSERT em profissionais.
  const { error } = await sb
    .from('profissionais')
    .update({ nome: nome })
    .eq('id', state.user.id);

  btn.textContent = 'Avançar: Configurar Catálogo →';
  btn.disabled = false;

  if (error) {
    setFeedback('onb-feedback-1', 'Erro ao salvar: ' + error.message, 'error');
    return;
  }

  // Atualiza estado e exibição do sidebar imediatamente
  state.onboarding.nomeTemp = nome;
  $('prof-name').textContent = nome;
  $('prof-avatar').textContent = nome.charAt(0).toUpperCase();
  await loadProfissional();

  irParaEtapaOnb(2);
}

/**
 * PASSO 2 — Cria o primeiro serviço do catálogo.
 * Se já existem serviços, pula direto para o passo 3 sem obrigar novo cadastro.
 */
async function onbSalvarServico() {
  const nome    = $('onb-input-servnome').value.trim();
  const preco   = $('onb-input-servpreco').value;
  const duracao = $('onb-input-servduracao').value;

  // Se já existem serviços E os campos estão vazios, permite pular
  if (state.servicos.length > 0 && !nome && !preco && !duracao) {
    irParaEtapaOnb(3);
    $('onb-input-linkbot').value = gerarLinkBot(state.user.id);
    return;
  }

  if (!nome || !preco || !duracao) {
    setFeedback('onb-feedback-2', 'Preencha todos os campos para cadastrar o serviço.', 'error');
    return;
  }

  const btn = $('onb-btn-proximo-2');
  btn.textContent = 'Salvando...';
  btn.disabled = true;

  const { error } = await sb.from('servicos').insert({
    prof_id: state.user.id,
    nome: nome,
    preco: parseFloat(preco),
    duracao_minutos: parseInt(duracao)
  });

  btn.textContent = 'Salvar e Obter Link do Bot →';
  btn.disabled = false;

  if (error) {
    setFeedback('onb-feedback-2', 'Erro ao salvar: ' + error.message, 'error');
    return;
  }

  // Atualiza lista de serviços em segundo plano
  await loadServicos();

  // Passo 3: exibe o link personalizado do bot
  $('onb-input-linkbot').value = gerarLinkBot(state.user.id);
  irParaEtapaOnb(3);
}

/**
 * PASSO 3 — Copia o link do bot para a área de transferência.
 */
async function onbCopiarLink() {
  const link = $('onb-input-linkbot').value;
  try {
    await navigator.clipboard.writeText(link);
    setFeedback('onb-feedback-3', '✔ Link copiado! Cole no seu Instagram ou WhatsApp.', 'success');
    $('onb-btn-copiar').textContent = '✔ Copiado';
    setTimeout(() => { $('onb-btn-copiar').textContent = 'Copiar'; }, 2500);
  } catch {
    // Fallback para navegadores sem suporte à Clipboard API
    $('onb-input-linkbot').select();
    document.execCommand('copy');
    setFeedback('onb-feedback-3', '✔ Link copiado com sucesso!', 'success');
  }
}

/**
 * PASSO 3 — Finaliza o onboarding e fecha o modal.
 * Marca no localStorage que o onboarding foi concluído ao menos uma vez,
 * para que nas próximas sessões o modal não abra automaticamente.
 */
function onbFinalizar() {
  localStorage.setItem(`uaibarber_onb_done_${state.user.id}`, '1');
  $('modal-onboarding').classList.remove('open');
  loadAgenda(state.currentDate);
}

/**
 * Verifica se o onboarding deve ser exibido automaticamente.
 * Critérios: nunca foi concluído OU o barbeiro não tem nenhum serviço cadastrado.
 */
function verificarOnboarding() {
  const jaFezOnboarding = localStorage.getItem(`uaibarber_onb_done_${state.user.id}`);
  const semServicos = state.servicos.length === 0;

  if (!jaFezOnboarding || semServicos) {
    // Pequeno delay para o painel carregar antes de exibir o modal
    setTimeout(abrirOnboarding, 400);
  }
}

/* ────── EVENT BINDINGS (OUVINTES DE INTERAÇÃO) ────── */
function updateDateLabel() {
  $('current-date-lbl').textContent = state.currentDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function bindEvents() {
  // ── Controle de Abas do Menu Lateral ──
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

      btn.classList.add('active');
      const target = btn.dataset.target;
      if ($(target)) $(target).classList.add('active');

      if (target === 'view-agenda')     { $('topbar-title').textContent = 'Agenda';     $('topbar-subtitle').textContent = 'Gerencie horários e atendimentos do dia'; }
      if (target === 'view-relatorios') { $('topbar-title').textContent = 'Relatórios'; $('topbar-subtitle').textContent = 'Análise de performance e ticket médio'; renderizarRelatoriosVisuais(); }
      if (target === 'view-servicos')   { $('topbar-title').textContent = 'Serviços';   $('topbar-subtitle').textContent = 'Configure o menu e catálogo da barbearia'; }
      if (target === 'view-assinatura') { $('topbar-title').textContent = 'Assinatura'; $('topbar-subtitle').textContent = 'Faturamento e licença do ecossistema'; }

      closeSidebar();
    });
  });

  // ── Navegação de datas ──
  $('btn-prev-day').addEventListener('click', () => { state.currentDate.setDate(state.currentDate.getDate() - 1); updateDateLabel(); loadAgenda(state.currentDate); });
  $('btn-next-day').addEventListener('click', () => { state.currentDate.setDate(state.currentDate.getDate() + 1); updateDateLabel(); loadAgenda(state.currentDate); });

  // ── Modais Principais ──
  $('btn-open-bloqueio').addEventListener('click', () => { $('bloqueio-feedback').className = 'feedback'; $('modal-bloqueio').classList.add('open'); });
  $('btn-cancelar-bloqueio').addEventListener('click', () => $('modal-bloqueio').classList.remove('open'));
  $('btn-salvar-bloqueio').addEventListener('click', salvarBloqueio);
  $('btn-fechar-historico').addEventListener('click', () => $('modal-historico').classList.remove('open'));

  $('btn-new-appt').addEventListener('click', () => { $('appt-feedback').className = 'feedback'; $('modal-appt').classList.add('open'); });
  $('btn-cancelar-appt').addEventListener('click', () => $('modal-appt').classList.remove('open'));
  $('btn-salvar-appt').addEventListener('click', criarAgendamentoManual);

  $('btn-add-service').addEventListener('click', () => { $('service-feedback').className = 'feedback'; $('modal-service').classList.add('open'); });
  $('btn-cancelar-service').addEventListener('click', () => $('modal-service').classList.remove('open'));
  $('btn-salvar-service').addEventListener('click', salvarServico);

  // ── Filtros de status da Timeline ──
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

  // ── Mobile Menu ──
  $('mobile-menu-btn').addEventListener('click', () => { $('sidebar').classList.add('open'); $('sidebar-overlay').style.display = 'block'; });
  $('sidebar-overlay').addEventListener('click', closeSidebar);

  // ── Assinatura ──
  $('btn-renew-sub')?.addEventListener('click', () => {
    window.open('https://wa.me/?text=Olá! Gostaria de renovar minha assinatura UaiBarber.', '_blank');
  });

  // ══════════════════════════════════════════
  // ── ONBOARDING: Bindings dos passos ──────
  // ══════════════════════════════════════════

  // Passo 1 → 2: Salvar nome da barbearia
  $('onb-btn-proximo-1').addEventListener('click', onbSalvarNome);

  // Passo 1: tecla Enter avança
  $('onb-input-nome').addEventListener('keydown', e => {
    if (e.key === 'Enter') onbSalvarNome();
  });

  // Passo 2 → 3: Salvar primeiro serviço
  $('onb-btn-proximo-2').addEventListener('click', onbSalvarServico);

  // Passo 3: Copiar link do bot
  $('onb-btn-copiar').addEventListener('click', onbCopiarLink);

  // Passo 3: Finalizar onboarding
  $('onb-btn-finalizar').addEventListener('click', onbFinalizar);

  // Botão "?" flutuante — reabre o tutorial a qualquer momento
  $('btn-help-tutorial').addEventListener('click', () => {
    abrirOnboarding();
  });

  // Fechar onboarding clicando fora (apenas no overlay, não no box)
  $('modal-onboarding').addEventListener('click', e => {
    // Só fecha se clicar no fundo escuro, não no conteúdo do modal
    if (e.target === $('modal-onboarding')) {
      // Se for onboarding obrigatório (sem serviços), não deixa fechar
      const semServicos = state.servicos.length === 0;
      if (!semServicos) {
        $('modal-onboarding').classList.remove('open');
      }
    }
  });
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

    // ── Verifica se deve iniciar o onboarding automaticamente ──
    // Executa após tudo carregar para ter os dados de serviços disponíveis
    verificarOnboarding();

  } catch (e) {
    console.error('Erro na inicialização do painel:', e);
  }
}

window.addEventListener('DOMContentLoaded', init);
