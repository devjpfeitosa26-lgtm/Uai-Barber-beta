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
  tour: { ativa: false, etapaAtual: 0 },
  online: navigator.onLine,   // ← rastreia conectividade
  recorrencia: {},             // ← MELHORIA 6: { whatsapp: totalConcluidos }
  relatorioFiltro: {           // ← MELHORIA 5: estado do filtro de período
    tipo: 'mes',               // 'semana' | 'mes' | 'custom'
    inicio: null,
    fim: null
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

/* ══════════════════════════════════════════════════════════════
   MELHORIA 3: OFFLINE GRACIOSO
   Monitora a conectividade e exibe/oculta uma barra de status.
   ══════════════════════════════════════════════════════════════ */

/**
 * Injeta a barra de status offline no topo da página e registra
 * os listeners de online/offline do navegador.
 */
function iniciarMonitorOffline() {
  // Cria a barra de status
  const barra = document.createElement('div');
  barra.id = 'offline-bar';
  barra.innerHTML = `
    <span id="offline-icon">📡</span>
    <span id="offline-msg">Sem conexão — tentando reconectar...</span>
    <span id="offline-spinner" class="offline-spinner"></span>
  `;
  document.body.prepend(barra);

  // Injeta os estilos da barra
  const style = document.createElement('style');
  style.textContent = `
    #offline-bar {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 9999;
      background: #1a0a0a;
      border-bottom: 1px solid rgba(239,68,68,0.4);
      color: #f87171;
      font-size: 13px;
      font-weight: 500;
      padding: 10px 20px;
      display: none;           /* oculto por padrão */
      align-items: center;
      gap: 10px;
      animation: slideDown 0.3s ease;
    }
    #offline-bar.visible { display: flex; }
    #offline-bar.reconnected {
      background: #0a1a0f;
      border-color: rgba(34,197,94,0.4);
      color: #4ade80;
    }
    @keyframes slideDown {
      from { transform: translateY(-100%); opacity: 0; }
      to   { transform: translateY(0);     opacity: 1; }
    }
    .offline-spinner {
      width: 14px; height: 14px;
      border: 2px solid rgba(248,113,113,0.3);
      border-top-color: #f87171;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: inline-block;
    }
    /* Empurra o conteúdo para baixo quando a barra estiver visível */
    body.is-offline .main,
    body.is-offline .sidebar { margin-top: 41px; }
  `;
  document.head.appendChild(style);

  // Listeners de conectividade
  window.addEventListener('offline', () => {
    state.online = false;
    document.body.classList.add('is-offline');
    const bar = $('offline-bar');
    bar.classList.remove('reconnected');
    bar.classList.add('visible');
    $('offline-icon').textContent = '📡';
    $('offline-msg').textContent  = 'Sem conexão — tentando reconectar...';
    $('offline-spinner').style.display = 'inline-block';
  });

  window.addEventListener('online', () => {
    state.online = true;
    const bar = $('offline-bar');
    bar.classList.add('reconnected');
    $('offline-icon').textContent = '✅';
    $('offline-msg').textContent  = 'Conexão restaurada!';
    $('offline-spinner').style.display = 'none';

    // Recarrega a agenda automaticamente ao voltar
    loadAgenda(state.currentDate);

    // Oculta a barra após 3s
    setTimeout(() => {
      bar.classList.remove('visible', 'reconnected');
      document.body.classList.remove('is-offline');
    }, 3000);
  });

  // Mostra imediatamente se já estiver offline ao carregar
  if (!navigator.onLine) {
    window.dispatchEvent(new Event('offline'));
  }
}


/* ══════════════════════════════════════════════════════════════
   MELHORIA 2: NOTIFICAÇÃO SONORA
   Gera um beep sintético via Web Audio API — sem arquivos externos.
   ══════════════════════════════════════════════════════════════ */

/**
 * Toca um som de notificação sutil usando o Web Audio API.
 * Dois tons ascendentes simulam um "ding" de boas-vindas.
 * Requer interação prévia do usuário para funcionar (limitação do browser).
 */
function tocarSomNotificacao() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Primeiro tom
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, ctx.currentTime);          // Lá5
    osc1.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.12); // sobe
    gain1.gain.setValueAtTime(0.25, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.35);

    // Segundo tom (ligeiro delay — efeito "ding-dong")
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1100, ctx.currentTime + 0.2);
    osc2.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.38);
    gain2.gain.setValueAtTime(0.18, ctx.currentTime + 0.2);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc2.start(ctx.currentTime + 0.2);
    osc2.stop(ctx.currentTime + 0.6);

    // Fecha o contexto após o som terminar para liberar recursos
    setTimeout(() => ctx.close(), 800);
  } catch (e) {
    // Falha silenciosa — não interrompe o fluxo se o browser bloquear
    console.warn('Som de notificação não disponível:', e.message);
  }
}


