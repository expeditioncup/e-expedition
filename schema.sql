-- =====================================================================
-- e-Expedition — schema do banco (Supabase / PostgreSQL)
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- TABELAS
-- ---------------------------------------------------------------------

create table if not exists profiles (
  id         uuid primary key references auth.users on delete cascade,
  nome       text not null,
  time       text,
  role       text not null default 'jogador' check (role in ('jogador', 'admin')),
  criado_em  timestamptz not null default now()
);

create table if not exists campeonatos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  returno    boolean not null default false,
  status     text not null default 'rascunho'
             check (status in ('rascunho', 'em_andamento', 'encerrado')),
  criado_em  timestamptz not null default now()
);

create table if not exists participantes (
  id             uuid primary key default gen_random_uuid(),
  campeonato_id  uuid not null references campeonatos on delete cascade,
  jogador_id     uuid not null references profiles on delete cascade,
  unique (campeonato_id, jogador_id)
);

create table if not exists partidas (
  id              uuid primary key default gen_random_uuid(),
  campeonato_id   uuid not null references campeonatos on delete cascade,
  rodada          int  not null default 1,
  mandante_id     uuid not null references profiles on delete cascade,
  visitante_id    uuid not null references profiles on delete cascade,
  gols_mandante   int,
  gols_visitante  int,
  status          text not null default 'agendada'
                  check (status in ('agendada', 'finalizada')),
  jogada_em       timestamptz,
  constraint adversarios_diferentes check (mandante_id <> visitante_id),
  constraint placar_completo check (
    (status = 'agendada')
    or (gols_mandante is not null and gols_visitante is not null
        and gols_mandante >= 0 and gols_visitante >= 0)
  )
);

create index if not exists partidas_campeonato_idx on partidas (campeonato_id, rodada);

create table if not exists convites (
  token          text primary key,
  campeonato_id  uuid references campeonatos on delete cascade,
  criado_por     uuid references profiles on delete set null,
  expira_em      timestamptz not null default (now() + interval '7 days'),
  usado_por      uuid references profiles on delete set null,
  usado_em       timestamptz
);

-- ---------------------------------------------------------------------
-- MIGRAÇÃO v2 — múltiplos formatos de campeonato
-- Roda em cima do schema v1 sem apagar dados (tudo com IF NOT EXISTS).
-- Se o projeto for novo, pode rodar este arquivo inteiro de uma vez.
-- ---------------------------------------------------------------------

alter table campeonatos add column if not exists formato text not null default 'liga'
  check (formato in ('liga', 'mata_mata', 'grupos_mata_mata', 'apertura_clausura',
                      'dupla_eliminacao', 'suico', 'consolacao'));
alter table campeonatos add column if not exists ida_volta boolean not null default false;
alter table campeonatos add column if not exists num_grupos int not null default 2;
alter table campeonatos add column if not exists classificados_por_grupo int not null default 2;
alter table campeonatos add column if not exists campeao_id uuid references profiles(id);

alter table participantes add column if not exists grupo text;

alter table partidas alter column mandante_id drop not null;
alter table partidas alter column visitante_id drop not null;
alter table partidas add column if not exists fase text not null default 'liga';
alter table partidas add column if not exists grupo text;
alter table partidas add column if not exists confronto_id text;
alter table partidas add column if not exists perna int not null default 1;
alter table partidas add column if not exists pen_mandante int;
alter table partidas add column if not exists pen_visitante int;
alter table partidas add column if not exists alimenta_partida_id uuid references partidas(id) on delete set null;
alter table partidas add column if not exists alimenta_posicao text check (alimenta_posicao in ('mandante', 'visitante'));

alter table partidas drop constraint if exists adversarios_diferentes;
alter table partidas add constraint adversarios_diferentes
  check (mandante_id is null or visitante_id is null or mandante_id <> visitante_id);

alter table partidas drop constraint if exists placar_completo;
alter table partidas add constraint placar_completo check (
  status <> 'finalizada'
  or (gols_mandante is not null and gols_visitante is not null
      and gols_mandante >= 0 and gols_visitante >= 0)
);

alter table partidas drop constraint if exists partidas_status_check;
alter table partidas add constraint partidas_status_check
  check (status in ('agendada', 'aguardando', 'bye', 'finalizada'));

create index if not exists partidas_confronto_idx on partidas (confronto_id);
create index if not exists partidas_alimenta_idx on partidas (alimenta_partida_id);
create index if not exists partidas_fase_idx on partidas (campeonato_id, fase);

-- ---------------------------------------------------------------------
-- FUNÇÕES AUXILIARES
-- ---------------------------------------------------------------------

