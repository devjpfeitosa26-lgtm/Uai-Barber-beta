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
  },
  tour: { ativa: false, etapaAtual: 0 }
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
 *
 * Usa upsert para cobrir dois cenários:
 *  a) Linha já existe (trigger rodou no cadastro) → apenas atualiza o nome.
 *  b) Linha NÃO existe (trigger não rodou, usuário antigo, etc.) → cria a linha.
 *
 * Pré-requisito no Supabase RLS:
 *   create policy "profissionais_inserir_proprio" on public.profissionais
 *     for insert with check (auth.uid() = id);
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

  // Upsert: INSERT se não existir, UPDATE se já existir.
  // Garante que a linha em `profissionais` existe ANTES de tentar inserir
  // serviços (que têm FK para esta tabela).
  const { error } = await sb
    .from('profissionais')
    .upsert({ id: state.user.id, nome: nome }, { onConflict: 'id' });

  btn.textContent = 'Avançar: Configurar Catálogo →';
  btn.disabled = false;

  if (error) {
    setFeedback('onb-feedback-1', 'Erro ao salvar: ' + error.message, 'error');
    return;
  }

  // Recarrega e confirma que a linha realmente existe agora
  await loadProfissional();

  if (!state.profissional) {
    setFeedback('onb-feedback-1', 'Não foi possível confirmar o cadastro. Tente novamente.', 'error');
    return;
  }

  // Atualiza sidebar imediatamente
  state.onboarding.nomeTemp = nome;
  $('prof-name').textContent = nome;
  $('prof-avatar').textContent = nome.charAt(0).toUpperCase();

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
  // Inicia o tour guiado automaticamente após concluir o onboarding
  setTimeout(iniciarTour, 500);
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


/* ══════════════════════════════════════════════════════════════
   ────── TOUR GUIADO DA INTERFACE ────────────────────────────
   Destaca cada elemento com spotlight + tooltip explicativo.
   Iniciado automaticamente após o onboarding ou pelo botão "?".
   ══════════════════════════════════════════════════════════════ */

/* Passos do tour — selector, título, texto e posição do tooltip */
const TOUR_PASSOS = [
  {
    selector: '[data-target="view-agenda"]',
    titulo: '📅 Agenda do Dia',
    texto: 'Este é o coração do seu painel. Aqui você vê todos os agendamentos e bloqueios do dia, organizados por horário. Clique em qualquer card para ver o histórico completo do cliente.',
    posicao: 'right'
  },
  {
    selector: '.date-picker-ctrl',
    titulo: '📆 Navegação de Datas',
    texto: 'Use as setas para avançar ou voltar entre os dias. Você pode consultar a agenda de qualquer data, passada ou futura.',
    posicao: 'bottom'
  },
  {
    selector: '#btn-new-appt',
    titulo: '➕ Novo Agendamento',
    texto: 'Clique aqui para cadastrar um agendamento manual — para clientes que ligam, mandam mensagem ou aparecem pessoalmente. Basta preencher nome, WhatsApp, serviço e horário.',
    posicao: 'bottom'
  },
  {
    selector: '#btn-open-bloqueio',
    titulo: '🔒 Bloquear Horário',
    texto: 'Precisa de uma pausa? Bloqueie faixas de horário para almoço, folga ou férias. O robô de agendamento não vai marcar nenhum cliente nesse intervalo.',
    posicao: 'bottom'
  },
  {
    selector: '#status-filter',
    titulo: '🔍 Filtros de Status',
    texto: 'Filtre os atendimentos por status: confirmados, concluídos ou cancelados. Útil para fechar o caixa no fim do dia ou conferir o que ficou pendente.',
    posicao: 'bottom'
  },
  {
    selector: '[data-target="view-relatorios"]',
    titulo: '📊 Relatórios Visuais',
    texto: 'Acesse seus números: faturamento por dia em gráfico, serviço mais vendido, ticket médio e total de atendimentos concluídos. Tudo calculado automaticamente.',
    posicao: 'right'
  },
  {
    selector: '[data-target="view-servicos"]',
    titulo: '✂️ Meus Serviços',
    texto: 'Gerencie seu catálogo aqui. Adicione ou remova serviços com nome, preço e duração. O robô usa essa lista para oferecer opções aos clientes no WhatsApp.',
    posicao: 'right'
  },
  {
    selector: '[data-target="view-assinatura"]',
    titulo: '💳 Minha Assinatura',
    texto: 'Acompanhe o status do seu plano e a data de renovação. Caso precise de ajuda, entre em contato pelo WhatsApp direto desta aba.',
    posicao: 'right'
  },
  {
    selector: '#btn-help-tutorial',
    titulo: '❓ Ajuda Rápida',
    texto: 'Este botão estará sempre aqui! Clique a qualquer momento para rever a configuração inicial ou iniciar este tour novamente.',
    posicao: 'top'
  }
];

