
async function api(action) {
  const response = await fetch(
    `/api/admin?action=${encodeURIComponent(action)}`,
    {
      method: "GET",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" }
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error || "Erro na comunicação com o servidor."
    );
  }

  return result;
}

// ELEMENTOS
const historyList = document.getElementById("history-list");
const historyMessage = document.getElementById("history-message");
const refreshButton = document.getElementById("refresh-history");
const searchInput = document.getElementById("search-history");

let historyRecords = [];

// FORMATAR DATA
function formatDate(value) {
  if (!value) return "Não informado";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Data inválida";
  }

  return date.toLocaleString("pt-BR");
}

// TRADUZIR EVENTOS
function eventLabel(type) {
  const labels = {
    trial_started: "TESTE INICIADO",
    trial_ended: "TESTE ENCERRADO",
    validity_added: "VALIDADE ADICIONADA"
  };

  return labels[type] || String(type || "EVENTO").toUpperCase();
}

// CRIAR TEXTO
function createInfo(label, value) {
  const p = document.createElement("p");
  p.textContent = `${label}: ${value ?? "Não informado"}`;
  return p;
}

// EXIBIR REGISTROS
function renderHistory() {
  if (!historyList) return;

  const search = String(searchInput?.value || "")
    .trim()
    .toLowerCase();

  const filtered = historyRecords.filter(record => {
    const name = String(record.account_name || "").toLowerCase();
    const userId = String(record.user_id || "").toLowerCase();

    return name.includes(search) || userId.includes(search);
  });

  historyList.innerHTML = "";

  if (!filtered.length) {
    historyMessage.textContent = historyRecords.length
      ? "Nenhum registro encontrado para essa pesquisa."
      : "Nenhum registro de validade foi encontrado.";
    return;
  }

  historyMessage.textContent =
    `${filtered.length} registro(s) encontrado(s).`;

  filtered.forEach(record => {
    const card = document.createElement("article");
    card.className = "history-item";

    const title = document.createElement("h3");
    title.textContent = record.account_name || "Conta não identificada";

    const badge = document.createElement("span");
    badge.className = "event-type";
    badge.textContent = eventLabel(record.event_type);

    card.appendChild(title);
    card.appendChild(badge);

    card.appendChild(createInfo(
      "Data do registro",
      formatDate(record.created_at)
    ));

    if (record.days_added !== null && record.days_added !== undefined) {
      card.appendChild(createInfo(
        "Dias adicionados",
        `${record.days_added} dia(s)`
      ));
    }

    if (record.previous_valid_until) {
      card.appendChild(createInfo(
        "Validade anterior",
        formatDate(record.previous_valid_until)
      ));
    }

    if (record.new_valid_until) {
      card.appendChild(createInfo(
        "Nova validade",
        formatDate(record.new_valid_until)
      ));
    }

    if (record.event_type === "trial_started") {
      card.appendChild(createInfo(
        "Início do teste",
        formatDate(record.created_at)
      ));

      card.appendChild(createInfo(
        "Fim previsto do teste",
        formatDate(
          new Date(
            new Date(record.created_at).getTime() + 24 * 60 * 60 * 1000
          ).toISOString()
        )
      ));
    }

    if (record.event_type === "trial_ended") {
      card.appendChild(createInfo(
        "Encerramento do teste",
        formatDate(record.created_at)
      ));
    }

    historyList.appendChild(card);
  });
}

// CARREGAR HISTÓRICO
async function loadHistory() {
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "CARREGANDO...";
  }

  historyMessage.textContent = "Carregando histórico...";

  try {
    const result = await api("list_validity_history");

    historyRecords = Array.isArray(result.history)
      ? result.history
      : [];

    renderHistory();

  } catch (error) {
    console.error("[HISTÓRICO DE VALIDADE]", error);
    historyMessage.textContent = error.message;
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "↻ ATUALIZAR";
    }
  }
}

// PROTEGER PÁGINA
async function protectPage() {
  try {
    const result = await api("auth");

    if (!result.authenticated) {
      window.location.href = "/";
      return;
    }

    await loadHistory();

  } catch (error) {
    console.error("[CVAL AUTH]", error);
    window.location.href = "/";
  }
}

// EVENTOS
if (refreshButton) {
  refreshButton.addEventListener("click", loadHistory);
}

if (searchInput) {
  searchInput.addEventListener("input", renderHistory);
}

// INICIAR
protectPage();