/* ══════════════════════════════════════════════════════════════
   MELHORIA 1: CONFIRMAÇÃO POR WHATSAPP
   Abre o wa.me com mensagem pré-preenchida para confirmar ou
   comunicar a conclusão do atendimento ao cliente.
   ══════════════════════════════════════════════════════════════ */

/**
 * Monta e abre o link do WhatsApp para o cliente.
 *
 * @param {string} whatsapp - Número do cliente (somente dígitos, com DDD)
 * @param {string} nome     - Nome do cliente para personalizar a mensagem
 * @param {string} horario  - ISO string do horário do agendamento
 * @param {'confirmado'|'concluido'} tipo - Tipo da mensagem
 */
function enviarWhatsApp(whatsapp, nome, horario, tipo) {
  // Normaliza o número: remove tudo que não é dígito e adiciona DDI 55
  const numero = '55' + whatsapp.replace(/\D/g, '');

  // Formata o horário de forma legível (ex: "14:30 de 28/05")
  const dt = new Date(horario);
  const horaFormatada = dt.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  });
  const dataFormatada = dt.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', timeZone: 'UTC'
  });

  // Mensagens pré-definidas por tipo de ação
  const mensagens = {
    confirmado: `Olá, ${nome}! ✂️ Seu agendamento para as *${horaFormatada}* do dia *${dataFormatada}* está confirmado. Aguardamos você! — UaiBarber`,
    concluido:  `Olá, ${nome}! 🙏 Obrigado pela visita de hoje (${dataFormatada}). Foi um prazer atendê-lo! Quando quiser marcar novamente, é só chamar. — UaiBarber`
  };

  const texto = encodeURIComponent(mensagens[tipo] || mensagens.confirmado);
  window.open(`https://wa.me/${numero}?text=${texto}`, '_blank');
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

  // ── MELHORIA 6: Conta visitas concluídas por whatsapp para badge de fidelidade ──
  // Busca TODOS os agendamentos concluídos (sem filtro de data) para medir recorrência real
  const whatsapps = [...new Set(appts?.map(a => a.whatsapp_cliente).filter(Boolean) || [])];
  if (whatsapps.length > 0) {
    const { data: historico } = await sb
      .from('agendamentos')
      .select('whatsapp_cliente')
      .eq('status', 'concluido')
      .in('whatsapp_cliente', whatsapps);

    state.recorrencia = {};
    (historico || []).forEach(a => {
      state.recorrencia[a.whatsapp_cliente] = (state.recorrencia[a.whatsapp_cliente] || 0) + 1;
    });
  } else {
    state.recorrencia = {};
  }

  renderTimeline();
}


/* ══════════════════════════════════════════════════════════════
   MELHORIA 4: INDICADOR DE HORÁRIOS LIVRES
   Calcula os gaps entre agendamentos/bloqueios e insere chips
   "Livre: HH:mm – HH:mm" na timeline.

   Lógica:
   - Considera o dia comercial entre HORA_INICIO_DIA e HORA_FIM_DIA
   - Usa a duração do serviço (duracao_minutos) para calcular o fim
     de cada agendamento — mesmo sem `horario_fim` na tabela
   - Gaps ≥ MIN_GAP_MINUTOS são exibidos como horários livres
   ══════════════════════════════════════════════════════════════ */

const HORA_INICIO_DIA  = 8;   // 08:00 — início do dia comercial
const HORA_FIM_DIA     = 20;  // 20:00 — fim do dia comercial
const MIN_GAP_MINUTOS  = 30;  // gap mínimo para exibir como "livre"

/**
 * Dado um agendamento ou bloqueio, retorna o horário de fim como objeto Date.
 * Para agendamentos, usa duracao_minutos do serviço associado.
 * Para bloqueios, usa o campo horario_fim já disponível.
 */
function calcularFimItem(item) {
  if (item.tipoItem === 'bloqueio') {
    return new Date(item.horario_fim);
  }
  const duracao = item.servicos?.duracao_minutos || 30; // fallback de 30 min
  const inicio = new Date(item.horario_inicio);
  return new Date(inicio.getTime() + duracao * 60 * 1000);
}

