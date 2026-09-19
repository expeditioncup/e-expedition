import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =====================================================================
   CONFIGURAÇÃO
   Pegue os dois valores em: Supabase > Project Settings > API.
   A chave "anon" é pública de propósito — quem protege os dados é o RLS.
   ===================================================================== */
const SUPABASE_URL      = "COLE_AQUI_A_URL_DO_PROJETO";
const SUPABASE_ANON_KEY = "COLE_AQUI_A_CHAVE_ANON";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* =====================================================================
   ESTADO E ATALHOS
   ===================================================================== */
const estado = {
  usuario: null,
  perfil: null,
  campeonatos: [],
  campeonatoId: null,
  filtroJogos: "todos",
  modoAuth: "entrar",
  faseTabela: null,
  faseJogos: null,
  faseAdmin: null,
};

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function campeonatoAtual() {
  return estado.campeonatos.find((c) => c.id === estado.campeonatoId) ?? null;
}

/* =====================================================================
   FASES DE CADA FORMATO
   "tipo" diz como renderizar: liga (lista por rodada), liga_grupos
   (lista por rodada dentro de cada grupo) ou chave (chaveamento).
   ===================================================================== */
function fasesDoFormato(camp) {
  if (!camp) return [];
  switch (camp.formato) {
    case "mata_mata":
      return [{ chave: "mata_mata", rotulo: "Mata-mata", tipo: "chave" }];
    case "grupos_mata_mata":
      return [
        { chave: "grupos", rotulo: "Grupos", tipo: "liga_grupos" },
        { chave: "mata_mata", rotulo: "Mata-mata", tipo: "chave" },
      ];
    case "apertura_clausura":
      return [
        { chave: "apertura", rotulo: "Apertura", tipo: "liga" },
        { chave: "clausura", rotulo: "Clausura", tipo: "liga" },
        { chave: "final_unificada", rotulo: "Final", tipo: "chave" },
      ];
    default:
      return [{ chave: "liga", rotulo: "Liga", tipo: "liga" }];
  }
}

function renderAbasFase(container, chaveEstado, aoTrocar) {
  const camp = campeonatoAtual();
  const fases = fasesDoFormato(camp);
  if (fases.length <= 1) { container.hidden = true; return fases[0]?.chave ?? null; }

  if (!estado[chaveEstado] || !fases.some((f) => f.chave === estado[chaveEstado])) {
    estado[chaveEstado] = fases[0].chave;
  }
  container.hidden = false;
  container.innerHTML = fases.map((f) => `
    <button class="chip ${f.chave === estado[chaveEstado] ? "ativa" : ""}" data-fase="${f.chave}">${esc(f.rotulo)}</button>
  `).join("");
  container.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    estado[chaveEstado] = b.dataset.fase;
    aoTrocar();
  }));
  return estado[chaveEstado];
}

function tipoDaFase(camp, chaveFase) {
  return fasesDoFormato(camp).find((f) => f.chave === chaveFase)?.tipo ?? "liga";
}

/* =====================================================================
   AUTENTICAÇÃO
   ===================================================================== */

function tokenDoConvite() {
  return new URLSearchParams(location.search).get("convite");
}

// O campo Nome só aparece ao criar conta.
$('#form-auth [name="nome"]').closest("label").hidden = true;
$('#form-auth [name="nome"]').required = false;

$$(".aba-login").forEach((b) => b.addEventListener("click", () => {
  estado.modoAuth = b.dataset.modo;
  $$(".aba-login").forEach((x) => x.classList.toggle("ativa", x === b));
  const criando = estado.modoAuth === "criar";
  $('#form-auth [name="nome"]').closest("label").hidden = !criando;
  $('#form-auth [name="nome"]').required = criando;
  $('#form-auth [name="senha"]').autocomplete = criando ? "new-password" : "current-password";
  $("#form-auth button").textContent = criando ? "Criar conta" : "Entrar";
  $("#erro-auth").hidden = true;
}));

$("#form-auth").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const email = f.get("email").trim();
  const senha = f.get("senha");
  const botao = $("#form-auth button");
  botao.disabled = true;

  try {
    if (estado.modoAuth === "criar") {
      const { error } = await db.auth.signUp({
        email,
        password: senha,
        options: { data: { nome: f.get("nome").trim() } },
      });
      if (error) throw error;
      const { data } = await db.auth.getSession();
      if (!data.session) {
        mostrarErro("Conta criada. Confirme o e-mail que enviamos e volte para entrar.");
        return;
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password: senha });
      if (error) throw error;
    }
  } catch (e) {
    mostrarErro(traduzirErro(e.message));
  } finally {
    botao.disabled = false;
  }
});

function mostrarErro(msg) {
  const p = $("#erro-auth");
  p.textContent = msg;
  p.hidden = false;
}

function traduzirErro(msg = "") {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha não conferem.";
  if (/already registered/i.test(msg))        return "Esse e-mail já tem conta. Use a aba Entrar.";
  if (/at least 6/i.test(msg))                return "A senha precisa de pelo menos 6 caracteres.";
  return msg;
}

$("#btn-sair").addEventListener("click", () => db.auth.signOut());

db.auth.onAuthStateChange((_evento, sessao) => {
  estado.usuario = sessao?.user ?? null;
  iniciar();
});

/* =====================================================================
   BOOT
   ===================================================================== */

async function iniciar() {
  const convite = tokenDoConvite();

  if (!estado.usuario) {
    $("#carregando").hidden = true;
    $("#app").hidden = true;
    $("#tela-login").hidden = false;
    if (convite) {
      const aviso = $("#convite-aviso");
      aviso.textContent = "Você recebeu um convite. Crie sua conta para entrar no campeonato.";
      aviso.hidden = false;
      $('.aba-login[data-modo="criar"]').click();
    }
    return;
  }

  if (convite) {
    const { error } = await db.rpc("usar_convite", { p_token: convite });
    if (error) console.warn("Convite:", error.message);
    history.replaceState({}, "", location.pathname);
  }

  const { data: perfil } = await db.from("profiles").select("*").eq("id", estado.usuario.id).single();
  estado.perfil = perfil;

  $("#tela-login").hidden = true;
  $("#app").hidden = false;
  $("#carregando").hidden = true;
  $("#aba-admin").hidden = perfil?.role !== "admin";

  await carregarCampeonatos();
  trocarTela("tabela");
}

