# e-Expedition

Campeonato de FIFA entre amigos. Site estático (sem build, sem npm) com Supabase
como banco e autenticação, hospedado no Cloudflare Pages.

```
index.html    estrutura das telas
style.css     estilos
app.js        toda a lógica
schema.sql    banco de dados — rode uma vez no Supabase
```

## 1. Supabase

1. Crie um projeto em supabase.com.
2. Vá em **SQL Editor**, cole o conteúdo de `schema.sql` e execute.
3. Em **Authentication → Providers → Email**, deixe *Confirm email* **desligado**.
   Com ele ligado, cada amigo precisa confirmar o e-mail antes de entrar — dá pra
   manter ligado, só avise a galera.
4. Em **Project Settings → API**, copie a *Project URL* e a chave *anon public*.
5. Cole as duas no topo do `app.js`.

A chave anon é pública por natureza — ela aparece no código do site e tudo bem.
Quem impede alguém de mexer nos dados são as políticas de RLS do `schema.sql`:
quem está logado só lê, e apenas admin escreve.

## 2. Primeiro admin

A **primeira conta criada** vira admin automaticamente. Crie a sua antes de
convidar qualquer pessoa.

Para promover mais alguém depois, rode no SQL Editor:

```sql
update profiles set role = 'admin' where nome = 'Fulano';
```

Isso é de propósito: o site não tem botão de virar admin, então ninguém se
promove sozinho mexendo no DevTools.

## 3. GitHub + Cloudflare

1. Suba os quatro arquivos num repositório.
2. No Cloudflare, **Workers & Pages → Create → Pages → Connect to Git**.
3. Framework preset: **None**. Build command: vazio. Output directory: `/`.
4. Salve. A partir daí, todo `git push` publica sozinho.

Depois de publicar, volte no Supabase em **Authentication → URL Configuration**
e coloque a URL do site em *Site URL*.

## 4. Como usar

**Admin:** cria o campeonato (com ou sem returno), marca quem participa, clica
em *Gerar confrontos* e depois lança os placares. O botão de convite gera um QR
Code válido por 7 dias — o amigo escaneia, cria a conta e já entra inscrito.

**Jogadores:** veem a classificação, os jogos e o próprio desempenho.

A tabela de classificação é uma *view* calculada a partir dos placares. Corrigiu
um resultado errado? A tabela se ajusta sozinha, sem risco de dessincronizar.

## Ideias para depois

- Mata-mata e fase de grupos
- Artilharia (gols por jogador, exige registrar gols individuais)
- Histórico de confrontos diretos entre dois jogadores
- Notificação no Discord/Telegram quando sai um resultado
- Login por QR entre dispositivos (precisa de Supabase Realtime)
