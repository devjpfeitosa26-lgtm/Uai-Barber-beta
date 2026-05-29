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
  online: navigator.onLine,
  recorrencia: {},
  relatorioFiltro: {
    tipo: 'mes',
    inicio: null,
    fim: null
  },
  // Contexto do agendamento alvo do modal de WhatsApp
  wppModal: {
    appt: null
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
   NOVO: MODAL DE MENSAGENS WHATSAPP COM TEMPLATES
   Permite ao barbeiro escolher o tipo de mensagem, editar o
   texto e disparar direto para o cliente com um clique.
   ══════════════════════════════════════════════════════════════ */

/**
 * Templates de mensagem por ação.
 * Cada template recebe { nome, horario (Date), servico, barbearia } e retorna o texto.
 */
const WPP_TEMPLATES = {
  confirmar: {
    emoji: '✅',
    label: 'Confirmação de Agendamento',
    cor: '#22c55e',
    gerar: ({ nome, horario, servico, barbearia }) => {
      const h = horario.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      const d = horario.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
      return `Olá, ${nome}! ✂️\n\nSeu agendamento está *confirmado*:\n\n📅 Data: *${d}*\n🕐 Horário: *${h}*\n💈 Serviço: *${servico}*\n\nAguardamos você! Qualquer dúvida, é só chamar. 😊\n\n— *${barbearia}*`;
    }
  },
  remarcar: {
    emoji: '📅',
    label: 'Reagendamento',
    cor: '#60a5fa',
    gerar: ({ nome, horario, servico, barbearia }) => {
      const h = horario.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      const d = horario.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
      return `Olá, ${nome}! 📅\n\nPassando para informar que seu agendamento foi *remarcado*:\n\n📅 Nova data: *${d}*\n🕐 Novo horário: *${h}*\n💈 Serviço: *${servico}*\n\nPedimos desculpas pelo inconveniente. Qualquer dúvida, estamos à disposição! 🙏\n\n— *${barbearia}*`;
    }
  },
  cancelar: {
    emoji: '❌',
    label: 'Cancelamento',
    cor: '#ef4444',
    gerar: ({ nome, horario, servico, barbearia }) => {
      const d = horario.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
      return `Olá, ${nome}! ❌\n\nInfelizmente precisamos *cancelar* seu agendamento do dia *${d}* (${servico}).\n\nPedimos desculpas pelo transtorno. Entre em contato para remarcar em outro horário disponível! 📞\n\n— *${barbearia}*`;
    }
  },
  concluido: {
    emoji: '🙏',
    label: 'Agradecimento Pós-Atendimento',
    cor: '#c9933a',
    gerar: ({ nome, horario, barbearia }) => {
      const d = horario.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
      return `Olá, ${nome}! 🙏\n\nObrigado pela sua visita hoje (${d})! Foi um prazer atendê-lo.\n\n⭐ Se curtiu o serviço, indique para os amigos!\n\nQualquer hora que quiser marcar novamente, é só chamar. Estamos sempre aqui pra deixar você em dia! ✂️\n\n— *${barbearia}*`;
    }
  },
  lembrete: {
    emoji: '🔔',
    label: 'Lembrete de Agendamento',
    cor: '#a855f7',
    gerar: ({ nome, horario, servico, barbearia }) => {
      const h = horario.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      const d = horario.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
      return `Olá, ${nome}! 🔔\n\nPassando para *lembrar* do seu agendamento:\n\n📅 Data: *${d}*\n🕐 Horário: *${h}*\n💈 Serviço: *${servico}*\n\nTe esperamos! Caso precise cancelar ou remarcar, avise com antecedência. 😉\n\n— *${barbearia}*`;
    }
  },
  personalizado: {
    emoji: '✏️',
    label: 'Mensagem Personalizada',
    cor: '#8896a8',
    gerar: ({ nome }) => `Olá, ${nome}! `
  }
};

/**
 * Abre o modal de WhatsApp para o agendamento informado.
 * @param {Object} appt - Objeto completo do agendamento (com servicos aninhado)
 * @param {Event}  event
 */
function abrirModalWhatsApp(appt, event) {
  if (event) event.stopPropagation();
  state.wppModal.appt = appt;

  // Seleciona template padrão com base no status atual
  const templatePadrao = appt.status === 'concluido' ? 'concluido' : 'confirmar';
  renderizarModalWpp(templatePadrao);
  $('modal-wpp').classList.add('open');
}

/**
 * Renderiza o conteúdo do modal de WhatsApp com o template selecionado.
 */
function renderizarModalWpp(tipoTemplate) {
  const appt       = state.wppModal.appt;
  if (!appt) return;

  const horario    = new Date(appt.horario_inicio);
  const nome       = appt.nome_cliente;
  const servico    = appt.servicos?.nome || 'Serviço';
  const barbearia  = state.profissional?.nome || 'UaiBarber';
  const template   = WPP_TEMPLATES[tipoTemplate];

  // Gera o texto
  const textoGerado = template.gerar({ nome, horario, servico, barbearia });

  // Atualiza chips de seleção
  document.querySelectorAll('.wpp-template-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.template === tipoTemplate);
  });

  // Atualiza área de texto
  const textarea = $('wpp-texto-mensagem');
  if (textarea) {
    textarea.value = textoGerado;
    textarea.style.borderColor = template.cor + '55';
    atualizarPreviewWpp();
  }

  // Atualiza título do tipo selecionado
  const lblTipo = $('wpp-tipo-selecionado');
  if (lblTipo) {
    lblTipo.textContent = `${template.emoji} ${template.label}`;
    lblTipo.style.color = template.cor;
  }
}

/**
 * Atualiza o preview do texto (converte *negrito* para <strong>).
 */
function atualizarPreviewWpp() {
  const textarea = $('wpp-texto-mensagem');
  const preview  = $('wpp-preview');
  if (!textarea || !preview) return;

  const texto = textarea.value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  preview.innerHTML = texto;
}

/**
 * Abre o WhatsApp com o texto atual do textarea.
 */
