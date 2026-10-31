// ==UserScript==
// @name         Elenco Sync — Challenge Place Helper
// @namespace    https://challenge.place/
// @version      1.2.0
// @description  Importa em lote jogadores do SofaScore para a equipe aberta no Challenge Place.
// @match        https://challenge.place/c/*/competitor/*
// @match        https://www.challenge.place/c/*/competitor/*
// @grant        GM_xmlhttpRequest
// @connect      img.sofascore.com
// @run-at       document-idle
// ==/UserScript==

(() => {
  if (window.__ELENCO_SYNC_HELPER__) return;
  window.__ELENCO_SYNC_HELPER__ = true;

  const normalize = value => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const textOf = el => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const isPanelElement = el => Boolean(el?.closest?.('#elenco-sync-host'));

  const host = document.createElement('div');
  host.id = 'elenco-sync-host';
  host.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;font:14px/1.4 system-ui,sans-serif;color:#edf4ff;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box} .launcher{border:0;border-radius:999px;padding:13px 17px;background:#21c992;color:#06251d;font-weight:800;box-shadow:0 8px 28px #0006;cursor:pointer}
      .panel{display:none;width:min(390px,calc(100vw - 28px));max-height:min(78vh,720px);overflow:auto;background:#101d2e;border:1px solid #38516b;border-radius:17px;padding:15px;box-shadow:0 15px 50px #0009;margin-bottom:10px}
      .panel.open{display:block}.head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.head strong{font-size:15px}.close{background:#263c56;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer}
      p{color:#afc0d4;font-size:12px;margin:7px 0 11px}.field{width:100%;background:#081524;border:1px solid #344c66;color:#edf4ff;border-radius:10px;padding:10px;font:12px/1.4 ui-monospace,monospace;min-height:120px;resize:vertical}
      .btn{border:0;border-radius:9px;padding:10px 12px;font-weight:750;cursor:pointer;background:#21c992;color:#04251c}.btn.secondary{background:#29415d;color:#eef5ff;border:1px solid #3b5673}.btn.danger{background:#5a2934;color:#ffe1e4}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}.status{background:#0a1727;border:1px solid #344a62;padding:9px 10px;border-radius:9px;color:#bdd0e4;font-size:12px;margin-top:10px;white-space:pre-wrap}.status.ok{border-color:#287253;color:#9af0ca}.status.error{border-color:#803f4d;color:#ffb6bd}
      .mapping{margin-top:10px;display:grid;gap:8px}.maprow{display:grid;grid-template-columns:minmax(0,1fr) 126px;align-items:center;gap:8px;font-size:12px}.maprow select{width:100%;padding:7px;background:#081524;color:#edf4ff;border:1px solid #344c66;border-radius:8px}.small{font-size:11px;color:#9fb3c9}.progress{height:6px;background:#273b52;border-radius:9px;overflow:hidden;margin-top:9px}.progress span{display:block;height:100%;width:0;background:#21c992;transition:width .2s}
      .check{display:flex;align-items:center;gap:8px;font-size:12px;margin-top:10px;color:#d6e3f3}.check input{accent-color:#21c992}
    </style>
    <div class="panel" id="panel">
      <div class="head"><strong>ELENCO SYNC · Challenge Place</strong><button class="close" id="close">Fechar</button></div>
      <p>Entre na aba <b>Players/Jogadores</b> da equipe, cole o pacote JSON copiado pelo Elenco Sync e inicie. O helper usa a sua sessão já autenticada no Challenge Place.</p>
      <textarea class="field" id="payload" placeholder="Cole aqui o pacote JSON do Elenco Sync…"></textarea>
      <div class="actions"><label class="btn secondary" for="packageFile">Carregar arquivo JSON</label><input id="packageFile" type="file" accept=".json,application/json" style="display:none"><button class="btn" id="load">Validar pacote</button><button class="btn secondary" id="inspect">Detectar formulário</button></div>
      <div id="mapping" class="mapping"></div>
      <label class="check"><input type="checkbox" id="skipDuplicates" checked> Pular jogadores que já aparecem na equipe</label>
      <label class="check"><input type="checkbox" id="autoSave" checked> Salvar automaticamente quando todos os campos forem reconhecidos</label>
      <div class="actions"><button class="btn" id="start" disabled>Iniciar importação</button><button class="btn secondary" id="resume" disabled>Retomar</button><button class="btn danger" id="stop" disabled>Parar</button></div>
      <div class="progress"><span id="bar"></span></div>
      <div class="status" id="status">Aguardando pacote JSON.</div>
      <div class="small" id="detail"></div>
    </div>
    <button class="launcher" id="launcher">⚽ Importar elenco</button>
  `;
  (document.documentElement || document.body).appendChild(host);

  const $ = id => shadow.getElementById(id);
  let payload = null;
  let fieldMap = [];
  let running = false;
  let stopRequested = false;
  let currentIndex = 0;
  let existingNames = new Set();

  function setStatus(message, kind = '') {
    $('status').textContent = message;
    $('status').className = `status ${kind}`.trim();
  }
  function setProgress(done, total) {
    $('bar').style.width = `${total ? Math.min(100, done / total * 100) : 0}%`;
  }
  function openPanel() { $('panel').classList.add('open'); }
  function closePanel() { $('panel').classList.remove('open'); }

  function routeIds() {
    const m = location.pathname.match(/^\/c\/([^/]+)\/competitor\/([a-f0-9]{16,32})\/?$/i);
    return m ? { challengeId: m[1], competitorId: m[2] } : null;
  }

  function validatePackage(raw) {
    let obj;
    try { obj = JSON.parse(raw); } catch { throw new Error('JSON inválido. Copie o pacote pelo botão “Preparar no Challenge Place” do Elenco Sync.'); }
    const players = Array.isArray(obj) ? obj : obj.players;
    if (!Array.isArray(players) || !players.length) throw new Error('O pacote não contém jogadores.');
    const target = obj.target || {};
    const current = routeIds();
    if (target.challengeId && current && String(target.challengeId) !== current.challengeId) throw new Error('O pacote pertence a outro challenge. Abra o perfil da equipe do challenge correto.');
    if (target.competitorId && current && String(target.competitorId) !== current.competitorId) throw new Error('O pacote aponta para outra equipe. Abra o perfil da equipe selecionada no Elenco Sync.');
    const clean = players.map((p, i) => {
      const name = String(p.name || p.playerName || '').trim();
      if (!name) throw new Error(`O jogador ${i + 1} está sem nome.`);
      return {
        id: String(p.id || ''), name,
        number: String(p.number ?? p.jerseyNumber ?? '').trim(),
        position: String(p.position || p.positionName || '').trim(),
        photo: String(p.photo || p.image || '').trim()
      };
    });
    return { ...obj, players: clean };
  }

  function clickableElements() {
    return [...document.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]')]
      .filter(el => visible(el) && !isPanelElement(el));
  }

  async function openPlayersTab() {
    const tab = clickableElements().find(el => {
      const label = normalize(`${textOf(el)} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`);
      return /^(players|jogadores)$/.test(label) || /^(players|jogadores)\s+\d+$/.test(label);
    });
    if (tab) {
      tab.click();
      await sleep(700);
    }
  }

  function addPlayerControl() {
    const exact = clickableElements().filter(el => {
      const label = normalize(`${textOf(el)} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`);
      return /(add|new|create|adicionar|novo|criar).{0,22}(player|jogador)|(player|jogador).{0,22}(add|new|create|adicionar|novo|criar)/.test(label);
    });
    return exact.sort((a, b) => textOf(a).length - textOf(b).length)[0] || null;
  }

  function describeField(el) {
    const bits = [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.id, el.getAttribute('title')];
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) bits.push(textOf(label));
    }
    const parentLabel = el.closest('label');
    if (parentLabel) bits.push(textOf(parentLabel));
    const parent = el.parentElement;
    if (parent) bits.push((textOf(parent).split('\n')[0] || '').slice(0, 80));
    return bits.filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim();
  }

  function visibleFormFields() {
    const rootCandidates = [
      ...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog,form')
    ].filter(el => visible(el) && !isPanelElement(el));
    const root = rootCandidates.find(el => el.querySelector('input:not([type=hidden]),select,textarea')) || null;
    if (!root) return { root: null, fields: [] };
    const fields = [...root.querySelectorAll('input,select,textarea')]
      .filter(el => (visible(el) || (el.type || '').toLowerCase() === 'file') && !isPanelElement(el) && !['hidden','submit','button','reset','checkbox','radio'].includes((el.type || '').toLowerCase()));
    return { root, fields: [...new Set(fields)] };
  }

  function inferRole(description, el) {
    const d = normalize(description);
    if ((el.type || '').toLowerCase() === 'file' || /(photo|image|picture|avatar|foto|imagem|escudo)/.test(d)) return 'photo';
    if (/(position|posicao|role|funcao|função)/.test(d)) return 'position';
    if (/(jersey|shirt|number|numero|camisa|dorsal)/.test(d)) return 'number';
    if (/(player name|name|nome|jogador)/.test(d) && !/(team|equipe|position|posicao|number|numero)/.test(d)) return 'name';
    return 'ignore';
  }

  function detectFields() {
    const { root, fields } = visibleFormFields();
    if (!fields.length) return { root, fields: [] };
    return { root, fields: fields.map((el, index) => ({ el, index, description: describeField(el) || `${el.tagName.toLowerCase()} ${index + 1}`, role: inferRole(describeField(el), el) })) };
  }

  function drawMapping() {
    const container = $('mapping');
    if (!fieldMap.length) { container.innerHTML = ''; return; }
    const roles = [
      ['ignore', 'Ignorar'], ['name', 'Nome do jogador'], ['number', 'Número'],
      ['position', 'Posição'], ['photo', 'Foto (URL/arquivo)']
    ];
    container.innerHTML = `<div class="small">Campos detectados no formulário. Confira o mapeamento antes de iniciar:</div>` + fieldMap.map((field, i) => `
      <label class="maprow"><span title="${escapeHtml(field.description)}">${escapeHtml(field.description.slice(0, 60))}</span>
        <select data-map-index="${i}">${roles.map(([value,label]) => `<option value="${value}" ${field.role === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
      </label>`).join('');
    container.querySelectorAll('select[data-map-index]').forEach(select => select.addEventListener('change', () => {
      fieldMap[Number(select.dataset.mapIndex)].role = select.value;
    }));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function getExistingPlayerNames() {
    const names = new Set();
    const links = [...document.querySelectorAll('a[href*="/player/"]')].filter(visible);
    for (const link of links) {
      const name = normalize(textOf(link) || link.getAttribute('aria-label') || link.getAttribute('title'));
      if (name) names.add(name);
    }
    return names;
  }

  function hasPlayerVisible(name) {
    const normalized = normalize(name);
    if (existingNames.has(normalized)) return true;
    // A player profile is normally linked from the Players tab. Only use exact
    // standalone text matches as a secondary check, never substring matching.
    return [...document.querySelectorAll('a[href*="/player/"]')].some(a => normalize(textOf(a)) === normalized);
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function normalizedPositionOptions(value) {
    const map = {
      'goleiro': ['goalkeeper','goalie','keeper','gk','goleiro'],
      'defensor': ['defender','defence','defense','defensor','defesa','df','cb','lb','rb'],
      'meio campista': ['midfielder','midfield','meio campista','meio-campista','mf','cm','dm','am'],
      'atacante': ['forward','striker','attacker','atacante','fw','st','winger'],
      'nao informada': ['other','unknown','not specified','não informada','nao informada']
    };
    const key = normalize(value);
    return map[key] || [key];
  }

  function setFieldValue(field, role, player) {
    const el = field.el;
    if (role === 'photo' && (el.type || '').toLowerCase() === 'file') return uploadPhoto(el, player.photo, player.name);
    let value = role === 'name' ? player.name : role === 'number' ? player.number : role === 'position' ? player.position : player.photo;
    if (el.tagName === 'SELECT') {
      const candidates = role === 'position' ? normalizedPositionOptions(value) : [normalize(value)];
      const option = [...el.options].find(o => candidates.includes(normalize(o.textContent)) || candidates.includes(normalize(o.value)) || candidates.some(c => c && (normalize(o.textContent).includes(c) || normalize(o.value).includes(c))));
      if (!option) throw new Error(`Não encontrei a opção “${value}” no campo ${field.description}.`);
      el.value = option.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return Promise.resolve();
    }
    if (el.type === 'file') throw new Error('Campo de foto não reconhecido como arquivo.');
    setNativeValue(el, value);
    return Promise.resolve();
  }

  async function fetchPhotoData(imageUrl) {
    const parsed = new URL(imageUrl);
    if (parsed.hostname !== 'img.sofascore.com' || !parsed.pathname.includes('/api/v1/player/')) {
      throw new Error('A integração só baixa fotos do domínio de imagens do SofaScore.');
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      return await chrome.runtime.sendMessage({ type: 'ELENCO_SYNC_FETCH_IMAGE', url: imageUrl });
    }
    if (typeof GM_xmlhttpRequest === 'function') {
      return await new Promise((resolve, reject) => GM_xmlhttpRequest({
        method: 'GET', url: imageUrl, responseType: 'arraybuffer', timeout: 15000,
        onload: response => {
          if (response.status < 200 || response.status >= 300) return reject(new Error(`Foto respondeu HTTP ${response.status}.`));
          const bytes = new Uint8Array(response.response);
          if (bytes.byteLength > 2_000_000) return reject(new Error('A imagem excede 2 MB.'));
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          resolve({ ok: true, base64: btoa(binary), mime: response.responseHeaders.match(/content-type:\s*([^;\r\n]+)/i)?.[1] || 'image/jpeg' });
        },
        onerror: () => reject(new Error('Não foi possível baixar a foto do SofaScore.')),
        ontimeout: () => reject(new Error('Tempo esgotado ao baixar a foto.'))
      }));
    }
    throw new Error('Não há permissão para buscar a foto. Instale o complemento ou use o userscript compatível.');
  }

  async function uploadPhoto(input, imageUrl, playerName) {
    if (!imageUrl) throw new Error(`O jogador ${playerName} não possui URL de foto.`);
    const result = await fetchPhotoData(imageUrl);
    if (!result?.ok) throw new Error(result?.error || `Falha ao baixar foto de ${playerName}.`);
    const binary = atob(result.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], `${normalize(playerName).replace(/\s+/g, '-') || 'jogador'}.jpg`, { type: result.mime || 'image/jpeg' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findSubmit(root) {
    const candidates = [...root.querySelectorAll('button,[role="button"],input[type="submit"]')].filter(visible);
    const explicit = candidates.find(el => {
      const label = normalize(`${textOf(el)} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`);
      return /^(save|save player|add|add player|create|create player|salvar|salvar jogador|adicionar|adicionar jogador|criar|criar jogador|confirm|confirmar)$/.test(label) && !el.disabled;
    });
    if (explicit) return explicit;
    const submits = candidates.filter(el => el.matches('button[type="submit"],input[type="submit"]') && !el.disabled);
    return submits.length === 1 ? submits[0] : null;
  }

  async function waitForForm(timeout = 7000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const detected = detectFields();
      if (detected.fields.length) return detected;
      await sleep(250);
    }
    return detectFields();
  }

  async function openCreateForm() {
    const button = addPlayerControl();
    if (!button) return { ok: false, reason: 'Não encontrei um botão com o texto “Add player/Adicionar jogador”. Se a página mostrar apenas um ícone “+”, abra manualmente o formulário uma vez e clique em “Detectar formulário”.' };
    button.click();
    const detected = await waitForForm();
    if (!detected.fields.length) return { ok: false, reason: 'O botão foi acionado, mas não encontrei campos de cadastro visíveis.' };
    return { ok: true, ...detected };
  }

  function validateMapping() {
    const roles = fieldMap.map(f => f.role);
    const required = ['name', 'number', 'position', 'photo'];
    const missing = required.filter(role => !roles.includes(role));
    return missing;
  }

  async function fillAndSave(player) {
    const { root } = detectFields();
    const formFields = visibleFormFields().fields;
    if (!formFields.length) throw new Error('O formulário de jogador foi fechado ou não está visível.');
    const active = fieldMap.filter(f => f.role !== 'ignore');
    const roles = active.map(f => f.role);
    for (const required of ['name', 'number', 'position', 'photo']) {
      if (!roles.includes(required)) throw new Error(`Mapeie o campo ${required} antes de iniciar a importação.`);
    }
    for (const field of active) await setFieldValue(field, field.role, player);
    await sleep(300);
    const submit = findSubmit(root === document ? document : root);
    if (!submit) throw new Error('Preenchi os campos, mas não identifiquei com segurança o botão Salvar/Adicionar. Confira o formulário e salve manualmente.');
    if ($('autoSave').checked) {
      submit.click();
      await sleep(1200);
      const stillOpen = visibleFormFields().fields.length > 0;
      if (stillOpen) {
        const nameField = fieldMap.find(f => f.role === 'name')?.el;
        const cleared = nameField && !String(nameField.value || '').trim();
        if (!cleared) {
          const error = new Error(`O formulário permaneceu aberto após enviar ${player.name}. Para evitar sobrescrever o mesmo registro, confira a página e recarregue antes de tentar novamente.`);
          error.uncertain = true;
          throw error;
        }
      }
      const expected = normalize(player.name);
      let confirmed = false;
      for (let attempt = 0; attempt < 16; attempt++) {
        const bodyText = normalize(document.body.innerText);
        const dialogOpen = visibleFormFields().fields.length > 0;
        if (bodyText.includes(expected) && !dialogOpen) { confirmed = true; break; }
        if (bodyText.includes(expected) && stillOpen) { confirmed = true; break; }
        await sleep(350);
      }
      if (!confirmed) {
        const error = new Error(`O formulário foi enviado, mas não consegui confirmar “${player.name}” na página da equipe. Confira manualmente e recarregue antes de tentar novamente para evitar duplicidade.`);
        error.uncertain = true;
        throw error;
      }
    } else {
      throw new Error('Preenchimento concluído. A opção de salvamento automático está desativada; salve o jogador manualmente e clique em Retomar.');
    }
  }

  function preserveMapping(newFields) {
    return newFields.map((field, index) => {
      const previous = fieldMap.find(old => old.description === field.description) || fieldMap[index];
      return { ...field, role: previous?.role && previous.role !== 'ignore' ? previous.role : field.role };
    });
  }

  async function detectCurrentForm() {
    const detected = detectFields();
    if (!detected.fields.length) {
      setStatus('Nenhum formulário visível. Abra a aba Players/Jogadores e clique em Add player/Adicionar jogador; depois tente novamente.', 'error');
      $('detail').textContent = '';
      return;
    }
    fieldMap = preserveMapping(detected.fields);
    drawMapping();
    const missing = validateMapping();
    const info = fieldMap.map(f => `${f.description} → ${f.role}`).join('\n');
    $('detail').textContent = info;
    $('start').disabled = !payload || !payload.players.length;
    setStatus(missing.length ? `Formulário detectado. Mapeie também: ${missing.join(', ')}.` : 'Formulário detectado. Confira os campos e inicie a importação.', missing.length ? '' : 'ok');
  }

  async function runBatch() {
    if (!payload || running) return;
    const missing = validateMapping();
    if (missing.length) {
      setStatus(`Faltam campos obrigatórios: ${missing.join(', ')}. Ajuste o mapeamento antes de continuar.`, 'error');
      return;
    }
    running = true;
    stopRequested = false;
    $('stop').disabled = false;
    $('start').disabled = true;
    $('resume').disabled = true;
    existingNames = getExistingPlayerNames();
    let completed = currentIndex;
    try {
      for (; currentIndex < payload.players.length; currentIndex++) {
        if (stopRequested) break;
        const player = payload.players[currentIndex];
        const alreadyExists = hasPlayerVisible(player.name);
        if ($('skipDuplicates').checked && alreadyExists) {
          completed = currentIndex + 1;
          setProgress(completed, payload.players.length);
          setStatus(`Ignorado (já existe): ${player.name}. ${completed}/${payload.players.length}`);
          continue;
        }
        let detected = detectFields();
        if (!detected.fields.length) {
          const opened = await openCreateForm();
          if (!opened.ok) throw new Error(opened.reason);
          fieldMap = preserveMapping(opened.fields);
          drawMapping();
          const missingNow = validateMapping();
          if (missingNow.length) throw new Error(`Formulário encontrado, mas faltam campos para: ${missingNow.join(', ')}. Ajuste o mapeamento e clique em Retomar.`);
        } else {
          // The form is already open (or it stayed open for an "add another" flow).
          // Rebind fields to the current DOM without clicking the add button twice.
          fieldMap = preserveMapping(detected.fields);
          drawMapping();
        }
        await fillAndSave(player);
        existingNames.add(normalize(player.name));
        completed = currentIndex + 1;
        setProgress(completed, payload.players.length);
        setStatus(`Adicionado: ${player.name} (${completed}/${payload.players.length}).`, 'ok');
        await sleep(650);
      }
      if (stopRequested) setStatus(`Importação pausada em ${currentIndex}/${payload.players.length}. Clique em Retomar para continuar.`, '');
      else setStatus(`Processo finalizado: ${completed}/${payload.players.length} jogadores processados. Confira o elenco no Challenge Place.`, 'ok');
    } catch (error) {
      setStatus(error?.message || 'A importação foi interrompida.', 'error');
      $('resume').disabled = Boolean(error?.uncertain);
      $('detail').textContent = error?.uncertain
        ? 'Estado incerto após o clique em Salvar. Não será feita nova tentativa automática. Atualize a página, confira se o jogador entrou e gere um novo pacote para continuar.'
        : 'Nenhum envio adicional será feito até você corrigir o formulário/mapeamento e clicar em Retomar.';
    } finally {
      running = false;
      $('stop').disabled = true;
      $('start').disabled = !payload;
      $('resume').disabled = stopRequested ? false : currentIndex >= (payload?.players.length || 0);
    }
  }

  $('launcher').addEventListener('click', () => {
    openPanel();
  });
  $('close').addEventListener('click', closePanel);
  $('load').addEventListener('click', () => {
    try {
      payload = validatePackage($('payload').value);
      currentIndex = 0;
      setProgress(0, payload.players.length);
      $('start').disabled = false;
      $('resume').disabled = true;
      setStatus(`${payload.players.length} jogadores válidos para ${payload.teamName || 'a equipe selecionada'}. Confirme a aba Players/Jogadores.`, 'ok');
      $('detail').textContent = `Challenge: ${routeIds()?.challengeId || 'não identificado'} · Equipe: ${routeIds()?.competitorId || 'não identificada'}`;
    } catch (error) {
      payload = null;
      $('start').disabled = true;
      setStatus(error.message, 'error');
    }
  });
  $('packageFile').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) { setStatus('O arquivo é maior que 5 MB.', 'error'); return; }
    $('payload').value = await file.text();
    setStatus(`Arquivo ${file.name} carregado. Clique em Validar pacote.`, 'ok');
  });
  $('inspect').addEventListener('click', detectCurrentForm);
  $('start').addEventListener('click', async () => {
    if (!payload) {
      try { payload = validatePackage($('payload').value); } catch (e) { setStatus(e.message, 'error'); return; }
    }
    await openPlayersTab();
    const detected = detectFields();
    if (!detected.fields.length) {
      const opened = await openCreateForm();
      if (!opened.ok) { setStatus(opened.reason, 'error'); return; }
      fieldMap = preserveMapping(opened.fields);
    } else fieldMap = preserveMapping(detected.fields);
    drawMapping();
    const missing = validateMapping();
    if (missing.length) {
      setStatus(`Detectei o formulário, mas preciso mapear: ${missing.join(', ')}. Ajuste os seletores e clique em Iniciar novamente.`, 'error');
      $('start').disabled = false;
      return;
    }
    await runBatch();
  });
  $('resume').addEventListener('click', async () => {
    if (!payload) return;
    const detected = detectFields();
    if (detected.fields.length) {
      fieldMap = preserveMapping(detected.fields);
      drawMapping();
    }
    await runBatch();
  });
  $('stop').addEventListener('click', () => { stopRequested = true; $('stop').disabled = true; setStatus('Parada solicitada. O processo será interrompido após a ação atual.'); });

  // Expose only a small read-only diagnostic for support; no cookies or tokens are read.
  console.info('[Elenco Sync] Helper carregado para perfil de equipe.', routeIds());
})();
