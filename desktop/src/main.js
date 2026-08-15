const { invoke } = window.__TAURI__.core;

const statusEl = document.getElementById('status');

function render(status) {
  if (!status.running) {
    statusEl.textContent = 'Parado.';
    return;
  }
  if (!status.configured) {
    statusEl.textContent = 'Rodando — bridge ainda não configurado.';
    return;
  }
  const ligado = status.enabled ? 'Ligado' : 'Desligado';
  const chat = status.connectedChatId ?? 'nenhum';
  statusEl.textContent = `Rodando — ${ligado} — chat ${chat} — ${status.sessionCount} sessão(ões)`;
}

async function refreshStatus() {
  try {
    const raw = await invoke('get_status');
    render(JSON.parse(raw));
  } catch (err) {
    statusEl.textContent = `Erro ao consultar status: ${err}`;
  }
}

document.getElementById('start').addEventListener('click', () => invoke('start_bridge'));
document.getElementById('stop').addEventListener('click', () => invoke('stop_bridge'));

refreshStatus();
setInterval(refreshStatus, 3000);
