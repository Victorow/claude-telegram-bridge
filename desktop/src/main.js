const { invoke } = window.__TAURI__.core;

const onboardingEl = document.getElementById('onboarding');
const statusViewEl = document.getElementById('status-view');
const statusEl = document.getElementById('status');
const tokenInput = document.getElementById('token-input');
const onboardingErrorEl = document.getElementById('onboarding-error');
const enabledToggle = document.getElementById('enabled-toggle');
const granularitySelect = document.getElementById('granularity-select');

function renderStatus(status) {
  const ligado = status.enabled ? 'Ligado' : 'Desligado';
  const chat = status.connectedChatId ?? 'nenhum';
  const rodando = status.running ? 'Rodando' : 'Parado';
  statusEl.textContent = `${rodando} — ${ligado} — chat ${chat} — ${status.sessionCount} sessão(ões)`;
  enabledToggle.checked = status.enabled;
  granularitySelect.value = status.granularity;
}

function showOnboarding() {
  onboardingEl.hidden = false;
  statusViewEl.hidden = true;
}

function showStatusView() {
  onboardingEl.hidden = true;
  statusViewEl.hidden = false;
}

async function refresh() {
  try {
    const raw = await invoke('get_status');
    const status = JSON.parse(raw);
    if (!status.configured) {
      showOnboarding();
      return;
    }
    showStatusView();
    renderStatus(status);
  } catch (err) {
    statusEl.textContent = `Erro ao consultar status: ${err}`;
  }
}

document.getElementById('open-botfather').addEventListener('click', () => {
  invoke('plugin:opener|open_url', { url: 'https://t.me/BotFather', with: null });
});

document.getElementById('verify').addEventListener('click', async () => {
  onboardingErrorEl.textContent = '';
  try {
    const result = await invoke('complete_onboarding', { token: tokenInput.value });
    const parsed = JSON.parse(result);
    if (!parsed.ok) {
      if (parsed.reason === 'empty-token') {
        onboardingErrorEl.textContent = 'Cole o token antes de verificar.';
      } else if (parsed.reason === 'no-message-yet') {
        onboardingErrorEl.textContent = 'Não recebi nenhuma mensagem ainda. Manda uma mensagem pro bot no Telegram e tenta de novo.';
      } else {
        onboardingErrorEl.textContent = `Não consegui verificar: ${parsed.message ?? 'token inválido?'}`;
      }
      return;
    }
    await invoke('start_bridge');
    await refresh();
  } catch (err) {
    // Covers Tauri-side invoke failures and a non-JSON result alike, so a
    // stale/broken sidecar surfaces as a visible message instead of the
    // click silently doing nothing.
    onboardingErrorEl.textContent = `Não consegui verificar: ${err}`;
  }
});

document.getElementById('start').addEventListener('click', () => invoke('start_bridge'));
document.getElementById('stop').addEventListener('click', () => invoke('stop_bridge'));

enabledToggle.addEventListener('change', async () => {
  await invoke('update_settings', { enabled: enabledToggle.checked, granularity: null });
  await refresh();
});

granularitySelect.addEventListener('change', async () => {
  await invoke('update_settings', { enabled: null, granularity: granularitySelect.value });
  await refresh();
});

refresh();
setInterval(refresh, 3000);