/**
 * Retorna um array de objetos { inicio: Date, fim: Date } representando
 * os intervalos livres do dia com base nos agendamentos e bloqueios.
 */
function calcularHorariosLivres(itensMesclados, dateRef) {
  if (itensMesclados.length === 0) return [];

  // Define início e fim do expediente para a data de referência
  const inicioDia = new Date(dateRef);
  inicioDia.setHours(HORA_INICIO_DIA, 0, 0, 0);
  const fimDia = new Date(dateRef);
  fimDia.setHours(HORA_FIM_DIA, 0, 0, 0);

  // Monta lista de intervalos ocupados com início e fim
  const ocupados = itensMesclados.map(item => ({
    inicio: new Date(item.horario_inicio),
    fim: calcularFimItem(item)
  })).sort((a, b) => a.inicio - b.inicio);

  const livres = [];
  let cursor = inicioDia;

  for (const slot of ocupados) {
    const gapMs = slot.inicio - cursor;
    const gapMin = gapMs / 60000;

    if (gapMin >= MIN_GAP_MINUTOS) {
      livres.push({ inicio: new Date(cursor), fim: new Date(slot.inicio) });
    }
    // Avança o cursor para o fim deste slot (sem voltar atrás)
    if (slot.fim > cursor) cursor = slot.fim;
  }

  // Verifica se há tempo livre no final do dia
  const gapFinalMin = (fimDia - cursor) / 60000;
  if (gapFinalMin >= MIN_GAP_MINUTOS) {
    livres.push({ inicio: new Date(cursor), fim: new Date(fimDia) });
  }

  return livres;
}

/**
 * Cria o elemento DOM de um chip de horário livre.
 */
