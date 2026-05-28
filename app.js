/* ── UaiBarber app.js ── */
const SUPABASE_URL = 'https://quzfhkuiduvukuxcmfoq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1emZoa3VpZHV2dWt1eGNtZm9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MDk3OTAsImV4cCI6MjA5NTQ4NTc5MH0.ztjj-YfMwJgbh606RisxEDW2NzMbfrCMOzzC50qaT3M';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* ────── STATE ────── */
const state = {
    user: null,
    profissional: null,
    servicos: [],
    agendamentos: [],
    bloqueios: [],
    currentDate: new Date(),
    filterStatus: 'todos',
    activeView: 'agenda',
    realtimeChannel: null,
    online: navigator.onLine
};

/* ────── HELPERS ────── */
const $ = id => document.getElementById(id);
const fmt = {
    brl: v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0)),
    time: d => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
    dateFull: d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    dateISO: d => d.toISOString().split('T')[0]
};

/* ══════════════════════════════════════════════════════════════
   MELHORIA: MONITOR ONLINE/OFFLINE
   ══════════════════════════════════════════════════════════════ */
function iniciarMonitorOffline() {
    const barra = document.createElement('div');
    barra.id = 'offline-bar';
    barra.innerHTML = `
    <span id="offline-icon">📡</span>
    <span id="offline-msg">Sem conexão — a tentar reconectar...</span>
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
    body.is-offline .main { margin-top: 41px; }
  `;
    document.head.appendChild(style);

    window.addEventListener('offline', () => {
        state.online = false;
        document.body.classList.add('is-offline');
        const bar = $('offline-bar');
        bar.classList.remove('reconnected');
        bar.classList.add('visible');
        $('offline-icon').textContent = '📡';
        $('offline-msg').textContent = 'Sem conexão à internet — Modo de Leitura Ativo.';
        $('offline-spinner').style.display = 'inline-block';
    });

    window.addEventListener('online', () => {
        state.online = true;
        const bar = $('offline-bar');
        bar.classList.add('reconnected');
        $('offline-icon').textContent = '✅';
        $('offline-msg').textContent = 'Conexão restaurada com sucesso!';
        $('offline-spinner').style.display = 'none';

        loadAgenda(state.currentDate);

        setTimeout(() => {
            bar.classList.remove('visible', 'reconnected');
            document.body.classList.remove('is-offline');
        }, 3000);
    });

    if (!navigator.onLine) window.dispatchEvent(new Event('offline'));
}

/* ══════════════════════════════════════════════════════════════
   MELHORIA: NOTIFICAÇÃO SONORA (WEB AUDIO API)
   ══════════════════════════════════════════════════════════════ */
function tocarSomNotificacao() {
    try {
        const ctx = new(window.AudioContext || window.webkitAudioContext)();
        
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.connect(gain1); gain1.connect(ctx.destination);
        osc1.type = 'sine'; osc1.frequency.setValueAtTime(880, ctx.currentTime);
        osc1.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.12);
        gain1.gain.setValueAtTime(0.25, ctx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc1.start(ctx.currentTime); osc1.stop(ctx.currentTime + 0.35);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2); gain2.connect(ctx.destination);
        osc2.type = 'sine'; osc2.frequency.setValueAtTime(1100, ctx.currentTime + 0.2);
        osc2.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.38);
        gain2.gain.setValueAtTime(0.18, ctx.currentTime + 0.2);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc2.start(ctx.currentTime + 0.2); osc2.stop(ctx.currentTime + 0.6);

        setTimeout(() => ctx.close(), 800);
    } catch (e) {
        console.warn('Som automático bloqueado ou indisponível:', e.message);
    }
}

/* ══════════════════════════════════════════════════════════════
   MELHORIA: CONFIRMAÇÃO AUTOMÁTICA VIA WHATSAPP
   ══════════════════════════════════════════════════════════════ */