/** Injeta os estilos CSS do tour no <head> — chamado uma única vez no init */
function injetarEstilosTour() {
  if ($('tour-styles')) return;
  const style = document.createElement('style');
  style.id = 'tour-styles';
  style.textContent = `
    /* ── Overlay e Spotlight ── */
    #tour-spotlight {
      position: fixed;
      border-radius: 8px;
      z-index: 1001;
      pointer-events: none;
      transition: top 0.35s ease, left 0.35s ease, width 0.35s ease, height 0.35s ease;
      box-shadow: 0 0 0 9999px rgba(5, 7, 11, 0.82);
      outline: 2px solid rgba(201,147,58,0.6);
      outline-offset: 3px;
    }
    /* ── Tooltip do Tour ── */
    #tour-tooltip {
      position: fixed;
      z-index: 1002;
      background: #0f1520;
      border: 1px solid rgba(201,147,58,0.35);
      border-radius: 10px;
      padding: 18px 20px;
      width: 300px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.7);
      transition: top 0.35s ease, left 0.35s ease, opacity 0.2s ease;
    }
    #tour-tooltip::before {
      content: '';
      position: absolute;
      width: 10px; height: 10px;
      background: #0f1520;
      border-left: 1px solid rgba(201,147,58,0.35);
      border-top: 1px solid rgba(201,147,58,0.35);
      transform: rotate(45deg);
    }
    #tour-tooltip.arrow-left::before  { left: -6px;  top: 18px; transform: rotate(-45deg); border: none; border-left: 1px solid rgba(201,147,58,0.35); border-bottom: 1px solid rgba(201,147,58,0.35); }
    #tour-tooltip.arrow-right::before { right: -6px; top: 18px; transform: rotate(135deg); border: none; border-left: 1px solid rgba(201,147,58,0.35); border-bottom: 1px solid rgba(201,147,58,0.35); }
    #tour-tooltip.arrow-top::before   { top: -6px;   left: 20px; transform: rotate(45deg); }
    #tour-tooltip.arrow-bottom::before{ bottom: -6px; left: 20px; transform: rotate(225deg); border: none; border-left: 1px solid rgba(201,147,58,0.35); border-bottom: 1px solid rgba(201,147,58,0.35); }
    .tour-counter {
      font-size: 11px;
      font-weight: 600;
      color: #c9933a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .tour-titulo {
      font-family: 'Syne', sans-serif;
      font-size: 15px;
      font-weight: 700;
      color: #eef0f4;
      margin-bottom: 8px;
    }
    .tour-texto {
      font-size: 13px;
      color: #8896a8;
      line-height: 1.55;
      margin-bottom: 16px;
    }
    .tour-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .tour-btn-pular {
      background: none;
      border: none;
      color: #6b7a94;
      font-size: 12px;
      cursor: pointer;
      padding: 4px 0;
      text-decoration: underline;
    }
    .tour-btn-pular:hover { color: #ef4444; }
    .tour-nav-right { display: flex; gap: 8px; }
    .tour-btn-nav {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.12);
      color: #eef0f4;
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    .tour-btn-nav:hover { background: rgba(255,255,255,0.08); }
    .tour-btn-nav.primary {
      background: #c9933a;
      border-color: #c9933a;
      color: #000;
      font-weight: 600;
    }
    .tour-btn-nav.primary:hover { background: #e8b56a; }
    /* ── Mini-modal do botão "?" ── */
    #modal-ajuda {
      position: fixed;
      bottom: 84px;
      right: 24px;
      background: #0f1520;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      padding: 14px;
      width: 240px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.7);
      z-index: 1000;
      display: none;
      flex-direction: column;
      gap: 8px;
    }
    #modal-ajuda.open { display: flex; }
    #modal-ajuda h5 {
      font-size: 11px;
      font-weight: 600;
      color: #6b7a94;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .ajuda-opcao {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      color: #eef0f4;
      padding: 10px 12px;
      border-radius: 7px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: background 0.2s, border-color 0.2s;
    }
    .ajuda-opcao:hover { background: rgba(201,147,58,0.1); border-color: rgba(201,147,58,0.3); }
  `;
  document.head.appendChild(style);

  /* Cria os elementos do spotlight, tooltip e mini-modal dinamicamente */
  const spotlight = document.createElement('div');
  spotlight.id = 'tour-spotlight';
  spotlight.style.display = 'none';
  document.body.appendChild(spotlight);

  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  const miniModal = document.createElement('div');
  miniModal.id = 'modal-ajuda';
  miniModal.innerHTML = `
    <h5>Como posso ajudar?</h5>
    <button class="ajuda-opcao" id="ajuda-btn-onboarding">⚙️ Refazer Configuração Inicial</button>
    <button class="ajuda-opcao" id="ajuda-btn-tour">🗺️ Tour Guiado da Plataforma</button>
  `;
  document.body.appendChild(miniModal);
}