function criarCardLivre(livre) {
  const inicioFmt = livre.inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fimFmt    = livre.fim.toLocaleTimeString('pt-BR',    { hour: '2-digit', minute: '2-digit' });
  const duracaoMin = Math.round((livre.fim - livre.inicio) / 60000);
  const duracaoFmt = duracaoMin >= 60
    ? `${Math.floor(duracaoMin / 60)}h${duracaoMin % 60 > 0 ? (duracaoMin % 60) + 'min' : ''}`
    : `${duracaoMin}min`;

  const chip = document.createElement('div');
  chip.className = 'free-slot-chip';
  chip.innerHTML = `
    <span class="free-slot-icon">🟢</span>
    <span class="free-slot-label">Livre: <strong>${inicioFmt} – ${fimFmt}</strong></span>
    <span class="free-slot-duration">${duracaoFmt} disponíveis</span>
  `;
  return chip;
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

  // ── MELHORIA 4: Calcula os horários livres ANTES de renderizar ──
  // Só exibe livres quando não há filtro ativo (para não confundir)
  const livres = state.filterStatus === 'todos'
    ? calcularHorariosLivres(itensMesclados, state.currentDate)
    : [];

  // Mescla itens ocupados e livres numa única lista ordenada por horário
  const todosItens = [
    ...itensMesclados.map(item => ({ tipo: 'ocupado', horario: new Date(item.horario_inicio), dados: item })),
    ...livres.map(livre => ({ tipo: 'livre', horario: livre.inicio, dados: livre }))
  ].sort((a, b) => a.horario - b.horario);

  todosItens.forEach(({ tipo, dados: item }) => {
    if (tipo === 'livre') {
      container.appendChild(criarCardLivre(item));
      return;
    }

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
      // ── MELHORIA 1: Botão WhatsApp no card do agendamento ──
      const podeEnviarWpp = item.status === 'confirmado' || item.status === 'pendente' || item.status === 'concluido';
      const tipoWpp = item.status === 'concluido' ? 'concluido' : 'confirmado';
      const tituloWpp = item.status === 'concluido'
        ? 'Enviar mensagem de agradecimento'
        : 'Enviar confirmação por WhatsApp';

      // ── MELHORIA 6: Badge de cliente recorrente ──
      const visitas = state.recorrencia[item.whatsapp_cliente] || 0;
      let badgeFidelidade = '';
      if (visitas >= 10)     badgeFidelidade = `<span class="badge-fiel badge-fiel-ouro"   title="${visitas} visitas concluídas">💎 VIP</span>`;
      else if (visitas >= 5) badgeFidelidade = `<span class="badge-fiel badge-fiel-prata"  title="${visitas} visitas concluídas">⭐ Fiel</span>`;
      else if (visitas >= 2) badgeFidelidade = `<span class="badge-fiel badge-fiel-bronze" title="${visitas} visitas concluídas">↩ Voltou</span>`;

      card.innerHTML = `
        <div class="appt-time">⏰ ${fmt.time(item.horario_inicio)}</div>
        <div class="appt-info-main">
          <div class="appt-client-name">${item.nome_cliente} ${badgeFidelidade}</div>
          <div class="appt-service-tag">${item.servicos?.nome || 'Serviço não identificado'} — <span style="color:var(--gold-light); font-weight:600;">${fmt.brl(item.servicos?.preco)}</span></div>
        </div>
        <div class="appt-actions-cell">
          <span class="pill pill-${item.status}">${item.status}</span>
          ${podeEnviarWpp ? `
            <button class="btn-icon btn-wpp"
              title="${tituloWpp}"
              onclick="enviarWhatsApp('${item.whatsapp_cliente}', '${item.nome_cliente.replace(/'/g, "\\'")}', '${item.horario_inicio}', '${tipoWpp}'); event.stopPropagation();">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            </button>
          ` : ''}
          ${item.status === 'confirmado' || item.status === 'pendente' ? `
            <button class="btn-icon" style="color:var(--success);" title="Concluir Atendimento" onclick="alterarStatus('${item.id}', 'concluido', event)">✔</button>
            <button class="btn-icon" style="color:#60a5fa;" title="Remarcar Agendamento" onclick="abrirRemarcar('${item.id}', '${item.horario_inicio}', event)">📅</button>
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

/* ══════════════════════════════════════════════════════════════
   MELHORIA 5: RELATÓRIO FINANCEIRO COM FILTRO DE PERÍODO
   ══════════════════════════════════════════════════════════════ */

/**
 * Calcula o intervalo de datas de acordo com o filtro ativo em state.relatorioFiltro.
 * Retorna { inicio: Date, fim: Date } já com hora 00:00 e 23:59 respectivos.
 */
function calcularIntervaloRelatorio() {
  const hoje = new Date();
  const tipo = state.relatorioFiltro.tipo;

  if (tipo === 'semana') {
    // Semana atual: segunda-feira até domingo
    const diaSemana = hoje.getDay(); // 0=dom, 1=seg...
    const diasAteSeg = diaSemana === 0 ? 6 : diaSemana - 1;
    const seg = new Date(hoje);
    seg.setDate(hoje.getDate() - diasAteSeg);
    seg.setHours(0, 0, 0, 0);
    const dom = new Date(seg);
    dom.setDate(seg.getDate() + 6);
    dom.setHours(23, 59, 59, 999);
    return { inicio: seg, fim: dom };
  }

  if (tipo === 'mes') {
    // Mês corrente: dia 1 até último dia
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0);
    const fim    = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999);
    return { inicio, fim };
  }

  if (tipo === 'custom' && state.relatorioFiltro.inicio && state.relatorioFiltro.fim) {
    const inicio = new Date(state.relatorioFiltro.inicio + 'T00:00:00');
    const fim    = new Date(state.relatorioFiltro.fim    + 'T23:59:59');
    return { inicio, fim };
  }

  // Fallback: mês corrente
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0);
  const fim    = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999);
  return { inicio, fim };
}

/**
 * Atualiza os chips de período e os inputs de data customizados,
 * depois dispara a renderização do relatório.
 */
function aplicarFiltroRelatorio(tipo) {
  state.relatorioFiltro.tipo = tipo;

  // Atualiza chips ativos
  document.querySelectorAll('.periodo-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.periodo === tipo);
  });

  // Mostra/oculta inputs de período customizado
  const customRow = $('rep-custom-periodo');
  if (customRow) customRow.style.display = tipo === 'custom' ? 'flex' : 'none';

  renderizarRelatoriosVisuais();
}

/**
 * Renderiza métricas e gráficos filtrados pelo período selecionado.
 */