async function carregarCampeonatos() {
  const { data } = await db.from("campeonatos").select("*").order("criado_em", { ascending: false });
  estado.campeonatos = data ?? [];

  const sel = $("#seletor-campeonato");
  sel.innerHTML = estado.campeonatos.length
    ? estado.campeonatos.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("")
    : `<option value="">Nenhum campeonato</option>`;

  if (!estado.campeonatos.find((c) => c.id === estado.campeonatoId)) {
    estado.campeonatoId = estado.campeonatos[0]?.id ?? null;
  }
  sel.value = estado.campeonatoId ?? "";
}

$("#seletor-campeonato").addEventListener("change", (e) => {
  estado.campeonatoId = e.target.value || null;
  estado.faseTabela = null;
  estado.faseJogos = null;
  estado.faseAdmin = null;
  renderizarTelaAtual();
});

/* =====================================================================
   NAVEGAÇÃO
   ===================================================================== */

let telaAtual = "tabela";

$$(".aba").forEach((b) => b.addEventListener("click", () => trocarTela(b.dataset.tela)));

function trocarTela(nome) {
  telaAtual = nome;
  $$(".aba").forEach((b) => b.classList.toggle("ativa", b.dataset.tela === nome));
  $$(".tela").forEach((s) => (s.hidden = s.id !== `tela-${nome}`));
  renderizarTelaAtual();
}

function renderizarTelaAtual() {
  if (telaAtual === "tabela") renderClassificacao();
  if (telaAtual === "jogos")  renderJogos();
  if (telaAtual === "perfil") renderPerfil();
  if (telaAtual === "admin")  renderAdmin();
}

/* =====================================================================
   CLASSIFICAÇÃO
   ===================================================================== */

