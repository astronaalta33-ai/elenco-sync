# Elenco Sync — SofaScore → Challenge Place (v1.2.0)

Aplicativo web Node.js 18+ para importar um elenco do SofaScore, localizar a equipe já cadastrada em um challenge do Challenge Place e transferir os jogadores para a aba **Players/Jogadores** do perfil dessa equipe.

## Iniciar

```bash
npm start
```

Abra `http://localhost:4173`.

## Fluxo de importação

1. Cole o link de um time no SofaScore (FC Barcelona já vem preenchido).
2. Clique em **Importar jogadores**. O servidor consulta o endpoint JSON usado pelo site do SofaScore e devolve foto, nome, número e posição.
3. O app consulta a lista pública de **Competitors** no Challenge Place e compara nomes, siglas e variações. Selecione a equipe existente.
4. Revise os atletas e marque os que deseja enviar.
5. Clique em **Enviar para equipe**. O app copia um pacote JSON com os jogadores e os IDs exatos do challenge/equipe e abre o perfil selecionado.
6. No perfil, abra o botão flutuante **Importar elenco**, cole o JSON (ou carregue o arquivo JSON baixado), valide e inicie.

## Integração de gravação (helper do navegador)

A gravação é feita pela interface do Challenge Place usando sua sessão normal de navegador. O projeto inclui duas opções no diretório `browser-helper/`:

### Chrome / Chromium (desktop)

1. Extraia o projeto ZIP.
2. Abra `chrome://extensions` (ou a tela equivalente do Chromium).
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta `browser-helper/`.
5. Entre na sua conta do Challenge Place normalmente e abra o perfil da equipe que o Elenco Sync selecionou.
6. Use **Enviar para equipe** no app; no perfil, clique em **⚽ Importar elenco**, cole o pacote JSON e clique em **Validar pacote**.
7. Clique em **Iniciar importação**. O helper tenta abrir Players/Jogadores e o formulário de Add player/Adicionar jogador, mapear Nome, Número, Posição e Foto e salvar em sequência.

### Navegadores com Tampermonkey (incluindo alguns navegadores Android)

1. Instale o Tampermonkey no navegador compatível.
2. Importe/instale `browser-helper/elenco-sync.user.js`.
3. Permita que o userscript execute em `challenge.place`.
4. Repita os passos de colar o pacote e iniciar no perfil da equipe.

O Chrome padrão para Android não oferece instalação normal de extensões. Nesse caso, use um navegador Android compatível com extensões/userscripts (por exemplo, Kiwi Browser, conforme disponibilidade do seu dispositivo) ou faça a etapa de gravação em um computador.

### Segurança e limites do helper

- Não solicita, lê ou armazena sua senha, cookies ou tokens.
- Atua apenas em perfis `/c/{challengeId}/competitor/{competitorId}` do Challenge Place.
- A permissão de imagem é limitada ao domínio `img.sofascore.com` e a caminhos de foto de jogador.
- Faz uma checagem de nomes existentes e pode pular jogadores já listados.
- Só tenta salvar quando reconhece os quatro campos necessários (nome, número, posição e foto) e um botão de envio seguro. O mapeamento pode ser conferido/ajustado no painel.
- Se a tela do Challenge Place não expuser um formulário reconhecível, se faltar um desses campos ou se o resultado do salvamento não puder ser confirmado, o processo pausa. Não tenta chamar endpoints privados desconhecidos nem simula sucesso.
- A estrutura do Challenge Place pode variar por tipo de challenge, idioma, permissões da conta ou atualizações do site. O helper é um adaptador beta de interface; ainda precisa ser validado no formulário real da sua conta.

## Origem SofaScore

O servidor consulta `https://www.sofascore.com/api/v1/team/{id}/players`, endpoint utilizado pela interface pública do SofaScore. Ele não é tratado como API oficial com disponibilidade garantida. O SofaScore pode alterar o formato ou bloquear consultas automatizadas. Quando isso ocorrer, use **Importar JSON**.

## Busca da equipe

O servidor lê a lista pública `https://challenge.place/c/{challengeId}/competitors` e extrai os links no padrão `/c/{challengeId}/competitor/{competitorId}`. O matching é local; não envia nomes a um serviço externo de IA.

## Testes

- Sintaxe Node.js validada para `server.mjs`, `browser-helper/content.js`, `browser-helper/background.js` e `browser-helper/elenco-sync.user.js`.
- A rota `/api/health` foi testada localmente.
- O preenchimento/salvamento no Challenge Place não foi testado com sua sessão autenticada; só pode ser confirmado quando o helper rodar no perfil real da equipe com a sua conta.
