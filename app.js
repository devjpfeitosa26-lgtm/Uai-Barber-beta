const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANON';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  user: null,
  profissional: null,
  servicos: [],
  agendamentos: [],
  realtimeChannel: null
};

const elements = {
  nomeProfissional: document.getElementById('profissional-nome'),
  avatarInitial: document.getElementById('avatar-initial'),
  faturamentoDia: document.getElementById('faturamento-dia'),
  totalCortes: document.getElementById('total-cortes'),
  timeline: document.getElementById('timeline'),
  agendaSubtitle: document.getElementById('agenda-subtitle'),
  modal: document.getElementById('agendamento-modal'),
  openModalBtn: document.getElementById('open-modal-btn'),
  closeModalBtn: document.getElementById('close-modal-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  manualForm: document.getElementById('manual-form'),
  manualFeedback: document.getElementById('manual-feedback'),
  nomeCliente: document.getElementById('nome-cliente'),
  whatsappCliente: document.getElementById('whatsapp-cliente'),
  servicoSelect: document.getElementById('servico-id'),
  dataAgendamento: document.getElementById('data-agendamento'),
  horaAgendamento: document.getElementById('hora-agendamento')
};

function currencyBRL(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value || 0));
}

function formatHour(dateString) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(dateString));
}

function setManualFeedback(message, type = '') {
  elements.manualFeedback.textContent = message;
  elements.manualFeedback.className = `feedback ${type}`.trim();
}

function openModal() {
  elements.modal.classList.add('open');
  elements.modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  elements.modal.classList.remove('open');
  elements.modal.setAttribute('aria-hidden', 'true');
  setManualFeedback('');
}

function fillDefaultDateTime() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(Math.ceil(now.getMinutes() / 5) * 5).padStart(2, '0');

  elements.dataAgendamento.value = date;
  elements.horaAgendamento.value = `${hour}:${minute === '60' ? '00' : minute}`;
}

function renderServicosSelect() {
  if (!state.servicos.length) {
    elements.servicoSelect.innerHTML = '<option value="">Cadastre um serviço primeiro</option>';
    elements.servicoSelect.disabled = true;
    return;
  }

  elements.servicoSelect.disabled = false;
  elements.servicoSelect.innerHTML = state.servicos
    .map((servico) => `
      <option value="${servico.id}">
        ${servico.nome} • ${currencyBRL(servico.preco)} • ${servico.duracao_minutos} min
      </option>
    `)
    .join('');
}

function renderMetrics() {
  const ativos = state.agendamentos.filter((item) => item.status !== 'cancelado');
  const faturamento = ativos.reduce((acc, item) => acc + Number(item.servicos?.preco || 0), 0);

  elements.faturamentoDia.textContent = currencyBRL(faturamento);
  elements.totalCortes.textContent = String(ativos.length);
}

function renderTimeline() {
  if (!state.agendamentos.length) {
    elements.timeline.innerHTML = `
      <div class="empty-state">
        Nenhum horário encontrado para hoje. Assim que o Typebot ou o barbeiro inserir um novo agendamento, esta lista será atualizada automaticamente.
      </div>
    `;
    return;
  }

  elements.timeline.innerHTML = state.agendamentos
    .map((item) => {
      const serviceName = item.servicos?.nome || 'Serviço';
      const servicePrice = item.servicos?.preco ? ` • ${currencyBRL(item.servicos.preco)}` : '';
      const phone = item.whatsapp_cliente ? ` • WhatsApp: ${item.whatsapp_cliente}` : '';

      return `
        <article class="timeline-card">
          <div class="timeline-time">${formatHour(item.horario_inicio)}</div>
          <div class="timeline-main">
            <strong>${item.nome_cliente}</strong>
            <div class="timeline-meta">${serviceName}${servicePrice}</div>
            <div class="timeline-meta">${phone.replace(/^ • /, '')}</div>
          </div>
          <div>
            <span class="status-pill status-${item.status}">${item.status}</span>
          </div>
        </article>
      `;
    })
    .join('');
}

async function loadProfissional() {
  const { data, error } = await supabase
    .from('profissionais')
    .select('id, nome')
    .eq('id', state.user.id)
    .single();

  if (error) {
    throw new Error('Não foi possível carregar o perfil do profissional.');
  }

  state.profissional = data;
  elements.nomeProfissional.textContent = data.nome;
  elements.avatarInitial.textContent = (data.nome || 'B').trim().charAt(0).toUpperCase();
}