function montarTabelaHTML(data, meuId) {
  if (!data.length) return `<p class="vazio">Ninguém por aqui ainda.</p>`;
  return `
    <table class="tabela">
      <thead><tr>
        <th>#</th><th>Jogador</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th>
        <th class="gols">GP</th><th class="gols">GC</th><th>SG</th>
      </tr></thead>
      <tbody>
        ${data.map((l, i) => `
          <tr class="${i === 0 && l.jogos > 0 ? "lider" : ""} ${l.jogador_id === meuId ? "voce" : ""}">
            <td class="pos">${i + 1}</td>
            <td class="jogador">${esc(l.nome)}${l.time ? `<span class="time-mini">${esc(l.time)}</span>` : ""}</td>
            <td class="pontos">${l.pontos}</td>
            <td>${l.jogos}</td><td>${l.vitorias}</td><td>${l.empates}</td><td>${l.derrotas}</td>
            <td class="gols">${l.gols_pro}</td><td class="gols">${l.gols_contra}</td>
            <td>${l.saldo > 0 ? "+" : ""}${l.saldo}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function ordenarClassificacao(data) {
  return [...data].sort((a, b) =>
    b.pontos - a.pontos || b.saldo - a.saldo || b.gols_pro - a.gols_pro);
}

async function buscarClassificacao(fase) {
  const { data, error } = await db.from("classificacao").select("*")
    .eq("campeonato_id", estado.campeonatoId).eq("fase", fase);
  if (error) return [];
  return ordenarClassificacao(data);
}

async function renderClassificacao() {
  const alvo = $("#classificacao");
  const camp = campeonatoAtual();
  const abas = $("#abas-fase-tabela");

  if (!camp) {
    abas.hidden = true;
    $("#campeao-aviso").hidden = true;
    alvo.innerHTML = `<p class="vazio">Nenhum campeonato criado ainda.</p>`;
    $("#resumo-campeonato").textContent = "";
    return;
  }

  await renderAvisoCampeao(camp);

  const fase = renderAbasFase(abas, "faseTabela", renderClassificacao);
  const tipo = tipoDaFase(camp, fase);

  if (tipo === "chave") {
    $("#resumo-campeonato").textContent = "Formato eliminatório — sem tabela de pontos.";
    alvo.innerHTML = `<p class="vazio">Este trecho é decidido no chaveamento. Veja a aba <strong>Jogos</strong>.</p>`;
    return;
  }

  if (tipo === "liga_grupos") {
    const data = await buscarClassificacao(fase);
    if (!data.length) { alvo.innerHTML = `<p class="vazio">Os grupos ainda não foram sorteados.</p>`; $("#resumo-campeonato").textContent = ""; return; }
    const grupos = [...new Set(data.map((l) => l.grupo).filter(Boolean))].sort();
    $("#resumo-campeonato").textContent = `${grupos.length} grupos`;
    alvo.innerHTML = grupos.map((g) => `
      <h3 class="subtabela-titulo">Grupo ${esc(g)}</h3>
      ${montarTabelaHTML(data.filter((l) => l.grupo === g), estado.usuario.id)}
    `).join("");
    return;
  }

  // tipo === "liga"
  const data = await buscarClassificacao(fase);
  if (!data.length) { alvo.innerHTML = `<p class="vazio">Ninguém inscrito ainda. O admin adiciona os participantes no painel.</p>`; $("#resumo-campeonato").textContent = ""; return; }
  const disputados = data.reduce((s, l) => s + l.jogos, 0) / 2;
  $("#resumo-campeonato").textContent = `${data.length} jogadores · ${disputados} ${disputados === 1 ? "jogo disputado" : "jogos disputados"}`;
  alvo.innerHTML = montarTabelaHTML(data, estado.usuario.id);
}

async function renderAvisoCampeao(camp) {
  const aviso = $("#campeao-aviso");
  if (!camp.campeao_id) { aviso.hidden = true; return; }
  const { data } = await db.from("profiles").select("nome").eq("id", camp.campeao_id).single();
  aviso.hidden = false;
  aviso.textContent = `🏆 Campeão do ${camp.nome}: ${data?.nome ?? "—"}`;
}

/* =====================================================================
   JOGOS
   ===================================================================== */

const SELECT_PARTIDA =
  "*, mandante:profiles!partidas_mandante_id_fkey(id,nome), visitante:profiles!partidas_visitante_id_fkey(id,nome)";

async function buscarPartidas(fase) {
  let q = db.from("partidas").select(SELECT_PARTIDA).eq("campeonato_id", estado.campeonatoId);
  if (fase) q = q.eq("fase", fase);
  const { data } = await q.order("rodada").order("perna").order("id");
  return data ?? [];
}

$$(".chip[data-filtro]").forEach((c) => c.addEventListener("click", () => {
  estado.filtroJogos = c.dataset.filtro;
  $$(".chip[data-filtro]").forEach((x) => x.classList.toggle("ativa", x === c));
  renderJogos();
}));

function aplicarFiltro(partidas) {
  const eu = estado.usuario.id;
  if (estado.filtroJogos === "meus") return partidas.filter((p) => p.mandante_id === eu || p.visitante_id === eu);
  if (estado.filtroJogos === "pendentes") return partidas.filter((p) => p.status !== "finalizada" && p.status !== "bye");
  return partidas;
}

async function renderJogos() {
  const alvo = $("#lista-jogos");
  const camp = campeonatoAtual();
  const abas = $("#abas-fase-jogos");

  if (!camp) { abas.hidden = true; alvo.innerHTML = `<p class="vazio">Nenhum campeonato criado ainda.</p>`; return; }

  const fase = renderAbasFase(abas, "faseJogos", renderJogos);
  const tipo = tipoDaFase(camp, fase);

  const filtrosChips = document.querySelector(".filtros:not(#abas-fase-jogos)");
  if (filtrosChips) filtrosChips.hidden = tipo === "chave";

  if (tipo === "chave") {
    const partidas = await buscarPartidas(fase);
    alvo.innerHTML = partidas.length ? renderChaveHTML(partidas) : `<p class="vazio">Nenhum jogo por aqui ainda.</p>`;
    return;
  }

  const partidas = aplicarFiltro(await buscarPartidas(fase));
  if (!partidas.length) { alvo.innerHTML = `<p class="vazio">Nenhum jogo por aqui ainda.</p>`; return; }

  if (tipo === "liga_grupos") {
    const grupos = [...new Set(partidas.map((p) => p.grupo).filter(Boolean))].sort();
    alvo.innerHTML = grupos.map((g) => `
      <h3 class="subtabela-titulo">Grupo ${esc(g)}</h3>
      ${renderRodadasHTML(partidas.filter((p) => p.grupo === g))}
    `).join("");
    return;
  }

  alvo.innerHTML = renderRodadasHTML(partidas);
}

function agruparPorRodada(partidas) {
  return partidas.reduce((acc, p) => { (acc[p.rodada] ||= []).push(p); return acc; }, {});
}

function renderRodadasHTML(partidas) {
  const rodadas = agruparPorRodada(partidas);
  return Object.entries(rodadas).map(([r, jogos]) => `
    <h3 class="rodada-titulo">Rodada ${r}</h3>
    ${jogos.map(cartaoJogo).join("")}
  `).join("");
}

function cartaoJogo(p) {
  const fim = p.status === "finalizada";
  const casaVenceu = fim && p.gols_mandante > p.gols_visitante;
  const foraVenceu = fim && p.gols_visitante > p.gols_mandante;
  const placar = fim
    ? `<span class="placar">${p.gols_mandante} – ${p.gols_visitante}</span>`
    : `<span class="placar pendente">a jogar</span>`;

  return `<div class="jogo">
    <span class="casa ${casaVenceu ? "venceu" : foraVenceu ? "perdeu" : ""}">${esc(p.mandante?.nome)}</span>
    ${placar}
    <span class="fora ${foraVenceu ? "venceu" : casaVenceu ? "perdeu" : ""}">${esc(p.visitante?.nome)}</span>
  </div>`;
}

/* ---- Chaveamento (visualização) ---- */

function nomeDaRodada(numPartidasNaRodada) {
  return { 1: "Final", 2: "Semifinal", 4: "Quartas de final", 8: "Oitavas de final", 16: "Dezesseisavos de final" }
    [numPartidasNaRodada] || "Rodada";
}

function agruparPorConfronto(partidas) {
  const vistos = new Set();
  const confrontos = [];
  for (const p of partidas) {
    const chave = p.confronto_id ?? p.id;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    confrontos.push(partidas.filter((x) => (x.confronto_id ?? x.id) === chave).sort((a, b) => a.perna - b.perna));
  }
  return confrontos;
}

function renderChaveHTML(partidas) {
  const rodadas = {};
  partidas.forEach((p) => (rodadas[p.rodada] ||= []).push(p));
  const numerosRodada = Object.keys(rodadas).map(Number).sort((a, b) => a - b);

  const colunas = numerosRodada.map((r) => {
    const confrontos = agruparPorConfronto(rodadas[r]);
    const titulo = nomeDaRodada(confrontos.length);
    return `<div class="chave-coluna">
      <div class="chave-coluna-titulo">${esc(titulo)}</div>
      ${confrontos.map(cartaoConfronto).join("")}
    </div>`;
  });

  return `<div class="chave">${colunas.join("")}</div>`;
}

function nomeOuAguardando(perfil) {
  return perfil?.nome ? esc(perfil.nome) : `<span style="opacity:.6">a definir</span>`;
}

function cartaoConfronto(legs) {
  if (legs[0].status === "bye") {
    return `<div class="confronto"><div class="confronto-bye">${nomeOuAguardando(legs[0].mandante)} avança de graça (bye)</div></div>`;
  }

  if (legs.length === 1) {
    const p = legs[0];
    const fim = p.status === "finalizada";
    const casaVenceu = fim && venceuLeg(p, "mandante");
    const foraVenceu = fim && venceuLeg(p, "visitante");
    return `<div class="confronto ${fim ? "decidido" : ""}">
      <div class="confronto-linha ${casaVenceu ? "venceu" : ""}"><span class="nome">${nomeOuAguardando(p.mandante)}</span><span class="placar">${fim ? p.gols_mandante : "—"}</span></div>
      <div class="confronto-linha ${foraVenceu ? "venceu" : ""}"><span class="nome">${nomeOuAguardando(p.visitante)}</span><span class="placar">${fim ? p.gols_visitante : "—"}</span></div>
      ${fim && p.gols_mandante === p.gols_visitante ? `<div class="confronto-vs">pênaltis: ${p.pen_mandante ?? "—"} x ${p.pen_visitante ?? "—"}</div>` : ""}
    </div>`;
  }

  // ida e volta
  const [ida, volta] = legs;
  const fimIda = ida.status === "finalizada", fimVolta = volta.status === "finalizada";
  const agA = (fimIda ? ida.gols_mandante : 0) + (fimVolta ? volta.gols_visitante : 0);
  const agB = (fimIda ? ida.gols_visitante : 0) + (fimVolta ? volta.gols_mandante : 0);
  const decidido = fimIda && fimVolta;
  return `<div class="confronto ${decidido ? "decidido" : ""}">
    <div class="confronto-linha ${decidido && agA > agB ? "venceu" : ""}">
      <span class="nome">${nomeOuAguardando(ida.mandante)}</span>
      <span class="placar">${decidido ? agA : "—"}</span>
    </div>
    <div class="confronto-linha ${decidido && agB > agA ? "venceu" : ""}">
      <span class="nome">${nomeOuAguardando(ida.visitante)}</span>
      <span class="placar">${decidido ? agB : "—"}</span>
    </div>
    <div class="confronto-vs">
      ida ${fimIda ? `${ida.gols_mandante}-${ida.gols_visitante}` : "—"} ·
      volta ${fimVolta ? `${volta.gols_mandante}-${volta.gols_visitante}` : "—"}
      ${decidido && agA === agB ? ` · pênaltis ${volta.pen_mandante ?? "—"}x${volta.pen_visitante ?? "—"}` : ""}
    </div>
  </div>`;
}

function venceuLeg(p, lado) {
  return lado === "mandante" ? p.gols_mandante > p.gols_visitante : p.gols_visitante > p.gols_mandante;
}

/* =====================================================================
   PERFIL
   ===================================================================== */

async function renderPerfil() {
  const p = estado.perfil;
  $('#form-perfil [name="nome"]').value = p?.nome ?? "";
  $('#form-perfil [name="time"]').value = p?.time ?? "";

  const alvo = $("#cartao-perfil");
  const camp = campeonatoAtual();
  if (!camp) { alvo.innerHTML = ""; return; }

  const fases = fasesDoFormato(camp).filter((f) => f.tipo !== "chave");
  if (!fases.length) { alvo.innerHTML = `<div><span class="rotulo">Este formato é só eliminatório — confira seu desempenho na aba Jogos.</span></div>`; return; }

  const { data } = await db.from("classificacao").select("*")
    .eq("campeonato_id", estado.campeonatoId).eq("fase", fases[0].chave)
    .eq("jogador_id", estado.usuario.id).maybeSingle();

  if (!data) {
    alvo.innerHTML = `<div><span class="rotulo">Você não está inscrito neste campeonato.</span></div>`;
    return;
  }

  const aproveitamento = data.jogos ? Math.round((data.pontos / (data.jogos * 3)) * 100) : 0;
  alvo.innerHTML = `
    <div><span class="valor">${data.pontos}</span><span class="rotulo">pontos</span></div>
    <div><span class="valor">${data.vitorias}</span><span class="rotulo">vitórias</span></div>
    <div><span class="valor">${data.empates}</span><span class="rotulo">empates</span></div>
    <div><span class="valor">${data.derrotas}</span><span class="rotulo">derrotas</span></div>
    <div><span class="valor">${data.saldo > 0 ? "+" : ""}${data.saldo}</span><span class="rotulo">saldo de gols</span></div>
    <div><span class="valor">${aproveitamento}%</span><span class="rotulo">aproveitamento</span></div>`;
}

$("#form-perfil").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const { error } = await db.from("profiles")
    .update({ nome: f.get("nome").trim(), time: f.get("time").trim() || null })
    .eq("id", estado.usuario.id);

  if (error) { alert("Não foi possível salvar: " + error.message); return; }
  estado.perfil.nome = f.get("nome").trim();
  estado.perfil.time = f.get("time").trim() || null;
  $("#ok-perfil").hidden = false;
  setTimeout(() => ($("#ok-perfil").hidden = true), 2500);
});