-- SECURITY DEFINER evita recursão infinita quando as policies de
-- profiles precisarem saber se o usuário atual é admin.
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Cria o profile automaticamente quando alguém se cadastra.
-- O primeiro usuário do sistema já nasce admin (bootstrap).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  primeiro boolean;
begin
  select not exists (select 1 from profiles) into primeiro;

  insert into profiles (id, nome, time, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'time', ''),
    case when primeiro then 'admin' else 'jogador' end
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Resgate de convite. É a única porta de entrada para a tabela convites,
-- que fica sem nenhuma policy de leitura — ninguém consegue listar tokens.
create or replace function usar_convite(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c convites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Você precisa estar logado para usar um convite.';
  end if;

  select * into c from convites where token = p_token for update;

  if not found then
    raise exception 'Convite não encontrado.';
  end if;
  if c.usado_por is not null then
    raise exception 'Este convite já foi usado.';
  end if;
  if c.expira_em < now() then
    raise exception 'Este convite expirou.';
  end if;

  if c.campeonato_id is not null then
    insert into participantes (campeonato_id, jogador_id)
    values (c.campeonato_id, auth.uid())
    on conflict do nothing;
  end if;

  update convites
     set usado_por = auth.uid(), usado_em = now()
   where token = p_token;

  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------
-- CLASSIFICAÇÃO (view calculada — nunca dessincroniza)
-- ---------------------------------------------------------------------

create or replace view classificacao
with (security_invoker = on) as
with fases_pontos_corridos as (
  -- toda fase em que o jogador tem partida marcada (mesmo sem placar ainda);
  -- garante que ele apareça na aba certa desde o momento em que a tabela é gerada.
  select distinct campeonato_id, fase, mandante_id as jogador_id
    from partidas where fase in ('liga', 'grupos', 'apertura', 'clausura')
  union
  select distinct campeonato_id, fase, visitante_id
    from partidas where fase in ('liga', 'grupos', 'apertura', 'clausura')
),
resultados as (
  select campeonato_id, fase, mandante_id as jogador_id,
         gols_mandante as gp, gols_visitante as gc
    from partidas where status = 'finalizada' and fase in ('liga', 'grupos', 'apertura', 'clausura')
  union all
  select campeonato_id, fase, visitante_id,
         gols_visitante, gols_mandante
    from partidas where status = 'finalizada' and fase in ('liga', 'grupos', 'apertura', 'clausura')
)
select
  pa.campeonato_id,
  coalesce(fp.fase, 'liga')                                 as fase,
  pa.jogador_id,
  pa.grupo,
  pf.nome,
  pf.time,
  count(r.jogador_id)::int                                  as jogos,
  count(*) filter (where r.gp >  r.gc)::int                 as vitorias,
  count(*) filter (where r.gp =  r.gc)::int                 as empates,
  count(*) filter (where r.gp <  r.gc)::int                 as derrotas,
  coalesce(sum(r.gp), 0)::int                               as gols_pro,
  coalesce(sum(r.gc), 0)::int                               as gols_contra,
  coalesce(sum(r.gp) - sum(r.gc), 0)::int                    as saldo,
  (count(*) filter (where r.gp > r.gc) * 3
   + count(*) filter (where r.gp = r.gc))::int               as pontos
from participantes pa
join profiles pf on pf.id = pa.jogador_id
left join fases_pontos_corridos fp
  on fp.campeonato_id = pa.campeonato_id and fp.jogador_id = pa.jogador_id
left join resultados r
  on r.campeonato_id = pa.campeonato_id and r.jogador_id = pa.jogador_id and r.fase = fp.fase
group by pa.campeonato_id, coalesce(fp.fase, 'liga'), pa.jogador_id, pa.grupo, pf.nome, pf.time;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Regra geral: quem está logado LÊ tudo; só admin ESCREVE.
-- ---------------------------------------------------------------------

alter table profiles      enable row level security;
alter table campeonatos   enable row level security;
alter table participantes enable row level security;
alter table partidas      enable row level security;
alter table convites      enable row level security;

-- profiles
drop policy if exists profiles_leitura on profiles;
create policy profiles_leitura on profiles
  for select to authenticated using (true);

drop policy if exists profiles_editar_proprio on profiles;
create policy profiles_editar_proprio on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_admin on profiles;
create policy profiles_admin on profiles
  for all to authenticated using (is_admin()) with check (is_admin());

-- Trava de escalação de privilégio: ninguém promove a si mesmo pelo site.
-- Para virar admin, rode no SQL Editor:
--   update profiles set role = 'admin' where nome = 'Fulano';
revoke update on profiles from authenticated;
grant  update (nome, time) on profiles to authenticated;

-- campeonatos
drop policy if exists campeonatos_leitura on campeonatos;
create policy campeonatos_leitura on campeonatos
  for select to authenticated using (true);

drop policy if exists campeonatos_admin on campeonatos;
create policy campeonatos_admin on campeonatos
  for all to authenticated using (is_admin()) with check (is_admin());

-- participantes
drop policy if exists participantes_leitura on participantes;
create policy participantes_leitura on participantes
  for select to authenticated using (true);

drop policy if exists participantes_admin on participantes;
create policy participantes_admin on participantes
  for all to authenticated using (is_admin()) with check (is_admin());

-- partidas
drop policy if exists partidas_leitura on partidas;
create policy partidas_leitura on partidas
  for select to authenticated using (true);

drop policy if exists partidas_admin on partidas;
create policy partidas_admin on partidas
  for all to authenticated using (is_admin()) with check (is_admin());

-- convites: só admin cria e lista. O resgate passa pela função usar_convite().
drop policy if exists convites_admin on convites;
create policy convites_admin on convites
  for all to authenticated using (is_admin()) with check (is_admin());