async function loadServicos() {
  const { data, error } = await supabase
    .from('servicos')
    .select('id, nome, preco, duracao_minutos')
    .eq('prof_id', state.user.id)
    .order('nome');

  if (error) {
    throw new Error('Não foi possível carregar os serviços.');
  }

  state.servicos = data || [];
  renderServicosSelect();
}

async function loadAgendaDoDia() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from('agendamentos')
    .select('id, nome_cliente, whatsapp_cliente, horario_inicio, status, servico_id, servicos(nome, preco, duracao_minutos)')
    .eq('prof_id', state.user.id)
    .gte('horario_inicio', start.toISOString())
    .lte('horario_inicio', end.toISOString())
    .order('horario_inicio', { ascending: true });

  if (error) {
    throw new Error('Não foi possível carregar a agenda do dia.');
  }

  state.agendamentos = data || [];
  renderMetrics();
  renderTimeline();
  elements.agendaSubtitle.textContent = `Atualizada em ${new Date().toLocaleTimeString('pt-BR')}.`; 
}

async function existsExactConflict(profId, horarioISO) {
  const { data, error } = await supabase
    .from('agendamentos')
    .select('id')
    .eq('prof_id', profId)
    .eq('horario_inicio', horarioISO)
    .in('status', ['pendente', 'confirmado'])
    .limit(1);

  if (error) {
    throw new Error('Não foi possível validar conflito de horário.');
  }

  return Boolean(data?.length);
}

async function saveManualAppointment(event) {
  event.preventDefault();

  if (!state.servicos.length) {
    setManualFeedback('Cadastre ao menos um serviço antes de criar agendamentos.', 'error');
    return;
  }

  setManualFeedback('Salvando agendamento...');

  const payload = {
    prof_id: state.user.id,
    servico_id: elements.servicoSelect.value,
    nome_cliente: elements.nomeCliente.value.trim(),
    whatsapp_cliente: elements.whatsappCliente.value.trim(),
    horario_inicio: new Date(`${elements.dataAgendamento.value}T${elements.horaAgendamento.value}:00`).toISOString(),
    status: 'confirmado'
  };

  if (!payload.nome_cliente || !payload.whatsapp_cliente || !payload.servico_id) {
    setManualFeedback('Preencha todos os campos antes de salvar.', 'error');
    return;
  }

  const hasConflict = await existsExactConflict(state.user.id, payload.horario_inicio);
  if (hasConflict) {
    setManualFeedback('Já existe um agendamento confirmado ou pendente exatamente neste horário.', 'error');
    return;
  }

  const { error } = await supabase
    .from('agendamentos')
    .insert(payload);

  if (error) {
    setManualFeedback(error.message, 'error');
    return;
  }

  elements.manualForm.reset();
  fillDefaultDateTime();
  setManualFeedback('Agendamento salvo com sucesso.', 'success');

  await loadAgendaDoDia();
  setTimeout(closeModal, 700);
}

async function logout() {
  await supabase.auth.signOut();
  window.location.href = './login.html';
}

function startRealtime() {
  if (state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
  }

  state.realtimeChannel = supabase
    .channel(`agendamentos-prof-${state.user.id}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'agendamentos',
        filter: `prof_id=eq.${state.user.id}`
      },
      async () => {
        await loadAgendaDoDia();
      }
    )
    .subscribe();
}

function bindEvents() {
  elements.openModalBtn.addEventListener('click', openModal);
  elements.closeModalBtn.addEventListener('click', closeModal);
  elements.logoutBtn.addEventListener('click', logout);
  elements.manualForm.addEventListener('submit', saveManualAppointment);
  elements.modal.addEventListener('click', (event) => {
    if (event.target === elements.modal) {
      closeModal();
    }
  });
}

async function initDashboard() {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = './login.html';
    return;
  }

  state.user = session.user;
  bindEvents();
  fillDefaultDateTime();

  try {
    await loadProfissional();
    await loadServicos();
    await loadAgendaDoDia();
    startRealtime();
  } catch (error) {
    elements.timeline.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

initDashboard();
