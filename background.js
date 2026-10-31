chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'ELENCO_SYNC_FETCH_IMAGE') return;
  (async () => {
    try {
      const url = new URL(message.url);
      if (url.hostname !== 'img.sofascore.com' || !url.pathname.includes('/api/v1/player/')) {
        throw new Error('Origem de imagem não permitida.');
      }
      const response = await fetch(url.toString(), { credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error(`Imagem respondeu HTTP ${response.status}.`);
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('A URL não retornou uma imagem.');
      if (blob.size > 2_000_000) throw new Error('A imagem excede o limite de 2 MB.');
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      sendResponse({ ok: true, base64: btoa(binary), mime: blob.type, size: blob.size });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || 'Não foi possível baixar a foto.' });
    }
  })();
  return true;
});