/* =====================================================================
   ADMIN — criação de campeonato
   ===================================================================== */

$("#campo-formato").addEventListener("change", atualizarCamposFormato);
function atualizarCamposFormato() {
  const f = $("#campo-formato").value;
  $("#opcoes-liga").hidden = f !== "liga";
  $("#opcoes-mata-mata").hidden = f !== "mata_mata";
  $("#opcoes-grupos").hidden = f !== "grupos_mata_mata";
}
atualizarCamposFormato();

$("#form-campeonato").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const formato = f.get("formato");

  const linha = { nome: f.get("nome").trim(), formato };
  if (formato === "liga") linha.returno = f.get("returno") === "on";
  if (formato === "mata_mata") linha.ida_volta = f.get("ida_volta") === "on";
  if (formato === "grupos_mata_mata") {
    linha.num_grupos = Number(f.get("num_grupos")) || 2;
    linha.classificados_por_grupo = Number(f.get("classificados_por_grupo")) || 2;
    linha.ida_volta = f.get("ida_volta_mm") === "on";
  }

  const { data, error } = await db.from("campeonatos").insert(linha).select().single();
  if (error) { alert("Não foi possível criar: " + error.message); return; }

  ev.target.reset();
  atualizarCamposFormato();
  estado.campeonatoId = data.id;
  await carregarCampeonatos();
  $("#seletor-campeonato").value = data.id;
  renderAdmin();
});

/* =====================================================================
   ADMIN — painel
   ===================================================================== */

async function renderAdmin() {
  const camp = campeonatoAtual();
  $("#nome-campeonato-admin").textContent = camp ? camp.nome : "este campeonato";

  $("#painel-grupos").hidden = !camp || camp.formato !== "grupos_mata_mata";
  $("#btn-gerar-mata-mata").hidden = !camp || camp.formato !== "grupos_mata_mata";
  $("#btn-gerar-final").hidden = !camp || camp.formato !== "apertura_clausura";

  const textos = {
    liga: "Gera todos os confrontos de uma vez. Apaga os jogos existentes deste campeonato.",
    mata_mata: "Sorteia os confrontos e monta o chaveamento inteiro, com byes se o número de jogadores não for potência de 2.",
    grupos_mata_mata: "Sorteia os jogos DENTRO de cada grupo. Defina os grupos antes de gerar.",
    apertura_clausura: "Gera de uma vez os jogos do returno Apertura e do returno Clausura.",
  };
  $("#dica-gerar").textContent = camp ? textos[camp.formato] : "";
  $("#titulo-gerar").textContent = camp?.formato === "grupos_mata_mata" ? "Fase de grupos" : "Tabela de jogos";

  await renderParticipantes();
  if (camp?.formato === "grupos_mata_mata") await renderGrupos();
  await renderPlacaresAdmin();
}

