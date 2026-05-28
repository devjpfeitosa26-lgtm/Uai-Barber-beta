create extension if not exists pgcrypto;

create table if not exists public.profissionais (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.servicos (
  id uuid primary key default gen_random_uuid(),
  prof_id uuid not null references public.profissionais (id) on delete cascade,
  nome text not null,
  preco numeric(10,2) not null check (preco >= 0),
  duracao_minutos int not null check (duracao_minutos > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  prof_id uuid not null references public.profissionais (id) on delete cascade,
  servico_id uuid not null references public.servicos (id) on delete restrict,
  nome_cliente text not null,
  whatsapp_cliente text not null,
  horario_inicio timestamptz not null,
  status text not null default 'confirmado' check (status in ('pendente', 'confirmado', 'concluido', 'cancelado')),
  created_at timestamptz not null default now()
);

create index if not exists idx_servicos_prof_id on public.servicos (prof_id);
create index if not exists idx_agendamentos_prof_id on public.agendamentos (prof_id);
create index if not exists idx_agendamentos_horario_inicio on public.agendamentos (horario_inicio);
create index if not exists idx_agendamentos_prof_horario on public.agendamentos (prof_id, horario_inicio);

alter table public.profissionais enable row level security;
alter table public.servicos enable row level security;
alter table public.agendamentos enable row level security;

create policy "profissional_ler_proprio_perfil"
on public.profissionais
for select
using (auth.uid() = id);

create policy "profissional_atualizar_proprio_perfil"
on public.profissionais
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "profissional_inserir_proprio_perfil"
on public.profissionais
for insert
with check (auth.uid() = id);

create policy "profissional_ler_proprios_servicos"
on public.servicos
for select
using (auth.uid() = prof_id);

create policy "profissional_inserir_proprios_servicos"
on public.servicos
for insert
with check (auth.uid() = prof_id);

create policy "profissional_atualizar_proprios_servicos"
on public.servicos
for update
using (auth.uid() = prof_id)
with check (auth.uid() = prof_id);

create policy "profissional_remover_proprios_servicos"
on public.servicos
for delete
using (auth.uid() = prof_id);

create policy "profissional_ler_proprios_agendamentos"
on public.agendamentos
for select
using (auth.uid() = prof_id);

create policy "profissional_inserir_proprios_agendamentos"
on public.agendamentos
for insert
with check (auth.uid() = prof_id);

create policy "profissional_atualizar_proprios_agendamentos"
on public.agendamentos
for update
using (auth.uid() = prof_id)
with check (auth.uid() = prof_id);

create policy "profissional_remover_proprios_agendamentos"
on public.agendamentos
for delete
using (auth.uid() = prof_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profissionais (id, nome)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'nome',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.agendamentos replica identity full;
alter publication supabase_realtime add table public.agendamentos;