function enviarWhatsApp(whatsapp, nome, horario, tipo) {
    const numero = '55' + whatsapp.replace(/\D/g, '');
    const dt = new Date(horario);
    const horaFormatada = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    const dataFormatada = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

    const mensagens = {
        confirmado: `Olá, ${nome}! ✂️ O seu agendamento para as *${horaFormatada}* do dia *${dataFormatada}* está confirmado. Ficamos à tua espera! — UaiBarber`,
        concluido: `Olá, ${nome}! 🙏 Obrigado pela visita de hoje (${dataFormatada}). Foi um enorme prazer atender-te! Quando quiseres regressar, basta avisar. — UaiBarber`
    };

    const texto = encodeURIComponent(mensagens[tipo] || mensagens.confirmado);
    window.open(`https://wa.me/${numero}?text=${texto}`, '_blank');
}

/* ────── CARREGAMENTO DE DADOS (SUPABASE) ────── */
async function loadProfissional() {
    // Caso não exista autenticação real na demo, simula um nome padrão
    if (!state.user) {
        $('prof-name').textContent = "Barbearia Premium";
        $('prof-avatar').textContent = "B";
        return;
    }
    const { data, error } = await sb.from('profissionais').select('*').eq('id', state.user.id).maybeSingle();
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
    }
}

async function loadAgenda(date) {
    const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date); endOfDay.setHours(23, 59, 59, 999);

    const { data: appts } = await sb
        .from('agendamentos')
        .select('*, servicos(*)')
        .gte('horario_inicio', startOfDay.toISOString())
        .lte('horario_inicio', endOfDay.toISOString())
        .order('horario_inicio', { ascending: true });

    const { data: blks } = await sb
        .from('bloqueios')
        .select('*')
        .gte('horario_fim', startOfDay.toISOString())
        .lte('horario_inicio', endOfDay.toISOString())
        .order('horario_inicio', { ascending: true });

    state.agendamentos = appts || [];
    state.bloqueios = blks || [];

    // Atualiza estatísticas básicas na view de relatórios
    if ($('metric-total')) $('metric-total').textContent = state.agendamentos.length;

    renderTimeline();
}

/* ══════════════════════════════════════════════════════════════
   MELHORIA: INDICADOR INTELIGENTE DE HORÁRIOS LIVRES
   ══════════════════════════════════════════════════════════════ */
const HORA_INICIO_DIA = 8; 
const HORA_FIM_DIA = 20;   
const MIN_GAP_MINUTOS = 30;

function calcularFimItem(item) {
    if (item.tipoItem === 'bloqueio') return new Date(item.horario_fim);
    const duracao = item.servicos?.duracao_minutos || 30;
    return new Date(new Date(item.horario_inicio).getTime() + duracao * 60 * 1000);
}

function calcularHorariosLivres(itensMesclados, dateRef) {
    const inicioDia = new Date(dateRef); inicioDia.setHours(HORA_INICIO_DIA, 0, 0, 0);
    const fimDia = new Date(dateRef); fimDia.setHours(HORA_FIM_DIA, 0, 0, 0);

    const ocupados = itensMesclados.map(item => ({
        inicio: new Date(item.horario_inicio),
        fim: calcularFimItem(item)
    })).sort((a, b) => a.inicio - b.inicio);

    const livres = [];
    let cursor = inicioDia;

    for (const slot of ocupados) {
        const gapMin = (slot.inicio - cursor) / 60000;
        if (gapMin >= MIN_GAP_MINUTOS) {
            livres.push({ inicio: new Date(cursor), fim: new Date(slot.inicio) });
        }
        if (slot.fim > cursor) cursor = slot.fim;
    }

    if ((fimDia - cursor) / 60000 >= MIN_GAP_MINUTOS) {
        livres.push({ inicio: new Date(cursor), fim: new Date(fimDia) });
    }
    return livres;
}