async function renderParticipantes() {
  const alvo = $("#lista-participantes");
  if (!estado.campeonatoId) { alvo.innerHTML = `<p class="dica">Crie um campeonato primeiro.</p>`; return; }

  const [{ data: todos }, { data: inscritos }] = await Promise.all([
    db.from("profiles").select("id,nome").order("nome"),
    db.from("participantes").select("jogador_id").eq("campeonato_id", estado.campeonatoId),
  ]);

  const dentro = new Set((inscritos ?? []).map((i) => i.jogador_id));
  alvo.innerHTML = (todos ?? []).map((p) => `
    <label class="participante">
      <input type="checkbox" data-jogador="${p.id}" ${dentro.has(p.id) ? "checked" : ""}>
      ${esc(p.nome)}
    </label>`).join("");

  alvo.querySelectorAll("input").forEach((cb) => cb.addEventListener("change", async () => {
    const id = cb.dataset.jogador;
    const erro = cb.checked
      ? (await db.from("participantes").insert({ campeonato_id: estado.campeonatoId, jogador_id: id })).error
      : (await db.from("participantes").delete()
           .eq("campeonato_id", estado.campeonatoId).eq("jogador_id", id)).error;
    if (erro) { alert(erro.message); cb.checked = !cb.checked; }
  }));
}

/* ---- Grupos ---- */

function embaralhar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LETRAS = "ABCDEFGH";

async function renderGrupos() {
  const alvo = $("#grade-grupos");
  const { data } = await db.from("participantes")
    .select("grupo, jogador:profiles(id,nome)").eq("campeonato_id", estado.campeonatoId);

  const semGrupo = (data ?? []).filter((p) => !p.grupo);
  const grupos = {};
  (data ?? []).forEach((p) => { if (p.grupo) (grupos[p.grupo] ||= []).push(p.jogador?.nome); });

  if (!data?.length) { alvo.innerHTML = `<p class="dica">Marque os participantes acima primeiro.</p>`; return; }

  alvo.innerHTML = Object.keys(grupos).sort().map((g) => `
    <div class="grupo-bloco">
      <div class="grupo-titulo">Grupo ${esc(g)}</div>
      <div class="grupo-membros">${grupos[g].map(esc).join(", ")}</div>
    </div>`).join("") + (semGrupo.length
      ? `<p class="dica">${semGrupo.length} sem grupo ainda. Clique em "Sortear grupos".</p>` : "");
}

$("#btn-distribuir-grupos").addEventListener("click", async () => {
  if (!estado.campeonatoId) return;
  const camp = campeonatoAtual();
  const { data: inscritos } = await db.from("participantes")
    .select("jogador_id").eq("campeonato_id", estado.campeonatoId);

  const ids = embaralhar((inscritos ?? []).map((i) => i.jogador_id));
  if (ids.length < camp.num_grupos * 2) {
    alert(`Precisa de pelo menos ${camp.num_grupos * 2} participantes para ${camp.num_grupos} grupos.`);
    return;
  }

  const atualizacoes = ids.map((id, i) =>
    db.from("participantes").update({ grupo: LETRAS[i % camp.num_grupos] })
      .eq("campeonato_id", estado.campeonatoId).eq("jogador_id", id));
  await Promise.all(atualizacoes);
  renderGrupos();
});

/* ---- Geração de confrontos: liga (círculo) ---- */

function gerarConfrontosLiga(ids, returno) {
  const lista = [...ids];
  if (lista.length % 2) lista.push(null);
  const n = lista.length;
  const rodadas = [];
  for (let r = 0; r < n - 1; r++) {
    const jogos = [];
    for (let i = 0; i < n / 2; i++) {
      const a = lista[i], b = lista[n - 1 - i];
      if (a && b) jogos.push(i % 2 ? [b, a] : [a, b]);
    }
    rodadas.push(jogos);
    lista.splice(1, 0, lista.pop());
  }
  if (returno) rodadas.push(...rodadas.map((j) => j.map(([a, b]) => [b, a])));
  return rodadas;
}

/* ---- Geração de confrontos: chaveamento mata-mata ---- */

function construirChave(idsOriginais, idaVolta, fase) {
  const ids = embaralhar(idsOriginais);
  const n = ids.length;
  let tamanho = 1; while (tamanho < n) tamanho *= 2;
  const slots = [...ids, ...Array(tamanho - n).fill(null)];
  const numRodadas = Math.log2(tamanho);
  const todas = [];
  const rodadas = [];

  for (let r = 0; r < numRodadas; r++) {
    const numConfrontos = tamanho / Math.pow(2, r + 1);
    const confrontos = [];
    for (let i = 0; i < numConfrontos; i++) {
      let ehBye = false;
      if (r === 0) { const a = slots[i], b = slots[tamanho - 1 - i]; ehBye = !a || !b; }
      const pernas = idaVolta && !ehBye ? 2 : 1;
      const confrontoId = pernas === 2 ? crypto.randomUUID() : null;
      const legs = [];
      for (let p = 1; p <= pernas; p++) {
        legs.push({
          id: crypto.randomUUID(), campeonato_id: estado.campeonatoId, fase, rodada: r + 1, perna: p,
          confronto_id: confrontoId, mandante_id: null, visitante_id: null,
          status: "aguardando", alimenta_partida_id: null, alimenta_posicao: null,
        });
      }
      confrontos.push(legs);
      todas.push(...legs);
    }
    rodadas.push(confrontos);
  }

  for (let r = 0; r < numRodadas - 1; r++) {
    for (let i = 0; i < rodadas[r].length; i++) {
      const decisiva = rodadas[r][i][rodadas[r][i].length - 1];
      const alvo = rodadas[r + 1][Math.floor(i / 2)][0];
      decisiva.alimenta_partida_id = alvo.id;
      decisiva.alimenta_posicao = i % 2 === 0 ? "mandante" : "visitante";
    }
  }

  const porId = new Map(todas.map((m) => [m.id, m]));
  function preencher(alvoId, posicao, valor) {
    if (!alvoId) return;
    const alvo = porId.get(alvoId);
    alvo[posicao + "_id"] = valor;
    const irmao = alvo.confronto_id ? todas.find((m) => m.confronto_id === alvo.confronto_id && m.id !== alvo.id) : null;
    if (irmao) irmao[posicao === "mandante" ? "visitante_id" : "mandante_id"] = valor;
    if (alvo.mandante_id && alvo.visitante_id) alvo.status = "agendada";
    if (irmao && irmao.mandante_id && irmao.visitante_id) irmao.status = "agendada";
  }

  const primeira = rodadas[0];
  for (let i = 0; i < primeira.length; i++) {
    const a = slots[i], b = slots[tamanho - 1 - i];
    const c = primeira[i];
    if (a && b) {
      c[0].mandante_id = a; c[0].visitante_id = b; c[0].status = "agendada";
      if (c[1]) { c[1].mandante_id = b; c[1].visitante_id = a; c[1].status = "agendada"; }
    } else {
      const vencedor = a || b;
      c[0].mandante_id = vencedor; c[0].status = "bye";
      const decisiva = c[c.length - 1];
      if (decisiva.alimenta_partida_id) preencher(decisiva.alimenta_partida_id, decisiva.alimenta_posicao, vencedor);
    }
  }

  return todas;
}