/** Inicia o tour a partir do passo 0 */
function iniciarTour() {
  // Garante que o mini-modal esteja fechado
  const miniModal = $('modal-ajuda');
  if (miniModal) miniModal.classList.remove('open');

  state.tour.ativa = true;
  state.tour.etapaAtual = 0;
  renderizarPassoTour(0);
}

/** Renderiza um passo específico do tour */
function renderizarPassoTour(index) {
  const passo = TOUR_PASSOS[index];
  if (!passo) { finalizarTour(); return; }

  const alvo = document.querySelector(passo.selector);
  if (!alvo) { renderizarPassoTour(index + 1); return; } // pula se elemento não existe

  const spotlight  = $('tour-spotlight');
  const tooltip    = $('tour-tooltip');
  const rect       = alvo.getBoundingClientRect();
  const PAD        = 6; // padding visual ao redor do elemento destacado
  const MARGEM     = 14; // distância entre spotlight e tooltip

  /* ── Posiciona o spotlight sobre o elemento ── */
  spotlight.style.display = 'block';
  spotlight.style.top     = `${rect.top    - PAD}px`;
  spotlight.style.left    = `${rect.left   - PAD}px`;
  spotlight.style.width   = `${rect.width  + PAD * 2}px`;
  spotlight.style.height  = `${rect.height + PAD * 2}px`;

  /* ── Monta o conteúdo do tooltip ── */
  const ehUltimo   = index === TOUR_PASSOS.length - 1;
  const ehPrimeiro = index === 0;

  tooltip.className = '';
  tooltip.style.display = 'block';
  tooltip.style.opacity = '0';
  tooltip.innerHTML = `
    <div class="tour-counter">Passo ${index + 1} de ${TOUR_PASSOS.length}</div>
    <div class="tour-titulo">${passo.titulo}</div>
    <p class="tour-texto">${passo.texto}</p>
    <div class="tour-nav">
      <button class="tour-btn-pular" id="tour-btn-pular">Pular tour</button>
      <div class="tour-nav-right">
        ${!ehPrimeiro ? `<button class="tour-btn-nav" id="tour-btn-anterior">← Anterior</button>` : ''}
        <button class="tour-btn-nav primary" id="tour-btn-proximo">
          ${ehUltimo ? '✔ Concluir' : 'Próximo →'}
        </button>
      </div>
    </div>
  `;

  /* ── Posiciona o tooltip de acordo com a direção preferida ── */
  const ttW = 300; // largura fixa do tooltip
  const ttH = tooltip.offsetHeight || 180; // estimativa antes de renderizar
  const vW  = window.innerWidth;
  const vH  = window.innerHeight;

  let top, left, arrowClass;

  switch (passo.posicao) {
    case 'right':
      left = rect.right + PAD + MARGEM;
      top  = rect.top + PAD;
      arrowClass = 'arrow-left';
      // Se não couber à direita, inverte para esquerda
      if (left + ttW > vW - 10) { left = rect.left - PAD - MARGEM - ttW; arrowClass = 'arrow-right'; }
      break;
    case 'left':
      left = rect.left - PAD - MARGEM - ttW;
      top  = rect.top + PAD;
      arrowClass = 'arrow-right';
      if (left < 10) { left = rect.right + PAD + MARGEM; arrowClass = 'arrow-left'; }
      break;
    case 'bottom':
      top  = rect.bottom + PAD + MARGEM;
      left = Math.min(rect.left - PAD, vW - ttW - 10);
      arrowClass = 'arrow-top';
      if (top + ttH > vH - 10) { top = rect.top - PAD - MARGEM - ttH; arrowClass = 'arrow-bottom'; }
      break;
    case 'top':
    default:
      top  = rect.top - PAD - MARGEM - ttH;
      left = Math.min(rect.left - PAD, vW - ttW - 10);
      arrowClass = 'arrow-bottom';
      if (top < 10) { top = rect.bottom + PAD + MARGEM; arrowClass = 'arrow-top'; }
      break;
  }

  // Garante que o tooltip não ultrapasse a tela verticalmente
  top  = Math.max(10, Math.min(top,  vH - ttH - 10));
  left = Math.max(10, Math.min(left, vW - ttW - 10));

  tooltip.style.top  = `${top}px`;
  tooltip.style.left = `${left}px`;
  tooltip.classList.add(arrowClass);

  // Fade in suave
  requestAnimationFrame(() => { tooltip.style.opacity = '1'; });

  /* ── Scroll para garantir que o elemento esteja visível ── */
  alvo.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

  /* ── Bindings dos botões do tooltip ── */
  $('tour-btn-pular').addEventListener('click', finalizarTour);
  $('tour-btn-proximo').addEventListener('click', () => renderizarPassoTour(index + 1));
  const btnAnterior = $('tour-btn-anterior');
  if (btnAnterior) btnAnterior.addEventListener('click', () => renderizarPassoTour(index - 1));

  state.tour.etapaAtual = index;
}

/** Remove todos os elementos visuais do tour */
function finalizarTour() {
  state.tour.ativa = false;
  const spotlight = $('tour-spotlight');
  const tooltip   = $('tour-tooltip');
  if (spotlight) spotlight.style.display = 'none';
  if (tooltip)   tooltip.style.display   = 'none';
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

  // Botão "?" flutuante — abre o mini-modal de ajuda
  $('btn-help-tutorial').addEventListener('click', (e) => {
    e.stopPropagation();
    const mini = $('modal-ajuda');
    if (mini) mini.classList.toggle('open');
  });

  // Mini-modal de ajuda: opção configuração
  document.addEventListener('click', (e) => {
    const mini = $('modal-ajuda');
    if (mini && !mini.contains(e.target) && e.target.id !== 'btn-help-tutorial') {
      mini.classList.remove('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.id === 'ajuda-btn-onboarding') {
      $('modal-ajuda').classList.remove('open');
      abrirOnboarding();
    }
    if (e.target.id === 'ajuda-btn-tour') {
      $('modal-ajuda').classList.remove('open');
      iniciarTour();
    }
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

  injetarEstilosTour(); // injeta CSS e elementos do tour guiado
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