function criarCardLivre(livre) {
    const inicioFmt = livre.inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const fimFmt = livre.fim.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const duracaoMin = Math.round((livre.fim - livre.inicio) / 60000);

    const chip = document.createElement('div');
    chip.className = 'free-slot-chip';
    chip.innerHTML = `
    <span class="free-slot-label">🟢 Livre: <strong>${inicioFmt} – ${fimFmt}</strong></span>
    <span class="free-slot-duration">${duracaoMin} min vagos</span>
  `;
    return chip;
}

/* ────── RENDERIZAÇÃO VISUAL DA LINHA DE TEMPO ────── */
function renderTimeline() {
    const container = $('timeline-container');
    container.innerHTML = '';

    let itensMesclados = [];
    state.agendamentos.forEach(a => {
        if (state.filterStatus !== 'todos' && a.status !== state.filterStatus) return;
        itensMesclados.push({...a, tipoItem: 'agendamento' });
    });

    if (state.filterStatus === 'todos') {
        state.bloqueios.forEach(b => {
            itensMesclados.push({...b, tipoItem: 'bloqueio', status: 'bloqueio' });
        });
    }

    itensMesclados.sort((a, b) => new Date(a.horario_inicio) - new Date(b.horario_inicio));

    if (itensMesclados.length === 0) {
        container.innerHTML = '<p class="empty-state">Nenhum registo ou bloqueio para este dia.</p>';
        return;
    }

    const livres = state.filterStatus === 'todos' ? calcularHorariosLivres(itensMesclados, state.currentDate) : [];

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
                  <button class="btn-secondary" style="padding:4px 8px; font-size:11px; color:var(--danger);" onclick="removerBloqueio('${item.id}', event)">Desbloquear</button>
                </div>
            `;
        } else {
            const podeEnviarWpp = ['confirmado', 'pendente', 'concluido'].includes(item.status);
            const tipoWpp = item.status === 'concluido' ? 'concluido' : 'confirmado';

            card.innerHTML = `
                <div class="appt-time">⏰ ${fmt.time(item.horario_inicio)}</div>
                <div class="appt-info-main">
                  <div class="appt-client-name">${item.nome_cliente}</div>
                  <div class="appt-service-tag">${item.servicos?.nome || 'Serviço'} — <span style="color:var(--gold-light);">${fmt.brl(item.servicos?.preco)}</span></div>
                </div>
                <div class="appt-actions-cell">
                  <span class="pill pill-${item.status}">${item.status}</span>
                  ${podeEnviarWpp ? `
                    <button class="btn-wpp" title="Enviar Mensagem" onclick="enviarWhatsApp('${item.whatsapp_cliente}', '${item.nome_cliente.replace(/'/g, "\\'")}', '${item.horario_inicio}', '${tipoWpp}'); event.stopPropagation();">
                       📱 Wpp
                    </button>
                  ` : ''}
                  ${['confirmado', 'pendente'].includes(item.status) ? `
                    <button class="btn-icon" style="color:var(--success);" title="Concluir" onclick="alterarStatus('${item.id}', 'concluido', event)">✔</button>
                    <button class="btn-icon" style="color:var(--danger);" title="Cancelar" onclick="alterarStatus('${item.id}', 'cancelado', event)">✖</button>
                  ` : ''}
                </div>
            `;
            
            // Clique no cartão abre histórico do cliente
            card.addEventListener('click', () => abrirHistoricoCliente(item.whatsapp_cliente, item.nome_cliente));
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

    if (error || !appts) return alert('Não foi possível ler o histórico.');

    const concluidos = appts.filter(a => a.status === 'concluido');
    const totalCortes = concluidos.length;
    const gastoTotal = concluidos.reduce((acc, c) => acc + Number(c.servicos?.preco || 0), 0);
    const ticketMedio = totalCortes > 0 ? gastoTotal / totalCortes : 0;

    $('hist-total-cortes').textContent = totalCortes;
    $('hist-total-gasto').textContent = fmt.brl(gastoTotal);
    $('hist-ticket-medio').textContent = fmt.brl(ticketMedio);

    const list = $('hist-lista-agendamentos');
    if (appts.length === 0) {
        list.innerHTML = '<p class="empty-state">Sem dados passados.</p>';
    } else {
        list.innerHTML = appts.map(a => `
            <div style="padding:10px; border-bottom:1px solid var(--border); font-size:13px; display:flex; justify-content:space-between;">
                <span>📅 ${fmt.dateFull(a.horario_inicio)} - ${a.servicos?.nome || 'Serviço'}</span>
                <span class="pill pill-${a.status}">${a.status}</span>
            </div>
        `).join('');
    }
    $('modal-historico').classList.add('open');
}

/* ────── MUDANÇAS DE STATUS EM TEMPO REAL ────── */
async function alterarStatus(id, novoStatus, event) {
    if (event) event.stopPropagation();
    await sb.from('agendamentos').update({ status: novoStatus }).eq('id', id);
    loadAgenda(state.currentDate);
}

async function removerBloqueio(id, event) {
    if (event) event.stopPropagation();
    await sb.from('bloqueios').delete().eq('id', id);
    loadAgenda(state.currentDate);
}

function renderServicos() {
    const container = $('services-container');
    if (!container) return;
    container.innerHTML = state.servicos.map(s => `
        <div class="metric-card" style="margin-bottom:8px;">
            <strong>${s.nome}</strong> — <span style="color:var(--gold-light);">${fmt.brl(s.preco)}</span>
            <div style="font-size:12px; color:var(--muted); margin-top:4px;">Duração estimada: ${s.duracao_minutos || 30} minutos</div>
        </div>
    `).join('');
}

/* ────── EVENT LISTENERS / BINDINGS ────── */
function bindEvents() {
    $('btn-prev-date').addEventListener('click', () => { state.currentDate.setDate(state.currentDate.getDate() - 1); updateDateLabel(); loadAgenda(state.currentDate); });
    $('btn-next-date').addEventListener('click', () => { state.currentDate.setDate(state.currentDate.getDate() + 1); updateDateLabel(); loadAgenda(state.currentDate); });

    document.querySelectorAll('.status-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            document.querySelectorAll('.status-chip').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            state.filterStatus = e.target.dataset.status;
            renderTimeline();
        });
    });

    $('btn-close-alert').addEventListener('click', () => $('modal-alert').classList.remove('open'));
    $('btn-fechar-historico').addEventListener('click', () => $('modal-historico').classList.remove('open'));

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            const current = e.target.closest('.nav-item');
            current.classList.add('active');
            
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            $(`view-${current.dataset.view}`).classList.add('active');
        });
    });
}

function updateDateLabel() {
    $('current-date-lbl').textContent = state.currentDate.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ────── REALTIME COM SUPABASE ────── */
function startRealtime() {
    state.realtimeChannel = sb.channel('mudancas-agenda')
        .on('postgres_changes', { event: 'INSERT', pattern: 'public', table: 'agendamentos' }, async (payload) => {
            const { data: appt } = await sb.from('agendamentos').select('*, servicos(*)').eq('id', payload.new.id).maybeSingle();
            if (appt) {
                tocarSomNotificacao();
                $('alert-content').innerHTML = `
                  <strong>Cliente:</strong> ${appt.nome_cliente}<br>
                  <strong>Serviço:</strong> ${appt.servicos?.nome || 'Não especificado'}<br>
                  <strong>Horário:</strong> ${fmt.dateFull(appt.horario_inicio)}
                `;
                $('modal-alert').classList.add('open');
                loadAgenda(state.currentDate);
            }
        })
        .subscribe();
}

/* ────── INICIALIZAÇÃO DA APLICAÇÃO ────── */
async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) state.user = session.user;

    iniciarMonitorOffline();
    bindEvents();
    updateDateLabel();

    await loadProfissional();
    await loadServicos();
    await loadAgenda(state.currentDate);
    startRealtime();
}

window.addEventListener('DOMContentLoaded', init);