async function inserirChave(todasAsPartidas) {
  // Insere da última rodada para a primeira: assim, quando uma partida
  // referencia a próxima via alimenta_partida_id, o alvo já existe no banco.
  const porRodada = {};
  todasAsPartidas.forEach((p) => (porRodada[p.rodada] ||= []).push(p));
  const rodadasDesc = Object.keys(porRodada).map(Number).sort((a, b) => b - a);
  for (const r of rodadasDesc) {
    const { error } = await db.from("partidas").insert(porRodada[r]);
    if (error) throw error;
  }
}

/* ---- Botão: Gerar confrontos ---- */

$("#btn-gerar").addEventListener("click", async () => {
  if (!estado.campeonatoId) return;
  const camp = campeonatoAtual();
  if (!confirm("Isso apaga os jogos e placares atuais deste campeonato. Continuar?")) return;

  const status = $("#status-gerar");
  status.textContent = "Gerando…";

  try {
    if (camp.formato === "liga") await gerarLiga(camp);
    else if (camp.formato === "mata_mata") await gerarMataMataCompleto(camp);
    else if (camp.formato === "grupos_mata_mata") await gerarGrupos(camp);
    else if (camp.formato === "apertura_clausura") await gerarAperturaClausura(camp);
    status.textContent = "Pronto.";
  } catch (e) {
    status.textContent = "Erro: " + e.message;
    return;
  }

  await db.from("campeonatos").update({ status: "em_andamento" }).eq("id", estado.campeonatoId);
  renderPlacaresAdmin();
});

async function idsInscritos() {
  const { data } = await db.from("participantes").select("jogador_id").eq("campeonato_id", estado.campeonatoId);
  return (data ?? []).map((i) => i.jogador_id);
}

async function gerarLiga(camp) {
  const ids = await idsInscritos();
  if (ids.length < 2) throw new Error("Precisa de pelo menos 2 participantes.");
  const rodadas = gerarConfrontosLiga(ids, camp.returno);
  const linhas = rodadas.flatMap((jogos, r) => jogos.map(([casa, fora]) => ({
    campeonato_id: estado.campeonatoId, fase: "liga", rodada: r + 1,
    mandante_id: casa, visitante_id: fora, status: "agendada",
  })));
  await db.from("partidas").delete().eq("campeonato_id", estado.campeonatoId);
  const { error } = await db.from("partidas").insert(linhas);
  if (error) throw error;
}

async function gerarMataMataCompleto(camp) {
  const ids = await idsInscritos();
  if (ids.length < 2) throw new Error("Precisa de pelo menos 2 participantes.");
  await db.from("partidas").delete().eq("campeonato_id", estado.campeonatoId);
  const partidas = construirChave(ids, camp.ida_volta, "mata_mata");
  await inserirChave(partidas);
}

async function gerarGrupos(camp) {
  const { data: inscritos } = await db.from("participantes")
    .select("jogador_id, grupo").eq("campeonato_id", estado.campeonatoId);
  if (!inscritos?.length) throw new Error("Marque os participantes primeiro.");
  if (inscritos.some((p) => !p.grupo)) throw new Error('Falta sortear os grupos — use o botão "Sortear grupos".');

  const porGrupo = {};
  inscritos.forEach((p) => (porGrupo[p.grupo] ||= []).push(p.jogador_id));

  const linhas = [];
  for (const [grupo, ids] of Object.entries(porGrupo)) {
    if (ids.length < 2) continue;
    gerarConfrontosLiga(ids, false).forEach((jogos, r) => jogos.forEach(([casa, fora]) => linhas.push({
      campeonato_id: estado.campeonatoId, fase: "grupos", grupo, rodada: r + 1,
      mandante_id: casa, visitante_id: fora, status: "agendada",
    })));
  }
  await db.from("partidas").delete().eq("campeonato_id", estado.campeonatoId);
  const { error } = await db.from("partidas").insert(linhas);
  if (error) throw error;
}

async function gerarAperturaClausura(camp) {
  const ids = await idsInscritos();
  if (ids.length < 2) throw new Error("Precisa de pelo menos 2 participantes.");
  const linhas = [];
  for (const fase of ["apertura", "clausura"]) {
    gerarConfrontosLiga(ids, false).forEach((jogos, r) => jogos.forEach(([casa, fora]) => linhas.push({
      campeonato_id: estado.campeonatoId, fase, rodada: r + 1,
      mandante_id: casa, visitante_id: fora, status: "agendada",
    })));
  }
  await db.from("partidas").delete().eq("campeonato_id", estado.campeonatoId);
  const { error } = await db.from("partidas").insert(linhas);
  if (error) throw error;
}

/* ---- Botão: gerar mata-mata a partir dos classificados dos grupos ---- */

