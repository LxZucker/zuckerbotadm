
async function api(action, method = "GET", data = {}) {
  const options = {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" }
  };

  if (method === "POST") {
    options.body = JSON.stringify({ ...data, action });
  }

  const url = method === "GET"
    ? `/api/admin?action=${encodeURIComponent(action)}`
    : "/api/admin";

  const response = await fetch(url, options);
  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error || result.details || "Erro na comunicação com o servidor."
    );
  }

  return result;
}

// PROTEÇÃO DE ACESSO
async function protectAccountsPage() {
  try {
    const result = await api("auth");

    if (!result.authenticated) {
      window.location.href = "/";
      return;
    }

    loadAccounts();
  } catch (error) {
    console.error("[CONTAS AUTH]", error);
    window.location.href = "/";
  }
}

// ELEMENTOS
const accountsList = document.getElementById("accounts-list");
const accountsMessage = document.getElementById("accounts-message");
const refreshAccountsButton = document.getElementById("refresh-accounts");
const searchAccounts = document.getElementById("search-accounts");

// DATAS
function formatDate(value) {
  if (!value) return "Data não informada";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Data não informada";
  }

  return date.toLocaleString("pt-BR");
}

function remainingAccountTime(ms) {
  const totalMinutes = Math.max(
    0,
    Math.ceil(Number(ms || 0) / 60000)
  );

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}min`;

  return `${minutes}min`;
}

// PESQUISA
function filterAccounts() {
  if (!accountsList || !searchAccounts) return;

  const search = searchAccounts.value.toLowerCase().trim();

  Array.from(accountsList.children).forEach(card => {
    card.style.display = card.textContent
      .toLowerCase()
      .includes(search) ? "" : "none";
  });
}

if (searchAccounts) {
  searchAccounts.addEventListener("input", filterAccounts);
}

// CARREGAR CONTAS
async function loadAccounts() {
  if (!accountsList || !accountsMessage) return;

  accountsList.innerHTML = "";
  accountsMessage.textContent = "Consultando contas registradas...";

  if (refreshAccountsButton) {
    refreshAccountsButton.disabled = true;
  }

  try {
    const result = await api("list_accounts");
    const accounts = Array.isArray(result.accounts)
      ? result.accounts
      : [];

    if (!accounts.length) {
      accountsMessage.textContent = "Nenhuma conta encontrada.";
      return;
    }

    accountsMessage.textContent =
      `${accounts.length} conta(s) cadastrada(s).`;

    for (const account of accounts) {
      const card = document.createElement("article");
      card.className = "account-item";

      // NOME
      const title = document.createElement("h3");
      title.textContent = account.account_name || "Conta sem nome";

      // IDENTIFICAÇÃO
      const identity = document.createElement("p");
      identity.textContent = `ID: ${account.user_id}`;

      const email = document.createElement("p");
      email.textContent = `Login: ${account.email || "Não informado"}`;

      // STATUS
      const status = document.createElement("span");
      status.className = "account-state";

      if (account.suspended) {
        status.textContent = "SUSPENSA";
        status.classList.add("suspended");
      } else if (account.validity_expired) {
        status.textContent = "VALIDADE EXPIRADA";
        status.classList.add("expired");
      } else if (
        account.validity_type === "trial" &&
        !account.renewal_count
      ) {
        status.textContent = "PERÍODO DE TESTE";
      } else if (account.validity_type === "paid") {
        status.textContent =
          `RENOVADA · ${account.renewal_count || 1} RENOVAÇÃO(ÕES)`;
      } else {
        status.textContent = "VALIDADE NÃO CONFIGURADA";
        status.classList.add("expired");
      }

      // VALIDADE
      const validity = document.createElement("p");

      validity.textContent = account.valid_until
        ? `Válida até: ${formatDate(account.valid_until)}${
            account.validity_expired
              ? " · expirada"
              : ` · restam ${remainingAccountTime(account.validity_remaining_ms)}`
          }`
        : "Sem data de vencimento cadastrada.";

      // DATA DE CADASTRO
      const created = document.createElement("p");
      created.textContent =
        `Cadastro: ${formatDate(account.created_at)}`;

      // RENOVAÇÃO
      const renewalInput = document.createElement("input");
      renewalInput.type = "number";
      renewalInput.min = "1";
      renewalInput.max = "3650";
      renewalInput.value = "30";
      renewalInput.placeholder = "Dias para adicionar";
      renewalInput.setAttribute(
        "aria-label",
        "Dias de validade para adicionar"
      );

      const renewButton = document.createElement("button");
      renewButton.type = "button";
      renewButton.className = "logout";
      renewButton.textContent = "ADICIONAR TEMPO";

      renewButton.addEventListener("click", async () => {
        const days = Number(renewalInput.value);

        if (!Number.isInteger(days) || days < 1 || days > 3650) {
          alert("Informe entre 1 e 3650 dias.");
          return;
        }

        if (!confirm(
          `Adicionar ${days} dia(s) à conta ${account.account_name}?`
        )) return;

        renewButton.disabled = true;
        renewButton.textContent = "ATUALIZANDO...";

        try {
          await api("set_validity", "POST", {
            userId: account.user_id,
            days
          });

          alert("Validade atualizada com sucesso!");
          await loadAccounts();
        } catch (error) {
          alert("Não foi possível renovar: " + error.message);
          renewButton.disabled = false;
          renewButton.textContent = "ADICIONAR TEMPO";
        }
      });

      const tools = document.createElement("div");
      tools.className = "account-tools";
      tools.append(renewalInput, renewButton);

      card.append(
        title,
        identity,
        email,
        status,
        validity,
        created
      );

      // INFORMAÇÕES DE SUSPENSÃO
      if (account.suspended_until) {
        const suspended = document.createElement("p");

        suspended.textContent =
          `Suspensa até: ${formatDate(account.suspended_until)} · ${
            account.suspension_reason || "Motivo não informado"
          }`;

        card.appendChild(suspended);
      }

      card.appendChild(tools);

      // EXCLUIR CONTA
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "EXCLUIR CONTA";
      deleteButton.className = "logout";

      deleteButton.style.cssText =
        "width:100%;margin-top:12px;border-color:#ff4545;color:#ff4545;";

      deleteButton.addEventListener("click", async () => {
        const confirmation = prompt(
          `ATENÇÃO! Essa ação é PERMANENTE.\n\n` +
          `A conta ${account.account_name} será excluída definitivamente.\n` +
          `Digite EXCLUIR para confirmar:`
        );

        if (confirmation !== "EXCLUIR") {
          alert("Exclusão cancelada.");
          return;
        }

        if (!confirm(
          `Última confirmação:\n\nDeseja realmente excluir a conta ${account.account_name}?\n\nEssa ação não poderá ser desfeita.`
        )) return;

        deleteButton.disabled = true;
        deleteButton.textContent = "EXCLUINDO...";

        try {
          await api("delete_account", "POST", {
            userId: account.user_id
          });

          alert("Conta excluída com sucesso!");
          await loadAccounts();
        } catch (error) {
          alert("Erro ao excluir conta: " + error.message);
          deleteButton.disabled = false;
          deleteButton.textContent = "EXCLUIR CONTA";
        }
      });

      card.appendChild(deleteButton);
      accountsList.appendChild(card);
    }

    filterAccounts();

  } catch (error) {
    console.error("[CONTAS]", error);
    accountsMessage.textContent =
      "Erro ao carregar contas: " + error.message;

  } finally {
    if (refreshAccountsButton) {
      refreshAccountsButton.disabled = false;
    }
  }
}

// ATUALIZAR LISTA
if (refreshAccountsButton) {
  refreshAccountsButton.addEventListener("click", loadAccounts);
}

// INICIAR
protectAccountsPage();
      
