
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

    await loadAccounts();
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

// TEMPO RESTANTE
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

function remainingSuspensionTime(until) {
  if (!until) return "Tempo não informado";

  const remaining = new Date(until).getTime() - Date.now();

  if (remaining <= 0) return "Suspensão encerrada";

  return remainingAccountTime(remaining);
}

// ESTILO DOS BOTÕES
function styleButton(button, color) {
  if (color === "green") {
    button.style.cssText =
      "width:100%;min-height:42px;background:#102d20;border:1px solid #19e68c;color:#19e68c;border-radius:9px;padding:11px;";
  } else if (color === "red") {
    button.style.cssText =
      "width:100%;min-height:42px;background:#301014;border:1px solid #ff4545;color:#ff747d;border-radius:9px;padding:11px;";
  } else if (color === "orange") {
    button.style.cssText =
      "width:100%;min-height:42px;background:#30220e;border:1px solid #ffbf69;color:#ffbf69;border-radius:9px;padding:11px;";
  }
}

// CRIAR BOTÃO
function createButton(label, color) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  styleButton(button, color);
  return button;
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
    const devicesResult = await api("list_devices");
const devices = Array.isArray(devicesResult.devices)
  ? devicesResult.devices
  : [];

    const accounts = Array.isArray(result.accounts)
      ? result.accounts
      : [];
// INFORMAÇÕES DO BOT
const device = devicesByUser.get(account.user_id);

const whatsappNumber = document.createElement("p");
whatsappNumber.textContent = device?.whatsapp_number
  ? `Número do bot: ${device.whatsapp_number}`
  : "Número do bot: não registrado";

const lastOnline = document.createElement("p");
lastOnline.textContent = device?.last_seen
  ? `Última vez online: ${formatDate(device.last_seen)}`
  : "Última vez online: sem registro";
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
      title.textContent =
        account.account_name || "Conta sem nome";

      // ID
      const identity = document.createElement("p");
      identity.textContent = `ID: ${account.user_id}`;

      // LOGIN
      const email = document.createElement("p");
      email.textContent =
        `Login: ${account.email || "Não informado"}`;

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

      // CADASTRO
      const created = document.createElement("p");
      created.textContent =
        `Cadastro: ${formatDate(account.created_at)}`;
// INFORMAÇÕES DO BOT
const device = devicesByUser.get(account.user_id);

const whatsappNumber = document.createElement("p");
whatsappNumber.textContent = device?.whatsapp_number
  ? `Número do bot: ${device.whatsapp_number}`
  : "Número do bot: não registrado";

const lastOnline = document.createElement("p");
lastOnline.textContent = device?.last_seen
  ? `Última vez online: ${formatDate(device.last_seen)}`
  : "Última vez online: sem registro";
      
      card.append(
  title,
  identity,
  email,
  status,
  validity,
  created,
  whatsappNumber,
  lastOnline
);
      // RENOVAÇÃO DE VALIDADE
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

      const renewButton = createButton(
        "ADICIONAR TEMPO",
        "green"
      );

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

      const renewalTools = document.createElement("div");
      renewalTools.className = "account-tools";
      renewalTools.append(renewalInput, renewButton);

      card.appendChild(renewalTools);

      // ==================================
      // SUSPENSÃO E LIBERAÇÃO DA CONTA
      // ==================================

      if (account.suspended) {
        // INFORMAÇÕES DA SUSPENSÃO
        const suspensionInfo = document.createElement("p");

        suspensionInfo.style.cssText =
          "color:#ff747d;margin-top:14px;";

        suspensionInfo.textContent =
          `SUSPENSA ATÉ: ${formatDate(account.suspended_until)} · ` +
          `Restam ${remainingSuspensionTime(account.suspended_until)} · ` +
          `Motivo: ${account.suspension_reason || "Não informado"}`;

        card.appendChild(suspensionInfo);

        // LIBERAR CONTA
        const releaseButton = createButton(
          "LIBERAR CONTA",
          "green"
        );

        releaseButton.style.marginTop = "10px";

        releaseButton.addEventListener("click", async () => {
          if (!confirm(
            `Deseja liberar a conta ${account.account_name} agora?`
          )) return;

          releaseButton.disabled = true;
          releaseButton.textContent = "LIBERANDO...";

          try {
            await api("unsuspend_user", "POST", {
              userId: account.user_id
            });

            alert("Conta liberada com sucesso!");
            await loadAccounts();
          } catch (error) {
            alert("Erro ao liberar conta: " + error.message);
            releaseButton.disabled = false;
            releaseButton.textContent = "LIBERAR CONTA";
          }
        });

        card.appendChild(releaseButton);

      } else {
        // MOTIVO DA SUSPENSÃO
        const reasonInput = document.createElement("textarea");
        reasonInput.placeholder = "Motivo da suspensão";
        reasonInput.maxLength = 500;
        reasonInput.rows = 3;

        reasonInput.style.cssText =
          "width:100%;min-width:0;box-sizing:border-box;padding:12px;margin-top:14px;background:#151515;color:white;border:1px solid #393939;border-radius:8px;resize:vertical;font-size:13px;";

        // TEMPO DE SUSPENSÃO
        const minutesInput = document.createElement("input");
        minutesInput.type = "number";
        minutesInput.min = "1";
        minutesInput.max = "43200";
        minutesInput.placeholder = "Tempo de suspensão em minutos";
        minutesInput.style.cssText =
          "width:100%;min-width:0;box-sizing:border-box;padding:12px;margin-top:9px;background:#151515;color:white;border:1px solid #393939;border-radius:8px;font-size:13px;";

        // BOTÃO SUSPENDER
        const suspendButton = createButton(
          "SUSPENDER CONTA",
          "orange"
        );

        suspendButton.style.marginTop = "9px";

        suspendButton.addEventListener("click", async () => {
          const minutes = Number(minutesInput.value);
          const reason = reasonInput.value.trim();

          if (!reason) {
            alert("Informe o motivo da suspensão.");
            return;
          }

          if (reason.length > 500) {
            alert("O motivo pode ter no máximo 500 caracteres.");
            return;
          }

          if (
            !Number.isInteger(minutes) ||
            minutes < 1 ||
            minutes > 43200
          ) {
            alert("Informe um tempo entre 1 e 43200 minutos.");
            return;
          }

          if (!confirm(
            `Suspender a conta ${account.account_name} por ${minutes} minutos?\n\nMotivo: ${reason}`
          )) return;

          suspendButton.disabled = true;
          suspendButton.textContent = "SUSPENDENDO...";

          try {
            await api("suspend_user", "POST", {
              userId: account.user_id,
              minutes,
              reason
            });

            alert("Conta suspensa com sucesso!");
            await loadAccounts();
          } catch (error) {
            alert("Erro ao suspender conta: " + error.message);
            suspendButton.disabled = false;
            suspendButton.textContent = "SUSPENDER CONTA";
          }
        });

        card.append(
          reasonInput,
          minutesInput,
          suspendButton
        );
      }

      // ==================================
      // EXCLUIR CONTA
      // ==================================

      const deleteButton = createButton(
        "EXCLUIR CONTA",
        "red"
      );

      deleteButton.style.marginTop = "14px";

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
  