$("#btn-gerar-mata-mata").addEventListener("click", async () => {
  const camp = campeonatoAtual();
  const status = $("#status-gerar");
  const { data } = await db.from("partidas").select("status")
    .eq("campeonato_id", estado.campeonatoId).eq("fase", "grupos");
  if (data?.some((p) => p.status !== "finalizada")) {
    if (!confirm("Ainda tem jogo de grupo sem placar. Gerar mesmo assim?")) return;
  }

  const classificacao = await buscarClassificacao("grupos");
  const porGrupo = {};
  classificacao.forEach((l) => (porGrupo[l.grupo] ||= []).push(l));
  const classificados = Object.values(porGrupo).flatMap((lista) =>
    lista.slice(0, camp.classificados_por_grupo).map((l) => l.jogador_id));

  if (classificados.length < 2) { status.textContent = "Classificados insuficientes."; return; }

  await db.from("partidas").delete().eq("campeonato_id", estado.campeonatoId).eq("fase", "mata_mata");
  const partidas = construirChave(classificados, camp.ida_volta, "mata_mata");
  await inserirChave(partidas);
  status.textContent = `Mata-mata gerado com ${classificados.length} classificados.`;
  renderPlacaresAdmin();
});

/* ---- Botão: gerar grande final (Apertura x Clausura) ---- */

$("#btn-gerar-final").addEventListener("click", async () => {
  const camp = campeonatoAtual();
  const status = $("#status-gerar");
  const [apertura, clausura] = await Promise.all([
    buscarClassificacao("apertura"), buscarClassificacao("clausura"),
  ]);
  if (!apertura.length || !clausura.length) { status.textContent = "Gere e finalize as duas fases antes."; return; }

  const campeaoApertura = apertura[0].jogador_id;
  const campeaoClausura = clausura[0].jogador_id;

  if (campeaoApertura === campeaoClausura) {
    await db.from("campeonatos").update({ campeao_id: campeaoApertura, status: "encerrado" }).eq("id", estado.campeonatoId);
    status.textContent = "Campeão decidido direto: venceu Apertura e Clausura.";
  } else {
    await db.from("partidas").delete().eq("campeonato_id", estado.campeonatoId).eq("fase", "final_unificada");
    const partidas = construirChave([campeaoApertura, campeaoClausura], camp.ida_volta, "final_unificada");
    await inserirChave(partidas);
    status.textContent = "Grande final gerada.";
  }
  await carregarCampeonatos();
  renderAdmin();
});

/* ---- Lançamento de placares ---- */

async function renderPlacaresAdmin() {
  const alvo = $("#admin-jogos");
  const camp = campeonatoAtual();
  if (!camp) { alvo.innerHTML = `<p class="dica">Crie um campeonato primeiro.</p>`; return; }

  const fases = fasesDoFormato(camp);
  if (!estado.faseAdmin || !fases.some((f) => f.chave === estado.faseAdmin)) estado.faseAdmin = fases[0].chave;

  const tabsHtml = fases.length > 1 ? `<div class="filtros" style="margin-bottom:14px">
    ${fases.map((f) => `<button type="button" class="chip admin-fase-chip ${f.chave === estado.faseAdmin ? "ativa" : ""}" data-fase="${f.chave}">${esc(f.rotulo)}</button>`).join("")}
  </div>` : "";

  const fase = estado.faseAdmin;
  const tipo = tipoDaFase(camp, fase);
  const partidas = await buscarPartidas(fase);

  let corpo;
  if (!partidas.length) {
    corpo = `<p class="dica">Nenhum jogo gerado nesta fase ainda.</p>`;
  } else if (tipo === "chave") {
    corpo = renderPlacaresChaveHTML(partidas);
  } else if (tipo === "liga_grupos") {
    const grupos = [...new Set(partidas.map((p) => p.grupo).filter(Boolean))].sort();
    corpo = grupos.map((g) => `
      <h3 class="subtabela-titulo">Grupo ${esc(g)}</h3>
      ${renderPlacaresLigaHTML(partidas.filter((p) => p.grupo === g))}
    `).join("");
  } else {
    corpo = renderPlacaresLigaHTML(partidas);
  }

  alvo.innerHTML = tabsHtml + corpo;

  alvo.querySelectorAll(".admin-fase-chip").forEach((b) => b.addEventListener("click", () => {
    estado.faseAdmin = b.dataset.fase;
    renderPlacaresAdmin();
  }));
  alvo.querySelectorAll(".salvar-placar").forEach((b) => b.addEventListener("click", salvarPlacar));
}

function renderPlacaresLigaHTML(partidas) {
  const rodadas = agruparPorRodada(partidas);
  return Object.entries(rodadas).map(([r, jogos]) => `
    <h3 class="rodada-titulo">Rodada ${r}</h3>
    ${jogos.map((p) => `
      <div class="linha-placar" data-partida="${p.id}">
        <span class="nome-casa">${esc(p.mandante?.nome)}</span>
        <input type="number" min="0" max="99" class="gols-casa" value="${p.gols_mandante ?? ""}">
        <input type="number" min="0" max="99" class="gols-fora" value="${p.gols_visitante ?? ""}">
        <span class="nome-fora">${esc(p.visitante?.nome)}</span>
        <button class="btn-texto salvar-placar" type="button">Salvar</button>
      </div>`).join("")}
  `).join("");
}

function renderPlacaresChaveHTML(partidas) {
  const rodadas = {};
  partidas.forEach((p) => (rodadas[p.rodada] ||= []).push(p));
  const numerosRodada = Object.keys(rodadas).map(Number).sort((a, b) => a - b);

  return numerosRodada.map((r) => {
    const confrontos = agruparPorConfronto(rodadas[r]);
    const titulo = nomeDaRodada(confrontos.length);
    return `<div class="confronto-agrupador">
      <h3 class="rodada-titulo">${esc(titulo)}</h3>
      ${confrontos.map(linhaPlacarConfronto).join("")}
    </div>`;
  }).join("");
}