async function renderizarRelatoriosVisuais() {
  const { inicio, fim } = calcularIntervaloRelatorio();

  // Busca apenas os agendamentos dentro do período selecionado
  const { data: appts, error } = await sb
    .from('agendamentos')
    .select('*, servicos(*)')
    .gte('horario_inicio', inicio.toISOString())
    .lte('horario_inicio', fim.toISOString());

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
  const nomesServicos = Object.keys(contagemServicos);
  const servicoMaisVendido = nomesServicos.length > 0
    ? nomesServicos.reduce((a, b) => contagemServicos[a] > contagemServicos[b] ? a : b)
    : '-';

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
      labels: nomesServicos.length > 0 ? nomesServicos : ['Sem dados'],
      datasets: [{
        data: nomesServicos.length > 0 ? Object.values(contagemServicos) : [1],
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

/* ══════════════════════════════════════════════════════════════
   MELHORIA 5: REMARCAR AGENDAMENTO
   Abre um modal com o horário atual pré-preenchido.
   O barbeiro escolhe o novo horário e confirma — faz UPDATE no Supabase.
   ══════════════════════════════════════════════════════════════ */

/**
 * Abre o modal de reagendamento com o horário atual pré-preenchido.
 * @param {string} id          - UUID do agendamento
 * @param {string} horarioISO  - ISO string do horário atual
 * @param {Event}  event       - Evento do clique (para stopPropagation)
 */
function abrirRemarcar(id, horarioISO, event) {
  if (event) event.stopPropagation();

  // Converte ISO → formato datetime-local (YYYY-MM-DDTHH:mm)
  // O horário está em UTC, converte para local para exibição no input
  const dt = new Date(horarioISO);
  const pad = n => String(n).padStart(2, '0');
  const localStr = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

  $('remarcar-id').value      = id;
  $('remarcar-horario').value = localStr;
  setFeedback('remarcar-feedback', '', '');
  $('modal-remarcar').classList.add('open');
}

/**
 * Salva o novo horário do agendamento.
 * Valida que o horário não está no passado e atualiza no Supabase.
 */
async function salvarRemarcar() {
  const id      = $('remarcar-id').value;
  const horario = $('remarcar-horario').value;

  if (!horario) {
    setFeedback('remarcar-feedback', 'Selecione o novo horário.', 'error');
    return;
  }

  const novoHorario = new Date(horario);
  if (novoHorario < new Date()) {
    setFeedback('remarcar-feedback', 'Não é possível remarcar para um horário já passado.', 'error');
    return;
  }

  const btn = $('btn-salvar-remarcar');
  btn.textContent = 'Salvando...';
  btn.disabled = true;

  const { error } = await sb
    .from('agendamentos')
    .update({ horario_inicio: novoHorario.toISOString() })
    .eq('id', id);

  btn.textContent = 'Confirmar Remarcação';
  btn.disabled = false;

  if (error) {
    setFeedback('remarcar-feedback', 'Erro ao remarcar: ' + error.message, 'error');
  } else {
    setFeedback('remarcar-feedback', '✔ Remarcado com sucesso!', 'success');
    setTimeout(() => {
      $('modal-remarcar').classList.remove('open');
      loadAgenda(state.currentDate);
    }, 900);
  }
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
   ══════════════════════════════════════════════════════════════ */

function gerarLinkBot(userId) {
  const slug = userId.replace(/-/g, '').substring(0, 10);
  return `https://uaibarber.app/bot/${slug}`;
}

function irParaEtapaOnb(etapa) {
  state.onboarding.etapaAtual = etapa;
  document.querySelectorAll('.onb-slide').forEach(el => { el.style.display = 'none'; });
  const alvo = $(`onb-step-${etapa}`);
  if (alvo) alvo.style.display = 'block';
}

function abrirOnboarding() {
  if (state.profissional?.nome) {
    $('onb-input-nome').value = state.profissional.nome;
  } else {
    $('onb-input-nome').value = '';
  }
  $('onb-input-servnome').value    = '';
  $('onb-input-servpreco').value   = '';
  $('onb-input-servduracao').value = '';
  ['onb-feedback-1', 'onb-feedback-2', 'onb-feedback-3'].forEach(id => { setFeedback(id, '', ''); });
  irParaEtapaOnb(1);
  $('modal-onboarding').classList.add('open');
}

async function onbSalvarNome() {
  const nome = $('onb-input-nome').value.trim();
  if (!nome) {
    setFeedback('onb-feedback-1', 'Por favor, informe o nome da barbearia.', 'error');
    return;
  }

  const btn = $('onb-btn-proximo-1');
  btn.textContent = 'Salvando...';
  btn.disabled = true;

  const { error } = await sb
    .from('profissionais')
    .upsert({ id: state.user.id, nome: nome }, { onConflict: 'id' });

  btn.textContent = 'Avançar: Configurar Catálogo →';
  btn.disabled = false;

  if (error) {
    setFeedback('onb-feedback-1', 'Erro ao salvar: ' + error.message, 'error');
    return;
  }

  await loadProfissional();

  if (!state.profissional) {
    setFeedback('onb-feedback-1', 'Não foi possível confirmar o cadastro. Tente novamente.', 'error');
    return;
  }

  state.onboarding.nomeTemp = nome;
  $('prof-name').textContent = nome;
  $('prof-avatar').textContent = nome.charAt(0).toUpperCase();

  irParaEtapaOnb(2);
}

async function onbSalvarServico() {
  const nome    = $('onb-input-servnome').value.trim();
  const preco   = $('onb-input-servpreco').value;
  const duracao = $('onb-input-servduracao').value;

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

  await loadServicos();
  $('onb-input-linkbot').value = gerarLinkBot(state.user.id);
  irParaEtapaOnb(3);
}

async function onbCopiarLink() {
  const link = $('onb-input-linkbot').value;
  try {
    await navigator.clipboard.writeText(link);
    setFeedback('onb-feedback-3', '✔ Link copiado! Cole no seu Instagram ou WhatsApp.', 'success');
    $('onb-btn-copiar').textContent = '✔ Copiado';
    setTimeout(() => { $('onb-btn-copiar').textContent = 'Copiar'; }, 2500);
  } catch {
    $('onb-input-linkbot').select();
    document.execCommand('copy');
    setFeedback('onb-feedback-3', '✔ Link copiado com sucesso!', 'success');
  }
}

function onbFinalizar() {
  localStorage.setItem(`uaibarber_onb_done_${state.user.id}`, '1');
  $('modal-onboarding').classList.remove('open');
  loadAgenda(state.currentDate);
  setTimeout(iniciarTour, 500);
}

function verificarOnboarding() {
  const jaFezOnboarding = localStorage.getItem(`uaibarber_onb_done_${state.user.id}`);
  const semServicos = state.servicos.length === 0;
  if (!jaFezOnboarding || semServicos) {
    setTimeout(abrirOnboarding, 400);
  }
}


/* ══════════════════════════════════════════════════════════════
   ────── TOUR GUIADO DA INTERFACE ────────────────────────────
   ══════════════════════════════════════════════════════════════ */

const TOUR_PASSOS = [
  {
    selector: '[data-target="view-agenda"]',
    titulo: '📅 Agenda do Dia',
    texto: 'Este é o coração do seu painel. Aqui você vê todos os agendamentos e bloqueios do dia, organizados por horário. Clique em qualquer card para ver o histórico completo do cliente.',
    posicao: 'right'
  },
  {
    selector: '.agenda-header',
    titulo: '📆 Navegação de Datas',
    texto: 'Use as setas para avançar ou voltar entre os dias e consultar a agenda de qualquer data. Os filtros ao lado deixam você ver só os agendamentos confirmados, concluídos ou cancelados.',
    posicao: 'bottom'
  },
  {
    selector: '#btn-new-appt',
    titulo: '➕ Novo Agendamento',
    texto: 'Clique aqui para cadastrar um agendamento manual — para clientes que ligam, mandam mensagem ou aparecem pessoalmente. Basta preencher nome, WhatsApp, serviço e horário.',
    posicao: 'left'
  },
  {
    selector: '#btn-open-bloqueio',
    titulo: '🔒 Bloquear Horário',
    texto: 'Precisa de uma pausa? Bloqueie faixas de horário para almoço, folga ou férias. O robô de agendamento não vai marcar nenhum cliente nesse intervalo.',
    posicao: 'left'
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

function injetarEstilosTour() {
  if ($('tour-styles')) return;
  const style = document.createElement('style');
  style.id = 'tour-styles';
  style.textContent = `
    /* ── Badges de fidelidade (MELHORIA 6) ── */
    .badge-fiel {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 7px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.3px;
      vertical-align: middle;
      margin-left: 6px;
    }
    .badge-fiel-bronze {
      background: rgba(180,120,60,0.15);
      color: #cd7f32;
      border: 1px solid rgba(205,127,50,0.3);
    }
    .badge-fiel-prata {
      background: rgba(201,147,58,0.15);
      color: var(--gold-light);
      border: 1px solid rgba(201,147,58,0.35);
    }
    .badge-fiel-ouro {
      background: rgba(99,179,237,0.12);
      color: #90cdf4;
      border: 1px solid rgba(99,179,237,0.3);
    }

    /* ── Filtro de período nos relatórios (MELHORIA 5) ── */
    .periodo-filtros {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .periodo-chip {
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 7px 14px;
      border-radius: var(--radius);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .periodo-chip:hover { background: rgba(255,255,255,0.07); color: var(--text); }
    .periodo-chip.active {
      background: var(--gold-dim);
      border-color: rgba(201,147,58,0.3);
      color: var(--gold-light);
      font-weight: 600;
    }
    #rep-custom-periodo {
      display: none;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    #rep-custom-periodo input[type="date"] {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 7px 12px;
      border-radius: var(--radius);
      font-family: inherit;
      font-size: 12px;
    }
    #rep-custom-periodo input[type="date"]:focus { border-color: var(--gold); outline: none; }
    #rep-custom-periodo .btn-primary { padding: 7px 14px; font-size: 12px; }

    /* ── Free Slot Chips (MELHORIA 4) ── */
    .free-slot-chip {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      border-radius: var(--radius);
      border: 1px dashed rgba(34,197,94,0.25);
      background: rgba(34,197,94,0.04);
      font-size: 13px;
      color: var(--muted);
      cursor: default;
      transition: background 0.2s;
    }
    .free-slot-chip:hover {
      background: rgba(34,197,94,0.07);
    }
    .free-slot-icon { font-size: 14px; }
    .free-slot-label { flex: 1; }
    .free-slot-label strong { color: #4ade80; font-weight: 600; }
    .free-slot-duration {
      font-size: 11px;
      font-weight: 600;
      color: rgba(74,222,128,0.6);
      background: rgba(34,197,94,0.08);
      padding: 3px 8px;
      border-radius: 20px;
      white-space: nowrap;
    }

    /* ── Botão WhatsApp (MELHORIA 1) ── */
    .btn-wpp {
      color: #25D366 !important;
      transition: transform 0.15s, color 0.15s;
    }
    .btn-wpp:hover {
      transform: scale(1.15);
      color: #4ade80 !important;
    }

    /* ── Tour Overlay e Spotlight ── */
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
    .tour-counter { font-size: 11px; font-weight: 600; color: #c9933a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .tour-titulo { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; color: #eef0f4; margin-bottom: 8px; }
    .tour-texto { font-size: 13px; color: #8896a8; line-height: 1.55; margin-bottom: 16px; }
    .tour-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .tour-btn-pular { background: none; border: none; color: #6b7a94; font-size: 12px; cursor: pointer; padding: 4px 0; text-decoration: underline; }
    .tour-btn-pular:hover { color: #ef4444; }
    .tour-nav-right { display: flex; gap: 8px; }
    .tour-btn-nav { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12); color: #eef0f4; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; transition: background 0.2s; }
    .tour-btn-nav:hover { background: rgba(255,255,255,0.08); }
    .tour-btn-nav.primary { background: #c9933a; border-color: #c9933a; color: #000; font-weight: 600; }
    .tour-btn-nav.primary:hover { background: #e8b56a; }
    #modal-ajuda {
      position: fixed; bottom: 84px; right: 24px;
      background: #0f1520; border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px; padding: 14px; width: 240px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.7);
      z-index: 1000; display: none; flex-direction: column; gap: 8px;
    }
    #modal-ajuda.open { display: flex; }
    #modal-ajuda h5 { font-size: 11px; font-weight: 600; color: #6b7a94; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .ajuda-opcao { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: #eef0f4; padding: 10px 12px; border-radius: 7px; font-size: 13px; font-weight: 500; cursor: pointer; text-align: left; transition: background 0.2s, border-color 0.2s; }
    .ajuda-opcao:hover { background: rgba(201,147,58,0.1); border-color: rgba(201,147,58,0.3); }

    /* ── Spinner genérico ── */
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);

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

function iniciarTour() {
  const miniModal = $('modal-ajuda');
  if (miniModal) miniModal.classList.remove('open');
  state.tour.ativa = true;
  state.tour.etapaAtual = 0;
  renderizarPassoTour(0);
}

function renderizarPassoTour(index) {
  const passo = TOUR_PASSOS[index];
  if (!passo) { finalizarTour(); return; }

  const alvo = document.querySelector(passo.selector);
  if (!alvo) { renderizarPassoTour(index + 1); return; }

  const spotlight  = $('tour-spotlight');
  const tooltip    = $('tour-tooltip');
  const rect       = alvo.getBoundingClientRect();
  const PAD        = 6;
  const MARGEM     = 14;

  spotlight.style.display = 'block';
  spotlight.style.top     = `${rect.top    - PAD}px`;
  spotlight.style.left    = `${rect.left   - PAD}px`;
  spotlight.style.width   = `${rect.width  + PAD * 2}px`;
  spotlight.style.height  = `${rect.height + PAD * 2}px`;

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

  const ttW = 300;
  const ttH = tooltip.offsetHeight || 180;
  const vW  = window.innerWidth;
  const vH  = window.innerHeight;

  let top, left, arrowClass;

  switch (passo.posicao) {
    case 'right':
      left = rect.right + PAD + MARGEM;
      top  = rect.top + PAD;
      arrowClass = 'arrow-left';
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

  top  = Math.max(10, Math.min(top,  vH - ttH - 10));
  left = Math.max(10, Math.min(left, vW - ttW - 10));

  tooltip.style.top  = `${top}px`;
  tooltip.style.left = `${left}px`;
  tooltip.classList.add(arrowClass);

  requestAnimationFrame(() => { tooltip.style.opacity = '1'; });

  alvo.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

  $('tour-btn-pular').addEventListener('click', finalizarTour);
  $('tour-btn-proximo').addEventListener('click', () => renderizarPassoTour(index + 1));
  const btnAnterior = $('tour-btn-anterior');
  if (btnAnterior) btnAnterior.addEventListener('click', () => renderizarPassoTour(index - 1));

  state.tour.etapaAtual = index;
}

function finalizarTour() {
  state.tour.ativa = false;
  const spotlight = $('tour-spotlight');
  const tooltip   = $('tour-tooltip');
  if (spotlight) spotlight.style.display = 'none';
  if (tooltip)   tooltip.style.display   = 'none';
}

/* ────── EVENT BINDINGS ────── */
function updateDateLabel() {
  $('current-date-lbl').textContent = state.currentDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function bindEvents() {
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

  $('btn-prev-day').addEventListener('click', () => { state.currentDate.setDate(state.currentDate.getDate() - 1); updateDateLabel(); loadAgenda(state.currentDate); });
  $('btn-next-day').addEventListener('click', () => { state.currentDate.setDate(state.currentDate.getDate() + 1); updateDateLabel(); loadAgenda(state.currentDate); });

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

  // ── MELHORIA 5: Modal de Remarcar ──
  $('btn-cancelar-remarcar').addEventListener('click', () => $('modal-remarcar').classList.remove('open'));
  $('btn-salvar-remarcar').addEventListener('click', salvarRemarcar);

  // ── MELHORIA 5: Filtros de período nos relatórios ──
  document.querySelectorAll('.periodo-chip').forEach(chip => {
    chip.addEventListener('click', () => aplicarFiltroRelatorio(chip.dataset.periodo));
  });
  $('rep-btn-aplicar-custom')?.addEventListener('click', () => {
    const ini = $('rep-custom-inicio').value;
    const fim = $('rep-custom-fim').value;
    if (!ini || !fim) return;
    if (new Date(ini) > new Date(fim)) {
      alert('A data de início deve ser anterior à data de fim.');
      return;
    }
    state.relatorioFiltro.inicio = ini;
    state.relatorioFiltro.fim    = fim;
    renderizarRelatoriosVisuais();
  });

  $('mobile-menu-btn').addEventListener('click', () => { $('sidebar').classList.add('open'); $('sidebar-overlay').style.display = 'block'; });
  $('sidebar-overlay').addEventListener('click', closeSidebar);

  $('btn-renew-sub')?.addEventListener('click', () => {
    window.open('https://wa.me/?text=Olá! Gostaria de renovar minha assinatura UaiBarber.', '_blank');
  });

  $('onb-btn-proximo-1').addEventListener('click', onbSalvarNome);
  $('onb-input-nome').addEventListener('keydown', e => { if (e.key === 'Enter') onbSalvarNome(); });
  $('onb-btn-proximo-2').addEventListener('click', onbSalvarServico);
  $('onb-btn-copiar').addEventListener('click', onbCopiarLink);
  $('onb-btn-finalizar').addEventListener('click', onbFinalizar);

  $('btn-help-tutorial').addEventListener('click', (e) => {
    e.stopPropagation();
    const mini = $('modal-ajuda');
    if (mini) mini.classList.toggle('open');
  });

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

  $('modal-onboarding').addEventListener('click', e => {
    if (e.target === $('modal-onboarding')) {
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
        // ── MELHORIA 2: Toca o som de notificação ──
        tocarSomNotificacao();

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

  injetarEstilosTour();
  iniciarMonitorOffline(); // ← MELHORIA 3: inicia monitor de conectividade
  bindEvents();
  updateDateLabel();

  try {
    await loadProfissional();
    await loadServicos();
    await loadAgenda(state.currentDate);
    startRealtime();
    verificarOnboarding();
  } catch (e) {
    console.error('Erro na inicialização do painel:', e);
  }
}

window.addEventListener('DOMContentLoaded', init);