function dispararMensagemWpp() {
  const appt   = state.wppModal.appt;
  const texto  = $('wpp-texto-mensagem')?.value?.trim();
  if (!appt || !texto) return;

  const numero = '55' + appt.whatsapp_cliente.replace(/\D/g, '');
  const url    = `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
  window.open(url, '_blank');

  // Feedback visual e fecha o modal após 1s
  const btn = $('btn-wpp-enviar');
  btn.textContent = '✔ Abrindo WhatsApp...';
  btn.disabled = true;
  setTimeout(() => {
    $('modal-wpp').classList.remove('open');
    btn.textContent = 'Enviar pelo WhatsApp';
    btn.disabled = false;
  }, 1200);
}

/**
 * Injeta o modal de WhatsApp no DOM (chamado uma vez em init).
 */
function injetarModalWhatsApp() {
  const chips = Object.entries(WPP_TEMPLATES).map(([key, t]) => `
    <button class="wpp-template-chip" data-template="${key}" style="--chip-cor: ${t.cor}">
      <span class="wpp-chip-emoji">${t.emoji}</span>
      <span class="wpp-chip-label">${t.label}</span>
    </button>
  `).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'modal-wpp';
  modal.innerHTML = `
    <div class="modal-box" style="width: min(100% - 32px, 620px); padding: 0; overflow: hidden; border-color: rgba(37,211,102,0.2);">
      <!-- Cabeçalho verde WhatsApp -->
      <div style="background: linear-gradient(135deg, #075E54, #128C7E); padding: 20px 24px; display: flex; align-items: center; gap: 12px;">
        <div style="width: 38px; height: 38px; background: rgba(255,255,255,0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        </div>
        <div style="flex: 1;">
          <div style="font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 700; color: #fff;" id="wpp-modal-cliente-nome">Cliente</div>
          <div style="font-size: 12px; color: rgba(255,255,255,0.7);" id="wpp-modal-cliente-num">--</div>
        </div>
        <button onclick="$('modal-wpp').classList.remove('open')" style="background: rgba(255,255,255,0.1); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;">✕</button>
      </div>

      <!-- Corpo -->
      <div style="padding: 20px 24px 24px;">
        <!-- Chips de template -->
        <div style="margin-bottom: 16px;">
          <div style="font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;">Tipo de mensagem</div>
          <div class="wpp-chips-grid">${chips}</div>
        </div>

        <!-- Tipo selecionado -->
        <div id="wpp-tipo-selecionado" style="font-size: 12px; font-weight: 600; margin-bottom: 8px; transition: color 0.2s;">✅ Confirmação</div>

        <!-- Layout duas colunas: edição + preview -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start;">
          <!-- Coluna esquerda: editar -->
          <div>
            <div style="font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Editar mensagem</div>
            <textarea
              id="wpp-texto-mensagem"
              rows="10"
              oninput="atualizarPreviewWpp()"
              style="
                width: 100%; background: var(--bg); border: 1px solid var(--border-2);
                color: var(--text); padding: 12px; border-radius: var(--radius);
                font-family: 'DM Sans', sans-serif; font-size: 13px; line-height: 1.55;
                resize: vertical; transition: border-color 0.2s;
              "
            ></textarea>
            <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">Use *texto* para negrito no WhatsApp</div>
          </div>

          <!-- Coluna direita: preview WhatsApp -->
          <div>
            <div style="font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Preview</div>
            <div style="
              background: #0b1419;
              border-radius: var(--radius);
              padding: 12px;
              min-height: 180px;
              background-image: url('https://i.imgur.com/BPfVrVi.png');
              background-size: 300px;
              background-blend-mode: overlay;
              position: relative;
            ">
              <div style="
                background: #1f2c34;
                border-radius: 8px 8px 8px 0;
                padding: 10px 12px;
                font-size: 12.5px;
                line-height: 1.55;
                color: #e9edef;
                max-width: 85%;
                box-shadow: 0 1px 2px rgba(0,0,0,0.4);
                position: relative;
              ">
                <div id="wpp-preview" style="word-break: break-word;"></div>
                <div style="font-size: 10px; color: rgba(255,255,255,0.35); text-align: right; margin-top: 6px;">agora ✓✓</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Rodapé com botões -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 18px; flex-wrap: wrap; gap: 10px;">
          <div style="font-size: 12px; color: var(--muted);">
            📱 Abre o WhatsApp com a mensagem pronta — só clicar em Enviar.
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn-secondary" onclick="$('modal-wpp').classList.remove('open')" style="font-size: 13px; padding: 10px 16px;">Cancelar</button>
            <button class="btn-primary" id="btn-wpp-enviar" onclick="dispararMensagemWpp()" style="background: #25D366; font-size: 13px; padding: 10px 20px; gap: 8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Enviar pelo WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Delegação de evento para os chips de template
  modal.addEventListener('click', e => {
    const chip = e.target.closest('.wpp-template-chip');
    if (chip) renderizarModalWpp(chip.dataset.template);
  });

  // Injeta estilos dos chips
  const style = document.createElement('style');
  style.textContent = `
    .wpp-chips-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .wpp-template-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 12px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.03);
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.18s;
      font-family: 'DM Sans', sans-serif;
    }
    .wpp-template-chip:hover {
      background: rgba(255,255,255,0.06);
      color: var(--text);
      border-color: var(--border-2);
    }
    .wpp-template-chip.active {
      background: rgba(37,211,102,0.1);
      border-color: rgba(37,211,102,0.35);
      color: #4ade80;
      font-weight: 600;
    }
    .wpp-chip-emoji { font-size: 13px; }
    @media (max-width: 768px) {
      #modal-wpp .modal-box > div:last-child > div:nth-child(3) {
        grid-template-columns: 1fr !important;
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Abre o modal WPP e pré-seleciona o template correto,
 * atualizando nome e número do cliente no cabeçalho.
 */
function abrirModalWhatsApp(appt, event) {
  if (event) event.stopPropagation();
  state.wppModal.appt = appt;

  // Atualiza cabeçalho do modal
  const nomeEl = $('wpp-modal-cliente-nome');
  const numEl  = $('wpp-modal-cliente-num');
  if (nomeEl) nomeEl.textContent = appt.nome_cliente;
  if (numEl)  numEl.textContent  = appt.whatsapp_cliente || '(sem número)';

  // Template padrão por status
  const templatePadrao =
    appt.status === 'concluido'  ? 'concluido'  :
    appt.status === 'cancelado'  ? 'cancelar'   :
    'confirmar';

  renderizarModalWpp(templatePadrao);
  $('modal-wpp').classList.add('open');
}


/* ══════════════════════════════════════════════════════════════
   NOVO: VALIDAÇÃO DE CONFLITO DE HORÁRIO
   Verifica se o horário selecionado sobrepõe agendamentos
   existentes ou bloqueios antes de criar o agendamento.
   ══════════════════════════════════════════════════════════════ */

/**
 * Verifica se um horário proposto conflita com agendamentos ou bloqueios existentes.
 * @param {Date}   horarioInicio   - Início do novo agendamento
 * @param {number} duracaoMinutos  - Duração do serviço selecionado
 * @param {string} [excluirId]     - ID do agendamento a ignorar (ex: ao remarcar)
 * @returns {Promise<{conflito: boolean, mensagem: string}>}
 */
async function verificarConflitoHorario(horarioInicio, duracaoMinutos, excluirId = null) {
  const horarioFim = new Date(horarioInicio.getTime() + duracaoMinutos * 60 * 1000);

  // Busca agendamentos ativos que se sobrepõem ao intervalo
  let queryAppts = sb
    .from('agendamentos')
    .select('id, nome_cliente, horario_inicio, servicos(nome, duracao_minutos)')
    .in('status', ['pendente', 'confirmado'])
    // Overlap: início existente < fim novo E fim existente > início novo
    .lt('horario_inicio', horarioFim.toISOString())
    .gte('horario_inicio', new Date(horarioInicio.getTime() - 4 * 60 * 60 * 1000).toISOString()); // busca 4h antes

  const { data: appts } = await queryAppts;

  // Filtra manualmente pelo fim calculado (sem coluna horario_fim no DB)
  const conflitosAppts = (appts || []).filter(a => {
    if (excluirId && a.id === excluirId) return false;
    const durA = a.servicos?.duracao_minutos || 30;
    const fimA = new Date(new Date(a.horario_inicio).getTime() + durA * 60 * 1000);
    const iniA = new Date(a.horario_inicio);
    // Overlap real: iniA < horarioFim && fimA > horarioInicio
    return iniA < horarioFim && fimA > horarioInicio;
  });

  if (conflitosAppts.length > 0) {
    const c = conflitosAppts[0];
    const h = new Date(c.horario_inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    return {
      conflito: true,
      mensagem: `⚠️ Conflito: ${c.nome_cliente} já está agendado às ${h} (${c.servicos?.nome || 'serviço'}). Escolha outro horário.`
    };
  }

  // Verifica também bloqueios
  const { data: blks } = await sb
    .from('bloqueios')
    .select('titulo, horario_inicio, horario_fim')
    .lt('horario_inicio', horarioFim.toISOString())
    .gt('horario_fim',    horarioInicio.toISOString());

  if (blks && blks.length > 0) {
    const b = blks[0];
    const h = new Date(b.horario_inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    return {
      conflito: true,
      mensagem: `🔒 Horário bloqueado: "${b.titulo}" a partir das ${h}. Escolha outro horário.`
    };
  }

  return { conflito: false, mensagem: '' };
}


/* ══════════════════════════════════════════════════════════════
   MELHORIA 3: OFFLINE GRACIOSO
   ══════════════════════════════════════════════════════════════ */
function iniciarMonitorOffline() {
  const barra = document.createElement('div');
  barra.id = 'offline-bar';
  barra.innerHTML = `
    <span id="offline-icon">📡</span>
    <span id="offline-msg">Sem conexão — tentando reconectar...</span>
    <span id="offline-spinner" class="offline-spinner"></span>
  `;
  document.body.prepend(barra);

  const style = document.createElement('style');
  style.textContent = `
    #offline-bar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      background: #1a0a0a; border-bottom: 1px solid rgba(239,68,68,0.4);
      color: #f87171; font-size: 13px; font-weight: 500; padding: 10px 20px;
      display: none; align-items: center; gap: 10px; animation: slideDown 0.3s ease;
    }
    #offline-bar.visible { display: flex; }
    #offline-bar.reconnected { background: #0a1a0f; border-color: rgba(34,197,94,0.4); color: #4ade80; }
    @keyframes slideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .offline-spinner { width: 14px; height: 14px; border: 2px solid rgba(248,113,113,0.3); border-top-color: #f87171; border-radius: 50%; animation: spin 0.8s linear infinite; display: inline-block; }
    body.is-offline .main, body.is-offline .sidebar { margin-top: 41px; }
  `;
  document.head.appendChild(style);

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
    loadAgenda(state.currentDate);
    setTimeout(() => { bar.classList.remove('visible', 'reconnected'); document.body.classList.remove('is-offline'); }, 3000);
  });

  if (!navigator.onLine) window.dispatchEvent(new Event('offline'));
}


/* ══════════════════════════════════════════════════════════════
   MELHORIA 2: NOTIFICAÇÃO SONORA
   ══════════════════════════════════════════════════════════════ */
function tocarSomNotificacao() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc1 = ctx.createOscillator(); const gain1 = ctx.createGain();
    osc1.connect(gain1); gain1.connect(ctx.destination);
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.12);
    gain1.gain.setValueAtTime(0.25, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc1.start(ctx.currentTime); osc1.stop(ctx.currentTime + 0.35);
    const osc2 = ctx.createOscillator(); const gain2 = ctx.createGain();
    osc2.connect(gain2); gain2.connect(ctx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1100, ctx.currentTime + 0.2);
    osc2.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.38);
    gain2.gain.setValueAtTime(0.18, ctx.currentTime + 0.2);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc2.start(ctx.currentTime + 0.2); osc2.stop(ctx.currentTime + 0.6);
    setTimeout(() => ctx.close(), 800);
  } catch (e) { console.warn('Som de notificação não disponível:', e.message); }
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
      select.innerHTML = data.map(s => `<option value="${s.id}" data-duracao="${s.duracao_minutos}">${s.nome} (${fmt.brl(s.preco)})</option>`).join('');
    }
  }
}

async function loadAgenda(date) {
  const startOfDay = new Date(date); startOfDay.setHours(0,0,0,0);
  const endOfDay   = new Date(date); endOfDay.setHours(23,59,59,999);

  const { data: appts, error: err1 } = await sb
    .from('agendamentos').select('*, servicos(*)')
    .gte('horario_inicio', startOfDay.toISOString())
    .lte('horario_inicio', endOfDay.toISOString())
    .order('horario_inicio', { ascending: true });

  const { data: blks, error: err2 } = await sb
    .from('bloqueios').select('*')
    .gte('horario_fim', startOfDay.toISOString())
    .lte('horario_inicio', endOfDay.toISOString())
    .order('horario_inicio', { ascending: true });

  if (!err1 && appts) state.agendamentos = appts;
  if (!err2 && blks)  state.bloqueios    = blks;

  // Badge de fidelidade
  const whatsapps = [...new Set(appts?.map(a => a.whatsapp_cliente).filter(Boolean) || [])];
  if (whatsapps.length > 0) {
    const { data: historico } = await sb.from('agendamentos').select('whatsapp_cliente').eq('status', 'concluido').in('whatsapp_cliente', whatsapps);
    state.recorrencia = {};
    (historico || []).forEach(a => { state.recorrencia[a.whatsapp_cliente] = (state.recorrencia[a.whatsapp_cliente] || 0) + 1; });
  } else { state.recorrencia = {}; }

  renderTimeline();
}


/* ══════════════════════════════════════════════════════════════
   MELHORIA 4: INDICADOR DE HORÁRIOS LIVRES
   ══════════════════════════════════════════════════════════════ */
const HORA_INICIO_DIA = 8;
const HORA_FIM_DIA    = 20;
const MIN_GAP_MINUTOS = 30;

function calcularFimItem(item) {
  if (item.tipoItem === 'bloqueio') return new Date(item.horario_fim);
  const duracao = item.servicos?.duracao_minutos || 30;
  return new Date(new Date(item.horario_inicio).getTime() + duracao * 60 * 1000);
}

function calcularHorariosLivres(itensMesclados, dateRef) {
  if (itensMesclados.length === 0) return [];
  const inicioDia = new Date(dateRef); inicioDia.setHours(HORA_INICIO_DIA, 0, 0, 0);
  const fimDia    = new Date(dateRef); fimDia.setHours(HORA_FIM_DIA, 0, 0, 0);
  const ocupados  = itensMesclados.map(item => ({ inicio: new Date(item.horario_inicio), fim: calcularFimItem(item) })).sort((a, b) => a.inicio - b.inicio);
  const livres = [];
  let cursor = inicioDia;
  for (const slot of ocupados) {
    if ((slot.inicio - cursor) / 60000 >= MIN_GAP_MINUTOS) livres.push({ inicio: new Date(cursor), fim: new Date(slot.inicio) });
    if (slot.fim > cursor) cursor = slot.fim;
  }
  if ((fimDia - cursor) / 60000 >= MIN_GAP_MINUTOS) livres.push({ inicio: new Date(cursor), fim: new Date(fimDia) });
  return livres;
}

function criarCardLivre(livre) {
  const inicioFmt  = livre.inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fimFmt     = livre.fim.toLocaleTimeString('pt-BR',    { hour: '2-digit', minute: '2-digit' });
  const duracaoMin = Math.round((livre.fim - livre.inicio) / 60000);
  const duracaoFmt = duracaoMin >= 60 ? `${Math.floor(duracaoMin/60)}h${duracaoMin%60>0?(duracaoMin%60)+'min':''}` : `${duracaoMin}min`;
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
    state.bloqueios.forEach(b => itensMesclados.push({ ...b, tipoItem: 'bloqueio', status: 'bloqueio' }));
  }
  itensMesclados.sort((a, b) => new Date(a.horario_inicio) - new Date(b.horario_inicio));

  if (itensMesclados.length === 0) {
    container.innerHTML = '<p class="empty-state">Nenhum registro ou bloqueio para este dia.</p>';
    return;
  }

  const livres = state.filterStatus === 'todos' ? calcularHorariosLivres(itensMesclados, state.currentDate) : [];
  const todosItens = [
    ...itensMesclados.map(item => ({ tipo: 'ocupado', horario: new Date(item.horario_inicio), dados: item })),
    ...livres.map(livre => ({ tipo: 'livre', horario: livre.inicio, dados: livre }))
  ].sort((a, b) => a.horario - b.horario);

  todosItens.forEach(({ tipo, dados: item }) => {
    if (tipo === 'livre') { container.appendChild(criarCardLivre(item)); return; }

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
      // Badge de fidelidade
      const visitas = state.recorrencia[item.whatsapp_cliente] || 0;
      let badgeFidelidade = '';
      if (visitas >= 10)     badgeFidelidade = `<span class="badge-fiel badge-fiel-ouro"   title="${visitas} visitas">💎 VIP</span>`;
      else if (visitas >= 5) badgeFidelidade = `<span class="badge-fiel badge-fiel-prata"  title="${visitas} visitas">⭐ Fiel</span>`;
      else if (visitas >= 2) badgeFidelidade = `<span class="badge-fiel badge-fiel-bronze" title="${visitas} visitas">↩ Voltou</span>`;

      // Serializa o appt para o onclick (evita closure em loop)
      const apptJson = JSON.stringify(item).replace(/'/g, "\\'").replace(/"/g, '&quot;');

      card.innerHTML = `
        <div class="appt-time">⏰ ${fmt.time(item.horario_inicio)}</div>
        <div class="appt-info-main">
          <div class="appt-client-name">${item.nome_cliente} ${badgeFidelidade}</div>
          <div class="appt-service-tag">${item.servicos?.nome || 'Serviço não identificado'} — <span style="color:var(--gold-light); font-weight:600;">${fmt.brl(item.servicos?.preco)}</span></div>
        </div>
        <div class="appt-actions-cell">
          <span class="pill pill-${item.status}">${item.status}</span>
          <!-- NOVO: Botão WhatsApp abre o modal de templates -->
          <button class="btn-icon btn-wpp"
            title="Enviar mensagem WhatsApp"
            data-appt-id="${item.id}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          </button>
          ${item.status === 'confirmado' || item.status === 'pendente' ? `
            <button class="btn-icon" style="color:var(--success);" title="Concluir Atendimento" onclick="alterarStatus('${item.id}', 'concluido', event)">✔</button>
            <button class="btn-icon" style="color:#60a5fa;" title="Remarcar Agendamento" onclick="abrirRemarcar('${item.id}', '${item.horario_inicio}', event)">📅</button>
            <button class="btn-icon" style="color:var(--danger);" title="Cancelar Agendamento" onclick="alterarStatus('${item.id}', 'cancelado', event)">✖</button>
          ` : ''}
        </div>
      `;

      // Botão WhatsApp: armazena o item completo no dataset e abre modal
      const btnWpp = card.querySelector('.btn-wpp');
      if (btnWpp) {
        btnWpp._apptData = item; // referência direta no elemento
        btnWpp.addEventListener('click', e => {
          e.stopPropagation();
          abrirModalWhatsApp(btnWpp._apptData, e);
        });
      }

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
  const { data: appts, error } = await sb.from('agendamentos').select('*, servicos(nome, preco)').eq('whatsapp_cliente', whatsapp).order('horario_inicio', { ascending: false });
  if (error || !appts) { alert('Erro ao processar histórico do cliente.'); return; }
  const concluidos  = appts.filter(a => a.status === 'concluido');
  const totalCortes = concluidos.length;
  const gastoTotal  = concluidos.reduce((acc, c) => acc + Number(c.servicos?.preco || 0), 0);
  const ticketMedio = totalCortes > 0 ? gastoTotal / totalCortes : 0;
  $('hist-total-cortes').textContent = totalCortes;
  $('hist-total-gasto').textContent  = fmt.brl(gastoTotal);
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
  if (!titulo || !inicio || !fim) { setFeedback('bloqueio-feedback', 'Por favor, preencha todos os campos.', 'error'); return; }
  if (new Date(fim) <= new Date(inicio)) { setFeedback('bloqueio-feedback', 'O horário final deve ser após o início.', 'error'); return; }
  const { error } = await sb.from('bloqueios').insert({ prof_id: state.user.id, titulo, horario_inicio: new Date(inicio).toISOString(), horario_fim: new Date(fim).toISOString() });
  if (error) { setFeedback('bloqueio-feedback', 'Falha ao salvar: ' + error.message, 'error'); }
  else {
    setFeedback('bloqueio-feedback', 'Horário bloqueado com sucesso!', 'success');
    $('bloqueio-titulo').value = ''; $('bloqueio-inicio').value = ''; $('bloqueio-fim').value = '';
    setTimeout(() => { $('modal-bloqueio').classList.remove('open'); loadAgenda(state.currentDate); }, 1000);
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
function calcularIntervaloRelatorio() {
  const hoje = new Date();
  const tipo = state.relatorioFiltro.tipo;
  if (tipo === 'semana') {
    const diaSemana  = hoje.getDay();
    const diasAteSeg = diaSemana === 0 ? 6 : diaSemana - 1;
    const seg = new Date(hoje); seg.setDate(hoje.getDate() - diasAteSeg); seg.setHours(0,0,0,0);
    const dom = new Date(seg);  dom.setDate(seg.getDate() + 6); dom.setHours(23,59,59,999);
    return { inicio: seg, fim: dom };
  }
  if (tipo === 'mes') {
    return { inicio: new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0,0,0,0), fim: new Date(hoje.getFullYear(), hoje.getMonth()+1, 0, 23,59,59,999) };
  }
  if (tipo === 'custom' && state.relatorioFiltro.inicio && state.relatorioFiltro.fim) {
    return { inicio: new Date(state.relatorioFiltro.inicio + 'T00:00:00'), fim: new Date(state.relatorioFiltro.fim + 'T23:59:59') };
  }
  return { inicio: new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0,0,0,0), fim: new Date(hoje.getFullYear(), hoje.getMonth()+1, 0, 23,59,59,999) };
}

function aplicarFiltroRelatorio(tipo) {
  state.relatorioFiltro.tipo = tipo;
  document.querySelectorAll('.periodo-chip').forEach(c => c.classList.toggle('active', c.dataset.periodo === tipo));
  const customRow = $('rep-custom-periodo');
  if (customRow) customRow.style.display = tipo === 'custom' ? 'flex' : 'none';
  renderizarRelatoriosVisuais();
}

async function renderizarRelatoriosVisuais() {
  const { inicio, fim } = calcularIntervaloRelatorio();
  const { data: appts, error } = await sb.from('agendamentos').select('*, servicos(*)').gte('horario_inicio', inicio.toISOString()).lte('horario_inicio', fim.toISOString());
  if (error || !appts) return;
  const concluidos = appts.filter(a => a.status === 'concluido');
  const faturamentoTotal  = concluidos.reduce((acc, c) => acc + Number(c.servicos?.preco || 0), 0);
  const totalConcluidos   = concluidos.length;
  const ticketMedio       = totalConcluidos > 0 ? faturamentoTotal / totalConcluidos : 0;
  const contagemServicos  = {};
  concluidos.forEach(a => { const nome = a.servicos?.nome || 'Não identificado'; contagemServicos[nome] = (contagemServicos[nome] || 0) + 1; });
  const nomesServicos     = Object.keys(contagemServicos);
  const servicoMaisVendido = nomesServicos.length > 0 ? nomesServicos.reduce((a, b) => contagemServicos[a] > contagemServicos[b] ? a : b) : '-';
  $('rep-ticket-medio').textContent     = fmt.brl(ticketMedio);
  $('rep-servico-topo').textContent     = servicoMaisVendido;
  $('rep-faturamento-total').textContent = fmt.brl(faturamentoTotal);
  $('rep-total-concluidos').textContent  = totalConcluidos;
  const faturamentoPorDia = {};
  concluidos.forEach(a => {
    const dataFormatada = new Date(a.horario_inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    faturamentoPorDia[dataFormatada] = (faturamentoPorDia[dataFormatada] || 0) + Number(a.servicos?.preco || 0);
  });
  if (state.charts.faturamento) state.charts.faturamento.destroy();
  if (state.charts.servicos)    state.charts.servicos.destroy();
  const ctxF = $('chartFaturamento').getContext('2d');
  state.charts.faturamento = new Chart(ctxF, { type: 'line', data: { labels: Object.keys(faturamentoPorDia), datasets: [{ label: 'Ganhos do Dia (R$)', data: Object.values(faturamentoPorDia), borderColor: '#c9933a', backgroundColor: 'rgba(201,147,58,0.08)', borderWidth: 2, fill: true, tension: 0.2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#8896a8' }, grid: { color: 'rgba(255,255,255,0.03)' } }, y: { ticks: { color: '#8896a8' }, grid: { color: 'rgba(255,255,255,0.03)' } } } } });
  const ctxS = $('chartServicos').getContext('2d');
  state.charts.servicos = new Chart(ctxS, { type: 'doughnut', data: { labels: nomesServicos.length > 0 ? nomesServicos : ['Sem dados'], datasets: [{ data: nomesServicos.length > 0 ? Object.values(contagemServicos) : [1], backgroundColor: ['#c9933a','#e8b56a','#3b82f6','#22c55e','#a855f7','#f97316'], borderColor: '#0c1118', borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#eef0f4', boxWidth: 12 } } } } });
}


/* ══════════════════════════════════════════════════════════════
   EXPORTAR RELATÓRIO EM PDF
   Gera um PDF profissional com jsPDF + html2canvas, carregados
   sob demanda (lazy) — não impacta o carregamento normal da página.

   Estrutura do PDF:
     Página 1 — Capa com métricas + gráfico de barras por dia
     Página 2 — Tabela detalhada de todos os atendimentos concluídos
   ══════════════════════════════════════════════════════════════ */

/** Carrega uma lib via <script> de forma assíncrona (singleton). */
function carregarScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

/**
 * Exporta o relatório financeiro do período atual como PDF.
 * Busca os dados diretamente do Supabase para garantir consistência.
 */
async function exportarRelatorioPDF() {
  const btn = $('btn-exportar-pdf');
  const textoOriginal = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="pdf-spinner"></span> Gerando PDF...`;
  }

  try {
    if (!window.jspdf?.jsPDF) throw new Error('jsPDF não carregado. Verifique sua conexão e recarregue a página.');
    const { jsPDF } = window.jspdf;

    // ── Busca dados do período selecionado ──
    const { inicio, fim } = calcularIntervaloRelatorio();
    const { data: appts, error } = await sb
      .from('agendamentos').select('*, servicos(*)')
      .gte('horario_inicio', inicio.toISOString())
      .lte('horario_inicio', fim.toISOString())
      .order('horario_inicio', { ascending: false });

    if (error || !appts) throw new Error('Falha ao buscar dados do Supabase');

    const concluidos       = appts.filter(a => a.status === 'concluido');
    const faturamentoTotal = concluidos.reduce((acc, c) => acc + Number(c.servicos?.preco || 0), 0);
    const totalConcluidos  = concluidos.length;
    const ticketMedio      = totalConcluidos > 0 ? faturamentoTotal / totalConcluidos : 0;

    const contagemServicos = {};
    concluidos.forEach(a => {
      const nome = a.servicos?.nome || 'Não identificado';
      contagemServicos[nome] = (contagemServicos[nome] || 0) + 1;
    });

    const faturamentoPorDia = {};
    concluidos.forEach(a => {
      const d = new Date(a.horario_inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
      faturamentoPorDia[d] = (faturamentoPorDia[d] || 0) + Number(a.servicos?.preco || 0);
    });

    // ── Configuração do documento ──
    const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const PW     = 210; // largura A4
    const PH     = 297; // altura A4
    const MARG   = 16;  // margem lateral
    const COLAR  = '#c9933a'; // dourado UaiBarber
    const DARK   = '#070b10';
    const MUTED  = '#6b7a94';
    const TEXT   = '#eef0f4';
    const SUCCESS= '#22c55e';
    const barbearia = state.profissional?.nome || 'UaiBarber';
    const hoje      = new Date().toLocaleDateString('pt-BR');

    // Label do período
    const labPeriodo = {
      semana: 'Esta Semana',
      mes:    'Este Mês',
      custom: `${inicio.toLocaleDateString('pt-BR')} – ${fim.toLocaleDateString('pt-BR')}`
    }[state.relatorioFiltro.tipo] || 'Este Mês';

    // ── Helper de retângulo arredondado ──
    function roundRect(x, y, w, h, r, fill, stroke) {
      doc.setFillColor(fill || '#ffffff');
      if (stroke) doc.setDrawColor(stroke); else doc.setDrawColor(fill || '#ffffff');
      doc.roundedRect(x, y, w, h, r, r, stroke ? 'FD' : 'F');
    }

    // ─────────────────────────────────────────────
    // PÁGINA 1 — CAPA E MÉTRICAS
    // ─────────────────────────────────────────────

    // Cabeçalho escuro
    roundRect(0, 0, PW, 42, 0, DARK);

    // Logo / marca
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(COLAR);
    doc.text(barbearia, MARG, 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text(`Relatório Financeiro — ${labPeriodo}`, MARG, 25);
    doc.text(`Gerado em: ${hoje}`, MARG, 31);

    // Linha dourada decorativa
    doc.setDrawColor(COLAR);
    doc.setLineWidth(0.5);
    doc.line(MARG, 37, PW - MARG, 37);

    // ── Cards de métricas (4 em linha) ──
    const cardY   = 50;
    const cardH   = 28;
    const cardW   = (PW - MARG * 2 - 9) / 4;
    const metricas = [
      { label: 'Faturamento Total', valor: fmt.brl(faturamentoTotal), cor: SUCCESS },
      { label: 'Ticket Médio',      valor: fmt.brl(ticketMedio),      cor: TEXT    },
      { label: 'Atendimentos',      valor: String(totalConcluidos),    cor: TEXT    },
      { label: 'Serviço Top',       valor: Object.keys(contagemServicos).length > 0
          ? Object.keys(contagemServicos).reduce((a,b) => contagemServicos[a]>contagemServicos[b]?a:b)
          : '—',                                                        cor: COLAR  }
    ];

    metricas.forEach((m, i) => {
      const x = MARG + i * (cardW + 3);
      roundRect(x, cardY, cardW, cardH, 2, '#0f1520');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(MUTED);
      doc.text(m.label.toUpperCase(), x + 4, cardY + 8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(i === 3 ? 8 : 11);
      doc.setTextColor(m.cor);
      doc.text(m.valor, x + 4, cardY + 20, { maxWidth: cardW - 6 });
    });

    // ── Gráfico de barras: faturamento por dia ──
    const chartY   = cardY + cardH + 12;
    const chartH   = 48;
    const chartW   = PW - MARG * 2;
    const dias     = Object.keys(faturamentoPorDia);
    const valores  = Object.values(faturamentoPorDia);
    const maxVal   = Math.max(...valores, 1);

    // Título da seção
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text('FATURAMENTO POR DIA', MARG, chartY - 3);

    // Fundo do chart
    roundRect(MARG, chartY, chartW, chartH + 8, 2, '#0f1520');

    // Linha de base
    doc.setDrawColor('#1d2d3f');
    doc.setLineWidth(0.2);
    doc.line(MARG + 4, chartY + chartH + 2, MARG + chartW - 4, chartY + chartH + 2);

    if (dias.length > 0) {
      const barW    = Math.min(8, (chartW - 16) / dias.length - 2);
      const spacing = (chartW - 16) / dias.length;
      dias.forEach((dia, i) => {
        const val    = valores[i];
        const barH   = Math.max(2, (val / maxVal) * (chartH - 6));
        const bx     = MARG + 8 + i * spacing;
        const by     = chartY + 2 + (chartH - barH - 4);

        // Barra
        doc.setFillColor(COLAR);
        doc.roundedRect(bx, by, barW, barH, 1, 1, 'F');

        // Valor acima
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5);
        doc.setTextColor(MUTED);
        const valStr = fmt.brl(val).replace('R$\u00a0','R$');
        doc.text(valStr, bx + barW / 2, by - 1, { align: 'center', maxWidth: spacing - 1 });

        // Label dia
        doc.text(dia, bx + barW / 2, chartY + chartH + 6, { align: 'center' });
      });
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(MUTED);
      doc.text('Nenhum atendimento concluído no período.', PW / 2, chartY + chartH / 2, { align: 'center' });
    }

    // ── Distribuição de serviços ──
    const servY = chartY + chartH + 24;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text('DISTRIBUIÇÃO DE SERVIÇOS', MARG, servY - 3);

    const CORES_PDF = [COLAR, '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#e8b56a'];
    const nomesS    = Object.keys(contagemServicos);
    const totalS    = Object.values(contagemServicos).reduce((a,b)=>a+b,0) || 1;
    const colW      = (PW - MARG * 2 - 6) / 2;

    nomesS.forEach((nome, i) => {
      const qtd  = contagemServicos[nome];
      const pct  = Math.round((qtd / totalS) * 100);
      const col  = i % 2;
      const row  = Math.floor(i / 2);
      const sx   = MARG + col * (colW + 6);
      const sy   = servY + row * 12;
      const cor  = CORES_PDF[i % CORES_PDF.length];

      // Bolinha colorida
      doc.setFillColor(cor);
      doc.circle(sx + 2, sy + 2, 2, 'F');

      // Nome + contagem
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(TEXT);
      doc.text(nome, sx + 6, sy + 3.5, { maxWidth: colW - 30 });

      // Barra de progresso
      const barX = sx + 6;
      const barY = sy + 6;
      const bW   = colW - 30;
      doc.setFillColor('#1d2d3f');
      doc.roundedRect(barX, barY, bW, 2.5, 1, 1, 'F');
      doc.setFillColor(cor);
      doc.roundedRect(barX, barY, (pct / 100) * bW, 2.5, 1, 1, 'F');

      // Percentual
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(cor);
      doc.text(`${qtd}x (${pct}%)`, sx + colW - 2, sy + 3.5, { align: 'right' });
    });

    // ── Rodapé página 1 ──
    const rodapeY = PH - 10;
    doc.setDrawColor('#1d2d3f');
    doc.setLineWidth(0.3);
    doc.line(MARG, rodapeY - 4, PW - MARG, rodapeY - 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text('UaiBarber — Sistema de Gestão para Barbearias', MARG, rodapeY);
    doc.text('Documento gerado automaticamente · Não requer assinatura · Pág. 1', PW - MARG, rodapeY, { align: 'right' });

    // ─────────────────────────────────────────────
    // PÁGINA 2 — TABELA DETALHADA
    // ─────────────────────────────────────────────
    doc.addPage();

    // Cabeçalho compacto
    roundRect(0, 0, PW, 22, 0, DARK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(COLAR);
    doc.text(barbearia, MARG, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text(`Atendimentos Concluídos — ${labPeriodo}`, MARG, 17);
    doc.text(`Pág. 2`, PW - MARG, 17, { align: 'right' });

    // ── Cabeçalho da tabela ──
    const tY      = 30;
    const cols    = [
      { label: 'Cliente',   x: MARG,      w: 52 },
      { label: 'Serviço',   x: MARG + 52, w: 52 },
      { label: 'WhatsApp',  x: MARG + 104,w: 40 },
      { label: 'Data/Hora', x: MARG + 144,w: 30 },
      { label: 'Valor',     x: MARG + 174,w: 22 }
    ];

    roundRect(MARG, tY, PW - MARG * 2, 8, 1, '#0f1520');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    cols.forEach(c => doc.text(c.label.toUpperCase(), c.x + 2, tY + 5.5));

    // ── Linhas da tabela ──
    let rowY = tY + 10;
    const rowH = 8;

    if (concluidos.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(MUTED);
      doc.text('Nenhum atendimento concluído no período selecionado.', PW / 2, rowY + 10, { align: 'center' });
    }

    concluidos.forEach((a, i) => {
      // Nova página se ultrapassar a margem inferior
      if (rowY + rowH > PH - 16) {
        // Rodapé da página corrente
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(MUTED);
        doc.text(`UaiBarber · Pág. ${doc.internal.getCurrentPageInfo().pageNumber}`, PW - MARG, PH - 8, { align: 'right' });
        doc.addPage();
        // Cabeçalho simples nas páginas extras
        roundRect(0, 0, PW, 12, 0, DARK);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(COLAR);
        doc.text(`${barbearia} · Continuação`, MARG, 8);
        rowY = 18;
        // Repete cabeçalho da tabela
        roundRect(MARG, rowY, PW - MARG * 2, 8, 1, '#0f1520');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(MUTED);
        cols.forEach(c => doc.text(c.label.toUpperCase(), c.x + 2, rowY + 5.5));
        rowY += 10;
      }

      // Fundo alternado
      if (i % 2 === 0) roundRect(MARG, rowY, PW - MARG * 2, rowH, 0, '#0a1018');

      const dtFmt = new Date(a.horario_inicio).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', timeZone:'UTC' })
        + ' ' + new Date(a.horario_inicio).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', timeZone:'UTC' });

      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(TEXT);
      doc.text(a.nome_cliente || '—',             cols[0].x + 2, rowY + 5.5, { maxWidth: cols[0].w - 3 });
      doc.setTextColor(MUTED);
      doc.text(a.servicos?.nome || '—',           cols[1].x + 2, rowY + 5.5, { maxWidth: cols[1].w - 3 });
      doc.text(a.whatsapp_cliente || '—',         cols[2].x + 2, rowY + 5.5, { maxWidth: cols[2].w - 3 });
      doc.text(dtFmt,                             cols[3].x + 2, rowY + 5.5, { maxWidth: cols[3].w - 3 });
      doc.setFont('helvetica', 'bold'); doc.setTextColor(COLAR);
      doc.text(fmt.brl(a.servicos?.preco || 0),  cols[4].x + cols[4].w - 2, rowY + 5.5, { align: 'right' });

      // Linha separadora leve
      doc.setDrawColor('#1d2d3f'); doc.setLineWidth(0.15);
      doc.line(MARG, rowY + rowH, PW - MARG, rowY + rowH);

      rowY += rowH;
    });

    // ── Linha de total ──
    rowY += 2;
    roundRect(MARG, rowY, PW - MARG * 2, 9, 1, '#0f1520');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(TEXT);
    doc.text(`Total: ${totalConcluidos} atendimento${totalConcluidos !== 1 ? 's' : ''}`, MARG + 4, rowY + 6);
    doc.setTextColor(SUCCESS);
    doc.text(fmt.brl(faturamentoTotal), PW - MARG - 2, rowY + 6, { align: 'right' });

    // ── Rodapé final ──
    const rf2 = PH - 10;
    doc.setDrawColor('#1d2d3f'); doc.setLineWidth(0.3);
    doc.line(MARG, rf2 - 4, PW - MARG, rf2 - 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(MUTED);
    doc.text('UaiBarber — Sistema de Gestão para Barbearias', MARG, rf2);
    doc.text(`Documento gerado automaticamente · ${hoje} · Pág. ${doc.internal.getCurrentPageInfo().pageNumber}`, PW - MARG, rf2, { align: 'right' });

    // ── Salva o arquivo ──
    const nomeArq = `UaiBarber_Relatorio_${labPeriodo.replace(/\s/g,'_').replace(/\//g,'-')}_${hoje.replace(/\//g,'-')}.pdf`;
    doc.save(nomeArq);

  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    alert('Não foi possível gerar o PDF. Tente novamente.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><polyline points="9 15 12 18 15 15"/></svg> Exportar PDF`;
    }
  }
}


/* ────── CRIAÇÃO DE SERVIÇOS ────── */
async function salvarServico() {
  const nome    = $('service-nome').value.trim();
  const preco   = $('service-preco').value;
  const duracao = $('service-duracao').value;
  if (!nome || !preco || !duracao) { setFeedback('service-feedback', 'Por favor, preencha todos os campos do serviço.', 'error'); return; }
  const { error } = await sb.from('servicos').insert({ prof_id: state.user.id, nome, preco: parseFloat(preco), duracao_minutos: parseInt(duracao) });
  if (error) { setFeedback('service-feedback', 'Erro ao salvar serviço: ' + error.message, 'error'); }
  else {
    setFeedback('service-feedback', 'Serviço cadastrado com sucesso!', 'success');
    $('service-nome').value = ''; $('service-preco').value = ''; $('service-duracao').value = '';
    setTimeout(async () => { $('modal-service').classList.remove('open'); await loadServicos(); }, 1000);
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
      <div><button class="btn-secondary" style="padding:6px 12px; font-size:12px;" onclick="removerServico('${s.id}')">Excluir</button></div>
    </div>
  `).join(state.servicos.length === 0 ? '<p class="empty-state">Nenhum serviço cadastrado.</p>' : '');
}

async function removerServico(id) {
  if (confirm('Deseja mesmo remover este serviço?')) { await sb.from('servicos').delete().eq('id', id); loadServicos(); }
}


/* ────── CONTROLE DE STATUS ────── */
async function alterarStatus(id, novoStatus, event) {
  if (event) event.stopPropagation();
  const { error } = await sb.from('agendamentos').update({ status: novoStatus }).eq('id', id);
  if (!error) loadAgenda(state.currentDate);
}


/* ══════════════════════════════════════════════════════════════
   MELHORIA 5: REMARCAR (com validação de conflito)
   ══════════════════════════════════════════════════════════════ */
function abrirRemarcar(id, horarioISO, event) {
  if (event) event.stopPropagation();
  const dt = new Date(horarioISO);
  const pad = n => String(n).padStart(2, '0');
  const localStr = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  $('remarcar-id').value      = id;
  $('remarcar-horario').value = localStr;
  setFeedback('remarcar-feedback', '', '');
  $('modal-remarcar').classList.add('open');
}

async function salvarRemarcar() {
  const id      = $('remarcar-id').value;
  const horario = $('remarcar-horario').value;
  if (!horario) { setFeedback('remarcar-feedback', 'Selecione o novo horário.', 'error'); return; }
  const novoHorario = new Date(horario);
  if (novoHorario < new Date()) { setFeedback('remarcar-feedback', 'Não é possível remarcar para um horário já passado.', 'error'); return; }

  // Valida conflito (exclui o próprio agendamento da checagem)
  setFeedback('remarcar-feedback', '⏳ Verificando disponibilidade...', '');
  const apptOriginal = state.agendamentos.find(a => a.id === id);
  const duracao = apptOriginal?.servicos?.duracao_minutos || 30;
  const { conflito, mensagem } = await verificarConflitoHorario(novoHorario, duracao, id);
  if (conflito) { setFeedback('remarcar-feedback', mensagem, 'error'); return; }

  const btn = $('btn-salvar-remarcar');
  btn.textContent = 'Salvando...';
  btn.disabled = true;
  const { error } = await sb.from('agendamentos').update({ horario_inicio: novoHorario.toISOString() }).eq('id', id);
  btn.textContent = 'Confirmar Remarcação';
  btn.disabled = false;
  if (error) { setFeedback('remarcar-feedback', 'Erro ao remarcar: ' + error.message, 'error'); }
  else {
    setFeedback('remarcar-feedback', '✔ Remarcado com sucesso!', 'success');
    setTimeout(() => { $('modal-remarcar').classList.remove('open'); loadAgenda(state.currentDate); }, 900);
  }
}


/* ══════════════════════════════════════════════════════════════
   NOVO: CRIAR AGENDAMENTO MANUAL COM VALIDAÇÃO DE CONFLITO
   ══════════════════════════════════════════════════════════════ */
async function criarAgendamentoManual() {
  const nome      = $('appt-nome').value.trim();
  const whatsapp  = $('appt-whatsapp').value.trim();
  const servicoId = $('appt-servico').value;
  const horario   = $('appt-horario').value;

  if (!nome || !whatsapp || !servicoId || !horario) {
    setFeedback('appt-feedback', 'Preencha todos os dados.', 'error');
    return;
  }

  const horarioDate = new Date(horario);
  if (horarioDate < new Date()) {
    setFeedback('appt-feedback', '⚠️ Não é possível criar agendamentos no passado.', 'error');
    return;
  }

  // Obtém a duração do serviço selecionado
  const selectEl  = $('appt-servico');
  const opt       = selectEl.options[selectEl.selectedIndex];
  const duracao   = parseInt(opt?.dataset?.duracao || '30');

  // Verifica conflito de horário
  setFeedback('appt-feedback', '⏳ Verificando disponibilidade do horário...', '');
  const { conflito, mensagem } = await verificarConflitoHorario(horarioDate, duracao);
  if (conflito) {
    setFeedback('appt-feedback', mensagem, 'error');
    return;
  }

  const btn = $('btn-salvar-appt');
  btn.textContent = 'Criando...';
  btn.disabled = true;

  const { error } = await sb.from('agendamentos').insert({
    prof_id: state.user.id,
    servico_id: servicoId,
    nome_cliente: nome,
    whatsapp_cliente: whatsapp,
    horario_inicio: horarioDate.toISOString()
  });

  btn.textContent = 'Criar Agendamento';
  btn.disabled = false;

  if (error) {
    setFeedback('appt-feedback', error.message, 'error');
  } else {
    setFeedback('appt-feedback', '✔ Agendado com sucesso!', 'success');
    $('appt-nome').value = ''; $('appt-whatsapp').value = '';
    setTimeout(() => { $('modal-appt').classList.remove('open'); loadAgenda(state.currentDate); }, 1000);
  }
}


/* ══════════════════════════════════════════════════════════════
   ONBOARDING GUIADO
   ══════════════════════════════════════════════════════════════ */
function gerarLinkBot(userId) { return `https://uaibarber.app/bot/${userId.replace(/-/g,'').substring(0,10)}`; }
function irParaEtapaOnb(etapa) {
  state.onboarding.etapaAtual = etapa;
  document.querySelectorAll('.onb-slide').forEach(el => { el.style.display = 'none'; });
  const alvo = $(`onb-step-${etapa}`);
  if (alvo) alvo.style.display = 'block';
}
function abrirOnboarding() {
  if (state.profissional?.nome) $('onb-input-nome').value = state.profissional.nome;
  else $('onb-input-nome').value = '';
  $('onb-input-servnome').value = ''; $('onb-input-servpreco').value = ''; $('onb-input-servduracao').value = '';
  ['onb-feedback-1','onb-feedback-2','onb-feedback-3'].forEach(id => setFeedback(id, '', ''));
  irParaEtapaOnb(1);
  $('modal-onboarding').classList.add('open');
}
async function onbSalvarNome() {
  const nome = $('onb-input-nome').value.trim();
  if (!nome) { setFeedback('onb-feedback-1', 'Por favor, informe o nome da barbearia.', 'error'); return; }
  const btn = $('onb-btn-proximo-1'); btn.textContent = 'Salvando...'; btn.disabled = true;
  const { error } = await sb.from('profissionais').upsert({ id: state.user.id, nome }, { onConflict: 'id' });
  btn.textContent = 'Avançar: Configurar Catálogo →'; btn.disabled = false;
  if (error) { setFeedback('onb-feedback-1', 'Erro ao salvar: ' + error.message, 'error'); return; }
  await loadProfissional();
  if (!state.profissional) { setFeedback('onb-feedback-1', 'Não foi possível confirmar o cadastro.', 'error'); return; }
  state.onboarding.nomeTemp = nome;
  $('prof-name').textContent = nome; $('prof-avatar').textContent = nome.charAt(0).toUpperCase();
  irParaEtapaOnb(2);
}
async function onbSalvarServico() {
  const nome = $('onb-input-servnome').value.trim(); const preco = $('onb-input-servpreco').value; const duracao = $('onb-input-servduracao').value;
  if (state.servicos.length > 0 && !nome && !preco && !duracao) { irParaEtapaOnb(3); $('onb-input-linkbot').value = gerarLinkBot(state.user.id); return; }
  if (!nome || !preco || !duracao) { setFeedback('onb-feedback-2', 'Preencha todos os campos para cadastrar o serviço.', 'error'); return; }
  const btn = $('onb-btn-proximo-2'); btn.textContent = 'Salvando...'; btn.disabled = true;
  const { error } = await sb.from('servicos').insert({ prof_id: state.user.id, nome, preco: parseFloat(preco), duracao_minutos: parseInt(duracao) });
  btn.textContent = 'Salvar e Obter Link do Bot →'; btn.disabled = false;
  if (error) { setFeedback('onb-feedback-2', 'Erro ao salvar: ' + error.message, 'error'); return; }
  await loadServicos();
  $('onb-input-linkbot').value = gerarLinkBot(state.user.id);
  irParaEtapaOnb(3);
}
async function onbCopiarLink() {
  const link = $('onb-input-linkbot').value;
  try { await navigator.clipboard.writeText(link); setFeedback('onb-feedback-3', '✔ Link copiado!', 'success'); $('onb-btn-copiar').textContent = '✔ Copiado'; setTimeout(() => { $('onb-btn-copiar').textContent = 'Copiar'; }, 2500); }
  catch { $('onb-input-linkbot').select(); document.execCommand('copy'); setFeedback('onb-feedback-3', '✔ Link copiado!', 'success'); }
}
function onbFinalizar() { localStorage.setItem(`uaibarber_onb_done_${state.user.id}`, '1'); $('modal-onboarding').classList.remove('open'); loadAgenda(state.currentDate); setTimeout(iniciarTour, 500); }
function verificarOnboarding() { const jaFez = localStorage.getItem(`uaibarber_onb_done_${state.user.id}`); if (!jaFez || state.servicos.length === 0) setTimeout(abrirOnboarding, 400); }


/* ══════════════════════════════════════════════════════════════
   TOUR GUIADO
   ══════════════════════════════════════════════════════════════ */
const TOUR_PASSOS = [
  { selector: '[data-target="view-agenda"]', titulo: '📅 Agenda do Dia', texto: 'Este é o coração do seu painel. Veja todos os agendamentos e bloqueios do dia, organizados por horário.', posicao: 'right' },
  { selector: '.agenda-header', titulo: '📆 Navegação de Datas', texto: 'Use as setas para navegar entre os dias. Os filtros deixam você ver só confirmados, concluídos ou cancelados.', posicao: 'bottom' },
  { selector: '#btn-new-appt', titulo: '➕ Novo Agendamento', texto: 'Cadastre agendamentos manuais. O sistema valida automaticamente se o horário está disponível antes de salvar.', posicao: 'left' },
  { selector: '#btn-open-bloqueio', titulo: '🔒 Bloquear Horário', texto: 'Bloqueie faixas de horários para almoço, folga ou férias. Nenhum cliente poderá ser marcado nesse intervalo.', posicao: 'left' },
  { selector: '#status-filter', titulo: '🔍 Filtros de Status', texto: 'Filtre por status para fechar o caixa no fim do dia ou conferir pendências.', posicao: 'bottom' },
  { selector: '[data-target="view-relatorios"]', titulo: '📊 Relatórios Visuais', texto: 'Faturamento por dia, serviço mais vendido, ticket médio e total de atendimentos. Filtre por semana, mês ou período personalizado.', posicao: 'right' },
  { selector: '[data-target="view-servicos"]', titulo: '✂️ Meus Serviços', texto: 'Gerencie seu catálogo com nome, preço e duração. A duração é usada na validação de conflitos de horário.', posicao: 'right' },
  { selector: '[data-target="view-assinatura"]', titulo: '💳 Minha Assinatura', texto: 'Acompanhe o status do seu plano e data de renovação.', posicao: 'right' },
  { selector: '#btn-help-tutorial', titulo: '❓ Ajuda Rápida', texto: 'Clique aqui a qualquer momento para rever a configuração ou iniciar este tour novamente.', posicao: 'top' }
];

function injetarEstilosTour() {
  if ($('tour-styles')) return;
  const style = document.createElement('style');
  style.id = 'tour-styles';
  style.textContent = `
    .badge-fiel { display:inline-flex; align-items:center; gap:3px; padding:2px 7px; border-radius:20px; font-size:10px; font-weight:700; vertical-align:middle; margin-left:6px; }
    .badge-fiel-bronze { background:rgba(180,120,60,0.15); color:#cd7f32; border:1px solid rgba(205,127,50,0.3); }
    .badge-fiel-prata  { background:rgba(201,147,58,0.15); color:var(--gold-light); border:1px solid rgba(201,147,58,0.35); }
    .badge-fiel-ouro   { background:rgba(99,179,237,0.12); color:#90cdf4; border:1px solid rgba(99,179,237,0.3); }
    .free-slot-chip { display:flex; align-items:center; gap:10px; padding:10px 16px; border-radius:var(--radius); border:1px dashed rgba(34,197,94,0.25); background:rgba(34,197,94,0.04); font-size:13px; color:var(--muted); }
    .free-slot-chip:hover { background:rgba(34,197,94,0.07); }
    .free-slot-label { flex:1; }
    .free-slot-label strong { color:#4ade80; font-weight:600; }
    .free-slot-duration { font-size:11px; font-weight:600; color:rgba(74,222,128,0.6); background:rgba(34,197,94,0.08); padding:3px 8px; border-radius:20px; white-space:nowrap; }
    .btn-wpp { color:#25D366 !important; transition:transform 0.15s,color 0.15s; }
    .btn-wpp:hover { transform:scale(1.15); color:#4ade80 !important; }
    #tour-spotlight { position:fixed; border-radius:8px; z-index:1001; pointer-events:none; transition:top 0.35s,left 0.35s,width 0.35s,height 0.35s; box-shadow:0 0 0 9999px rgba(5,7,11,0.82); outline:2px solid rgba(201,147,58,0.6); outline-offset:3px; }
    #tour-tooltip { position:fixed; z-index:1002; background:#0f1520; border:1px solid rgba(201,147,58,0.35); border-radius:10px; padding:18px 20px; width:300px; box-shadow:0 12px 40px rgba(0,0,0,0.7); transition:top 0.35s,left 0.35s,opacity 0.2s; }
    #tour-tooltip::before { content:''; position:absolute; width:10px; height:10px; background:#0f1520; }
    #tour-tooltip.arrow-left::before  { left:-6px;  top:18px; border-left:1px solid rgba(201,147,58,0.35); border-bottom:1px solid rgba(201,147,58,0.35); transform:rotate(-45deg); }
    #tour-tooltip.arrow-right::before { right:-6px; top:18px; border-left:1px solid rgba(201,147,58,0.35); border-bottom:1px solid rgba(201,147,58,0.35); transform:rotate(135deg); }
    #tour-tooltip.arrow-top::before   { top:-6px;   left:20px; border-left:1px solid rgba(201,147,58,0.35); border-top:1px solid rgba(201,147,58,0.35); transform:rotate(45deg); }
    #tour-tooltip.arrow-bottom::before{ bottom:-6px; left:20px; border-left:1px solid rgba(201,147,58,0.35); border-bottom:1px solid rgba(201,147,58,0.35); transform:rotate(225deg); }
    .tour-counter { font-size:11px; font-weight:600; color:#c9933a; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px; }
    .tour-titulo { font-family:'Syne',sans-serif; font-size:15px; font-weight:700; color:#eef0f4; margin-bottom:8px; }
    .tour-texto  { font-size:13px; color:#8896a8; line-height:1.55; margin-bottom:16px; }
    .tour-nav    { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .tour-btn-pular { background:none; border:none; color:#6b7a94; font-size:12px; cursor:pointer; text-decoration:underline; }
    .tour-btn-pular:hover { color:#ef4444; }
    .tour-nav-right { display:flex; gap:8px; }
    .tour-btn-nav { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); color:#eef0f4; padding:7px 14px; border-radius:6px; font-size:12px; font-weight:500; cursor:pointer; }
    .tour-btn-nav.primary { background:#c9933a; border-color:#c9933a; color:#000; font-weight:600; }
    #modal-ajuda { position:fixed; bottom:84px; right:24px; background:#0f1520; border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:14px; width:240px; box-shadow:0 8px 30px rgba(0,0,0,0.7); z-index:1000; display:none; flex-direction:column; gap:8px; }
    #modal-ajuda.open { display:flex; }
    #modal-ajuda h5 { font-size:11px; font-weight:600; color:#6b7a94; text-transform:uppercase; margin-bottom:4px; }
    .ajuda-opcao { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); color:#eef0f4; padding:10px 12px; border-radius:7px; font-size:13px; cursor:pointer; text-align:left; }
    .ajuda-opcao:hover { background:rgba(201,147,58,0.1); border-color:rgba(201,147,58,0.3); }
    @keyframes spin { to { transform:rotate(360deg); } }
  `;
  document.head.appendChild(style);

  const spotlight = document.createElement('div'); spotlight.id = 'tour-spotlight'; spotlight.style.display = 'none'; document.body.appendChild(spotlight);
  const tooltip   = document.createElement('div'); tooltip.id   = 'tour-tooltip';   tooltip.style.display   = 'none'; document.body.appendChild(tooltip);
  const miniModal = document.createElement('div'); miniModal.id = 'modal-ajuda';
  miniModal.innerHTML = `<h5>Como posso ajudar?</h5><button class="ajuda-opcao" id="ajuda-btn-onboarding">⚙️ Refazer Configuração Inicial</button><button class="ajuda-opcao" id="ajuda-btn-tour">🗺️ Tour Guiado da Plataforma</button>`;
  document.body.appendChild(miniModal);
}

function iniciarTour() { const m = $('modal-ajuda'); if (m) m.classList.remove('open'); state.tour.ativa = true; state.tour.etapaAtual = 0; renderizarPassoTour(0); }
function renderizarPassoTour(index) {
  const passo = TOUR_PASSOS[index]; if (!passo) { finalizarTour(); return; }
  const alvo = document.querySelector(passo.selector); if (!alvo) { renderizarPassoTour(index+1); return; }
  const spotlight = $('tour-spotlight'); const tooltip = $('tour-tooltip');
  const rect = alvo.getBoundingClientRect(); const PAD = 6; const MARGEM = 14;
  spotlight.style.display = 'block'; spotlight.style.top = `${rect.top-PAD}px`; spotlight.style.left = `${rect.left-PAD}px`; spotlight.style.width = `${rect.width+PAD*2}px`; spotlight.style.height = `${rect.height+PAD*2}px`;
  const ehUltimo = index === TOUR_PASSOS.length-1; const ehPrimeiro = index === 0;
  tooltip.className = ''; tooltip.style.display = 'block'; tooltip.style.opacity = '0';
  tooltip.innerHTML = `<div class="tour-counter">Passo ${index+1} de ${TOUR_PASSOS.length}</div><div class="tour-titulo">${passo.titulo}</div><p class="tour-texto">${passo.texto}</p><div class="tour-nav"><button class="tour-btn-pular" id="tour-btn-pular">Pular tour</button><div class="tour-nav-right">${!ehPrimeiro?`<button class="tour-btn-nav" id="tour-btn-anterior">← Anterior</button>`:''}<button class="tour-btn-nav primary" id="tour-btn-proximo">${ehUltimo?'✔ Concluir':'Próximo →'}</button></div></div>`;
  const ttW = 300; const ttH = tooltip.offsetHeight||180; const vW = window.innerWidth; const vH = window.innerHeight;
  let top, left, arrowClass;
  switch (passo.posicao) {
    case 'right':  left = rect.right+PAD+MARGEM; top = rect.top+PAD; arrowClass = 'arrow-left'; if(left+ttW>vW-10){left=rect.left-PAD-MARGEM-ttW;arrowClass='arrow-right';} break;
    case 'left':   left = rect.left-PAD-MARGEM-ttW; top = rect.top+PAD; arrowClass = 'arrow-right'; if(left<10){left=rect.right+PAD+MARGEM;arrowClass='arrow-left';} break;
    case 'bottom': top = rect.bottom+PAD+MARGEM; left = Math.min(rect.left-PAD,vW-ttW-10); arrowClass = 'arrow-top'; if(top+ttH>vH-10){top=rect.top-PAD-MARGEM-ttH;arrowClass='arrow-bottom';} break;
    default:       top = rect.top-PAD-MARGEM-ttH; left = Math.min(rect.left-PAD,vW-ttW-10); arrowClass = 'arrow-bottom'; if(top<10){top=rect.bottom+PAD+MARGEM;arrowClass='arrow-top';} break;
  }
  top = Math.max(10,Math.min(top,vH-ttH-10)); left = Math.max(10,Math.min(left,vW-ttW-10));
  tooltip.style.top = `${top}px`; tooltip.style.left = `${left}px`; tooltip.classList.add(arrowClass);
  requestAnimationFrame(() => { tooltip.style.opacity = '1'; });
  alvo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('tour-btn-pular').addEventListener('click', finalizarTour);
  $('tour-btn-proximo').addEventListener('click', () => renderizarPassoTour(index+1));
  const btnA = $('tour-btn-anterior'); if (btnA) btnA.addEventListener('click', () => renderizarPassoTour(index-1));
  state.tour.etapaAtual = index;
}
function finalizarTour() { state.tour.ativa = false; const s = $('tour-spotlight'); const t = $('tour-tooltip'); if(s)s.style.display='none'; if(t)t.style.display='none'; }


/* ────── EVENT BINDINGS ────── */
function updateDateLabel() { $('current-date-lbl').textContent = state.currentDate.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }); }

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

  $('btn-exportar-pdf')?.addEventListener('click', exportarRelatorioPDF);

  $('btn-prev-day').addEventListener('click', () => { state.currentDate.setDate(state.currentDate.getDate()-1); updateDateLabel(); loadAgenda(state.currentDate); });
  $('btn-next-day').addEventListener('click', () => { state.currentDate.setDate(state.currentDate.getDate()+1); updateDateLabel(); loadAgenda(state.currentDate); });

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

  $('btn-cancelar-remarcar').addEventListener('click', () => $('modal-remarcar').classList.remove('open'));
  $('btn-salvar-remarcar').addEventListener('click', salvarRemarcar);

  document.querySelectorAll('.periodo-chip').forEach(chip => { chip.addEventListener('click', () => aplicarFiltroRelatorio(chip.dataset.periodo)); });
  $('rep-btn-aplicar-custom')?.addEventListener('click', () => {
    const ini = $('rep-custom-inicio').value; const fim = $('rep-custom-fim').value;
    if (!ini || !fim) return;
    if (new Date(ini) > new Date(fim)) { alert('A data de início deve ser anterior à data de fim.'); return; }
    state.relatorioFiltro.inicio = ini; state.relatorioFiltro.fim = fim;
    renderizarRelatoriosVisuais();
  });

  $('mobile-menu-btn').addEventListener('click', () => { $('sidebar').classList.add('open'); $('sidebar-overlay').style.display = 'block'; });
  $('sidebar-overlay').addEventListener('click', closeSidebar);
  $('btn-renew-sub')?.addEventListener('click', () => window.open('https://wa.me/?text=Olá! Gostaria de renovar minha assinatura UaiBarber.', '_blank'));

  $('onb-btn-proximo-1').addEventListener('click', onbSalvarNome);
  $('onb-input-nome').addEventListener('keydown', e => { if(e.key==='Enter') onbSalvarNome(); });
  $('onb-btn-proximo-2').addEventListener('click', onbSalvarServico);
  $('onb-btn-copiar').addEventListener('click', onbCopiarLink);
  $('onb-btn-finalizar').addEventListener('click', onbFinalizar);

  $('btn-help-tutorial').addEventListener('click', e => { e.stopPropagation(); const mini = $('modal-ajuda'); if(mini) mini.classList.toggle('open'); });
  document.addEventListener('click', e => { const mini = $('modal-ajuda'); if(mini && !mini.contains(e.target) && e.target.id !== 'btn-help-tutorial') mini.classList.remove('open'); });
  document.addEventListener('click', e => {
    if (e.target.id === 'ajuda-btn-onboarding') { $('modal-ajuda').classList.remove('open'); abrirOnboarding(); }
    if (e.target.id === 'ajuda-btn-tour')        { $('modal-ajuda').classList.remove('open'); iniciarTour(); }
  });

  $('modal-onboarding').addEventListener('click', e => { if(e.target === $('modal-onboarding') && state.servicos.length > 0) $('modal-onboarding').classList.remove('open'); });
}

function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebar-overlay').style.display = 'none'; }

/* ────── REALTIME ────── */
function startRealtime() {
  state.realtimeChannel = sb.channel('mudancas-agenda')
    .on('postgres_changes', { event: 'INSERT', pattern: 'public', table: 'agendamentos' }, async payload => {
      const { data: appt } = await sb.from('agendamentos').select('*, servicos(*)').eq('id', payload.new.id).maybeSingle();
      if (appt) {
        tocarSomNotificacao();
        $('alert-content').innerHTML = `<strong>Cliente:</strong> ${appt.nome_cliente}<br><strong>Serviço:</strong> ${appt.servicos?.nome}<br><strong>Horário:</strong> ${fmt.dateFull(appt.horario_inicio)}`;
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
  injetarModalWhatsApp();        // ← NOVO: injeta o modal de templates WPP
  iniciarMonitorOffline();
  bindEvents();
  updateDateLabel();

  try {
    await loadProfissional();
    await loadServicos();
    await loadAgenda(state.currentDate);
    startRealtime();
    verificarOnboarding();
  } catch(e) { console.error('Erro na inicialização do painel:', e); }
}

window.addEventListener('DOMContentLoaded', init);