function linhaPlacarConfronto(legs) {
  if (legs[0].status === "bye") {
    return `<p class="dica">${esc(legs[0].mandante?.nome)} — classificado direto (bye)</p>`;
  }
  if (legs[0].status === "aguardando") {
    return `<p class="dica">Aguardando definição dos classificados desta chave.</p>`;
  }
  return legs.map((p, i) => `
    <div class="linha-placar leg" data-partida="${p.id}">
      ${legs.length > 1 ? `<span class="leg-rotulo">${i === 0 ? "Ida" : "Volta"}</span>` : ""}
      <span class="nome-casa">${esc(p.mandante?.nome)}</span>
      <input type="number" min="0" max="99" class="gols-casa" value="${p.gols_mandante ?? ""}">
      <input type="number" min="0" max="99" class="gols-fora" value="${p.gols_visitante ?? ""}">
      <span class="nome-fora">${esc(p.visitante?.nome)}</span>
      <button class="btn-texto salvar-placar" type="button">Salvar</button>
      ${i === legs.length - 1 ? `
        <div class="pen-inputs">
          Pênaltis (só se empatar): <input type="number" min="0" max="99" class="pen-casa" value="${p.pen_mandante ?? ""}">
          x <input type="number" min="0" max="99" class="pen-fora" value="${p.pen_visitante ?? ""}">
        </div>` : ""}
    </div>`).join("");
}

async function salvarPlacar(ev) {
  const linha = ev.target.closest(".linha-placar");
  const casa = linha.querySelector(".gols-casa").value;
  const fora = linha.querySelector(".gols-fora").value;
  const penCasaEl = linha.querySelector(".pen-casa");
  const penForaEl = linha.querySelector(".pen-fora");
  const botao = ev.target;
  const partidaId = linha.dataset.partida;

  const vazio = casa === "" || fora === "";
  const atualizacao = {
    gols_mandante: vazio ? null : Number(casa),
    gols_visitante: vazio ? null : Number(fora),
    status: vazio ? "agendada" : "finalizada",
    jogada_em: vazio ? null : new Date().toISOString(),
  };
  if (penCasaEl) atualizacao.pen_mandante = penCasaEl.value === "" ? null : Number(penCasaEl.value);
  if (penForaEl) atualizacao.pen_visitante = penForaEl.value === "" ? null : Number(penForaEl.value);

  const { data: salvo, error } = await db.from("partidas").update(atualizacao).eq("id", partidaId).select().single();
  botao.textContent = error ? "Erro" : "Salvo";
  setTimeout(() => (botao.textContent = "Salvar"), 1800);
  if (error) return;

  if (!vazio && (salvo.fase === "mata_mata" || salvo.fase === "final_unificada")) {
    await processarResultado(salvo);
    renderPlacaresAdmin();
  }
}

/* ---- Avanço automático de vencedores no chaveamento ---- */

async function calcularVencedor(partida) {
  if (partida.confronto_id) {
    const { data: pernas } = await db.from("partidas").select("*").eq("confronto_id", partida.confronto_id);
    if (pernas.some((p) => p.status !== "finalizada")) return null;
    const agregado = {};
    pernas.forEach((p) => {
      agregado[p.mandante_id] = (agregado[p.mandante_id] || 0) + p.gols_mandante;
      agregado[p.visitante_id] = (agregado[p.visitante_id] || 0) + p.gols_visitante;
    });
    const [idA, idB] = Object.keys(agregado);
    if (agregado[idA] !== agregado[idB]) return agregado[idA] > agregado[idB] ? idA : idB;
    const decisiva = pernas.find((p) => p.perna === 2) ?? pernas[pernas.length - 1];
    if (decisiva.pen_mandante == null || decisiva.pen_visitante == null) return null;
    return decisiva.pen_mandante > decisiva.pen_visitante ? decisiva.mandante_id : decisiva.visitante_id;
  }
  if (partida.gols_mandante === partida.gols_visitante) {
    if (partida.pen_mandante == null || partida.pen_visitante == null) return null;
    return partida.pen_mandante > partida.pen_visitante ? partida.mandante_id : partida.visitante_id;
  }
  return partida.gols_mandante > partida.gols_visitante ? partida.mandante_id : partida.visitante_id;
}

async function processarResultado(partida) {
  const vencedorId = await calcularVencedor(partida);
  if (!vencedorId) return; // falta a outra perna, ou falta pênaltis

  if (!partida.alimenta_partida_id) {
    // topo da chave: temos um campeão
    await db.from("campeonatos").update({ campeao_id: vencedorId, status: "encerrado" }).eq("id", estado.campeonatoId);
    await carregarCampeonatos();
    return;
  }

  const campo = partida.alimenta_posicao + "_id";
  await db.from("partidas").update({ [campo]: vencedorId }).eq("id", partida.alimenta_partida_id);

  const { data: alvo } = await db.from("partidas").select("*").eq("id", partida.alimenta_partida_id).single();
  if (alvo.confronto_id) {
    const { data: irmao } = await db.from("partidas").select("*")
      .eq("confronto_id", alvo.confronto_id).neq("id", alvo.id).maybeSingle();
    if (irmao) {
      const campoOposto = partida.alimenta_posicao === "mandante" ? "visitante_id" : "mandante_id";
      await db.from("partidas").update({ [campoOposto]: vencedorId }).eq("id", irmao.id);
    }
  }

  // libera o jogo assim que os dois lados estiverem definidos
  const { data: alvoAtual } = await db.from("partidas").select("*").eq("id", alvo.id).single();
  if (alvoAtual.mandante_id && alvoAtual.visitante_id && alvoAtual.status === "aguardando") {
    await db.from("partidas").update({ status: "agendada" }).eq("id", alvo.id);
  }
  if (alvo.confronto_id) {
    const { data: irmaoAtual } = await db.from("partidas").select("*")
      .eq("confronto_id", alvo.confronto_id).neq("id", alvo.id).maybeSingle();
    if (irmaoAtual && irmaoAtual.mandante_id && irmaoAtual.visitante_id && irmaoAtual.status === "aguardando") {
      await db.from("partidas").update({ status: "agendada" }).eq("id", irmaoAtual.id);
    }
  }
}

/* ---- Convite por QR ---- */

$("#btn-convite").addEventListener("click", async () => {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const { error } = await db.from("convites").insert({
    token,
    campeonato_id: estado.campeonatoId,
    criado_por: estado.usuario.id,
  });
  if (error) { alert("Não foi possível gerar: " + error.message); return; }

  const link = `${location.origin}${location.pathname}?convite=${token}`;
  $("#link-convite").value = link;
  $("#qr").innerHTML = "";
  new QRCode($("#qr"), { text: link, width: 190, height: 190 });
  $("#area-qr").hidden = false;
});

$("#btn-copiar").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#link-convite").value);
  $("#btn-copiar").textContent = "Copiado";
  setTimeout(() => ($("#btn-copiar").textContent = "Copiar link"), 1800);
});
