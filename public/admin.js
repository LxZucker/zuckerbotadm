
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
    const details = [
      result.error,
      result.details,
      result.code ? "Código: " + result.code : "",
      result.hint ? "Dica: " + result.hint : ""
    ].filter(Boolean).join("\n");

    throw new Error(details || "Erro na comunicação com o servidor");
  }

  return result;
}

const loginForm = document.getElementById("login-form");
const dashboardScreen = document.getElementById("dashboard-screen");

if (loginForm) {
  const loginButton = document.getElementById("login-button");
  const loginError = document.getElementById("login-error");

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();

    loginError.textContent = "";
    loginButton.disabled = true;
    loginButton.textContent = "VERIFICANDO...";

    try {
      await api("login", "POST", {
        username: document.getElementById("username").value,
        password: document.getElementById("password").value
      });

      loginForm.reset();
      window.location.href = "/admin.html";
    } catch (error) {
      loginError.textContent = error.message;
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = "ENTRAR NO PAINEL";
    }
  });

  api("auth").then(result => {
    if (result.authenticated) {
      window.location.href = "/admin.html";
    }
  }).catch(() => {});
}

if (dashboardScreen) {
  async function protectDashboard() {
    let result;

    try {
      result = await api("auth");
    } catch (error) {
      console.error("[ADMIN AUTH]", error);
      window.location.href = "/";
      return;
    }

    if (!result.authenticated) {
      window.location.href = "/";
      return;
    }

    try {
      await loadUpdateReports();
    } catch (error) {
      console.error("[ADMIN DASHBOARD]", error);
      alert("Erro ao carregar o painel: " + error.message);
    }
  }

  queueMicrotask(protectDashboard);
}

const logoutButton = document.getElementById("logout-button");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;

    try {
      await api("logout", "POST");
      window.location.href = "/";
    } catch (error) {
      alert(error.message);
      logoutButton.disabled = false;
    }
  });
}

async function calculateSHA256(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ==========================================
// ATUALIZAÇÕES / VERSÕES
// ==========================================

const draftReleasesContainer =
  document.getElementById("draft-releases-list");

const publishedReleasesContainer =
  document.getElementById("published-releases-list");

const releasesMessage =
  document.getElementById("releases-message");

function formatDate(value) {
  if (!value) return "Data não informada";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Data não informada"
    : date.toLocaleString("pt-BR");
}

function makeEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

// ==========================================
// CARREGAR VERSÕES
// ==========================================

async function loadReleases() {
  if (!draftReleasesContainer || !publishedReleasesContainer) return;

  draftReleasesContainer.innerHTML = "";
  publishedReleasesContainer.innerHTML = "";

  if (releasesMessage) {
    releasesMessage.textContent = "Carregando versões...";
  }

  try {
    const result = await api("list_releases");

    const releases = Array.isArray(result.releases)
      ? result.releases
      : [];

    const drafts = releases.filter(
      release => release.status !== "published"
    );

    const published = releases.filter(
      release => release.status === "published"
    );

    if (releasesMessage) {
      releasesMessage.textContent =
        `${drafts.length} rascunho(s) · ${published.length} versão(ões) publicada(s).`;
    }

    if (!drafts.length) {
      draftReleasesContainer.appendChild(
        makeEmptyState("Nenhuma versão aguardando publicação.")
      );
    }

    if (!published.length) {
      publishedReleasesContainer.appendChild(
        makeEmptyState("Nenhuma versão publicada ainda.")
      );
    }

    function createReleaseCard(release, isPublished) {
      const card = document.createElement("article");

      card.className =
        `release-item ${isPublished ? "is-published" : "is-draft"}`;

      const main = document.createElement("div");
      main.className = "release-main";

      const titleRow = document.createElement("div");
      titleRow.className = "release-title-row";

      const title = document.createElement("h3");
      title.className = "release-title";
      title.textContent = `Versão ${release.version}`;

      const status = document.createElement("span");

      status.className =
        `release-status ${isPublished ? "published" : "draft"}`;

      status.textContent =
        isPublished ? "✓ PUBLICADA" : "● RASCUNHO";

      titleRow.append(title, status);

      const date = document.createElement("p");
      date.className = "release-date";
      date.textContent = `Criada em ${formatDate(release.created_at)}`;

      const notes = document.createElement("p");
      notes.className = "release-notes";

      notes.textContent =
        release.release_notes ||
        "Sem descrição cadastrada para esta versão.";

      main.append(titleRow, date, notes);
      card.appendChild(main);

      if (!isPublished) {
        const actions = document.createElement("div");
        actions.className = "release-actions";

        const editButton = document.createElement("button");

        editButton.type = "button";
        editButton.className = "edit-release-button";
        editButton.textContent = "EDITAR RASCUNHO ✎";

        editButton.addEventListener("click", () => {
          alert(
            "A edição completa do rascunho ainda precisa da ação de atualização no servidor."
          );
        });

        const publishButton = document.createElement("button");

        publishButton.type = "button";
        publishButton.className = "publish-release-button";
        publishButton.textContent = "PUBLICAR VERSÃO ↗";

        publishButton.addEventListener("click", async () => {
          if (!confirm(
            `Deseja realmente publicar a versão ${release.version}? Essa ação disponibiliza a atualização aos bots que consultarem o painel.`
          )) {
            return;
          }

          publishButton.disabled = true;
          publishButton.textContent = "PUBLICANDO...";

          try {
            const publishedResult = await api(
              "publish_release",
              "POST",
              { id: String(release.id) }
            );

            alert(publishedResult.message || "Versão publicada!");

            await loadReleases();

          } catch (error) {
            alert(error.message);

            publishButton.disabled = false;
            publishButton.textContent = "PUBLICAR VERSÃO ↗";
          }
        });

        const deleteButton = document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className = "delete-release-button";
        deleteButton.textContent = "APAGAR RASCUNHO ✕";

        deleteButton.style.cssText = `
          width: 100%;
          padding: 12px;
          margin-top: 8px;
          color: #ff747d;
          background: #202020;
          border: 1px solid #ff4545;
          border-radius: 9px;
          font-size: 10px;
          font-weight: 900;
        `;

        deleteButton.addEventListener("click", async () => {
          const confirmed = confirm(
            `Deseja realmente apagar o rascunho da versão ${release.version}?\n\nEssa ação não poderá ser desfeita.`
          );

          if (!confirmed) return;

          deleteButton.disabled = true;
          deleteButton.textContent = "APAGANDO...";

          try {
            const deleteResult = await api(
              "delete_release",
              "POST",
              { id: String(release.id) }
            );

            alert(
              deleteResult.message ||
              `Rascunho ${release.version} apagado com sucesso!`
            );

            await loadReleases();

          } catch (error) {
            alert("Erro ao apagar rascunho: " + error.message);

            deleteButton.disabled = false;
            deleteButton.textContent = "APAGAR RASCUNHO ✕";
          }
        });

        actions.append(
          editButton,
          publishButton,
          deleteButton
        );

        card.appendChild(actions);
      }

      return card;
    }

    drafts.forEach(release => {
      draftReleasesContainer.appendChild(
        createReleaseCard(release, false)
      );
    });

    published.forEach(release => {
      publishedReleasesContainer.appendChild(
        createReleaseCard(release, true)
      );
    });

  } catch (error) {
    draftReleasesContainer.innerHTML = "";
    publishedReleasesContainer.innerHTML = "";

    draftReleasesContainer.appendChild(
      makeEmptyState("Não foi possível carregar os rascunhos.")
    );

    publishedReleasesContainer.appendChild(
      makeEmptyState("Não foi possível carregar as versões cadastradas.")
    );

    if (releasesMessage) {
      releasesMessage.textContent = error.message;
    }
  }
}

const refreshReleasesButton =
  document.getElementById("refresh-releases");

if (refreshReleasesButton) {
  refreshReleasesButton.addEventListener("click", loadReleases);
                                }
          
async function checkReleaseCompatibility() {
  const status = document.getElementById("release-compatibility-status");
  if (!status) return;

  status.style.color = "#aeb4bf";
  status.textContent =
    "Verificando se painel e agentes usam o mesmo projeto Supabase...";

  try {
    const result = await api("supabase_test");

    if (result.agentProjectMatch) {
      status.style.color = "#19e68c";
      status.textContent =
        `Conexão correta: painel e agentes usam o mesmo Supabase (${result.projectRef}).`;
    } else {
      status.style.color = "#ff747d";
      status.textContent =
        `ERRO DE INTEGRAÇÃO: o painel usa ${result.projectRef}, mas os agentes consultam ${result.agentProjectRef}. Ajuste SUPABASE_URL nas variáveis da Vercel do painel administrativo.`;
    }
  } catch (error) {
    status.style.color = "#ff747d";
    status.textContent =
      `Não foi possível validar o Supabase: ${error.message}`;
  }
}

// ==========================================
// INICIALIZAÇÃO DA PÁGINA DE ATUALIZAÇÕES
// ==========================================

if (
  draftReleasesContainer &&
  publishedReleasesContainer
) {
  loadReleases();
  checkReleaseCompatibility();
}

// ==========================================
// CADASTRAR NOVA ATUALIZAÇÃO
// ==========================================

const releaseForm = document.getElementById("release-form");
const releaseFileInput = document.getElementById("release-file");

if (releaseFileInput) {
  releaseFileInput.addEventListener("change", () => {
    const file = releaseFileInput.files[0];
    const label = document.getElementById("release-file-label");
    const hint = document.getElementById("release-file-hint");
    const area = document.getElementById("release-upload-area");

    if (!label || !hint || !area) return;

    if (!file) {
      label.textContent = "Selecionar pacote ZIP";
      hint.textContent = "Toque para escolher o arquivo · até 50 MB";
      area.classList.remove("is-selected");
      return;
    }

    label.textContent = file.name;
    hint.textContent =
      `${(file.size / (1024 * 1024)).toFixed(2)} MB · arquivo selecionado`;

    area.classList.add("is-selected");
  });
}

if (releaseForm) {
  releaseForm.addEventListener("submit", async event => {
    event.preventDefault();

    const message = document.getElementById("release-message");
    const button = document.getElementById("publish-button");
    const version = document.getElementById("release-version").value.trim();
    const notes = document.getElementById("release-notes").value.trim();
    const file = releaseFileInput?.files[0];

    message.textContent = "";
    message.style.color = "#ff747d";

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      message.textContent = "Use o formato X.Y.Z. Exemplo: 10.3.3";
      return;
    }

    if (!file || !file.name.toLowerCase().endsWith(".zip")) {
      message.textContent = "Selecione um arquivo ZIP.";
      return;
    }

    if (file.size <= 0 || file.size > 50 * 1024 * 1024) {
      message.textContent = "O ZIP precisa ter até 50 MB.";
      return;
    }

    button.disabled = true;

    try {
      message.style.color = "#aeb4bf";
      message.textContent = "Calculando integridade SHA-256...";
      button.textContent = "CALCULANDO INTEGRIDADE...";

      const sha256 = await calculateSHA256(file);

      message.textContent = "Preparando armazenamento seguro...";
      button.textContent = "PREPARANDO ENVIO...";

      const upload = await api("create_upload", "POST", {
        version,
        fileName: file.name,
        fileSize: file.size
      });

      message.textContent = "Enviando pacote ao Supabase...";
      button.textContent = "ENVIANDO PACOTE...";

      const uploadResponse = await fetch(upload.signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/zip",
          "x-upsert": "false"
        },
        body: file
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error("[UPLOAD]", errorText);
        throw new Error("Falha no envio do ZIP ao Supabase.");
      }

      message.textContent = "Registrando versão no banco de dados...";
      button.textContent = "SALVANDO RASCUNHO...";

      await api("save_release", "POST", {
        version,
        storagePath: upload.storagePath,
        sha256,
        packageSize: file.size,
        releaseNotes: notes
      });

      message.style.color = "#19e68c";
      message.textContent =
        `✓ Versão ${version} salva como rascunho. Ela ainda não foi publicada.`;

      releaseForm.reset();

      if (releaseFileInput) {
        releaseFileInput.dispatchEvent(new Event("change"));
      }

      await loadReleases();

    } catch (error) {
      console.error("[PUBLICAÇÃO]", error);
      message.style.color = "#ff747d";
      message.textContent =
        error.message || "Não foi possível preparar a atualização.";
    } finally {
      button.disabled = false;
      button.innerHTML =
        'PREPARAR NOVA PUBLICAÇÃO <span>↗</span>';
    }
  });
}

// ==========================================
// CONTAS E RELATÓRIOS DOS AGENTES
// ==========================================

const accountsList = document.getElementById("accounts-list");
const accountsMessage = document.getElementById("accounts-message");
const refreshAccountsButton = document.getElementById("refresh-accounts");

const updateReportsList =
  document.getElementById("update-reports-list");

const updateReportsMessage =
  document.getElementById("update-reports-message");

const refreshUpdateReportsButton =
  document.getElementById("refresh-update-reports");

const searchUpdates = document.getElementById("search-updates");

if (searchUpdates && updateReportsList) {
  searchUpdates.addEventListener("input", () => {
    const search = searchUpdates.value.toLowerCase().trim();

    Array.from(updateReportsList.children).forEach(item => {
      item.style.display = item.textContent
        .toLowerCase()
        .includes(search)
        ? ""
        : "none";
    });
  });
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

async function loadAccounts() {
  if (!accountsList) return;

  accountsMessage.textContent = "Consultando contas registradas...";
  accountsList.innerHTML = "";

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

      const title = document.createElement("h3");
      title.textContent = account.account_name || "Conta sem nome";

      const identity = document.createElement("p");
      identity.textContent = `ID: ${account.user_id}`;

      const email = document.createElement("p");
      email.textContent =
        `Login: ${account.email || "Não informado"}`;

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

      const validity = document.createElement("p");

      validity.textContent = account.valid_until
        ? `Válida até: ${formatDate(account.valid_until)}${
            account.validity_expired
              ? " · expirada"
              : ` · restam ${remainingAccountTime(account.validity_remaining_ms)}`
          }`
        : "Sem data de vencimento cadastrada.";

      const created = document.createElement("p");
      created.textContent =
        `Cadastro: ${formatDate(account.created_at)}`;

      const renewalInput = document.createElement("input");
      renewalInput.type = "number";
      renewalInput.min = "1";
      renewalInput.max = "3650";
      renewalInput.value = "30";
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
        )) {
          return;
        }

        renewButton.disabled = true;

        try {
          await api("set_validity", "POST", {
            userId: account.user_id,
            days
          });

          await Promise.all([
            loadAccounts(),
            loadDevices()
          ]);
        } catch (error) {
          alert("Não foi possível renovar: " + error.message);
          renewButton.disabled = false;
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

      if (account.suspended_until) {
        const suspended = document.createElement("p");

        suspended.textContent =
          `Suspensa até: ${formatDate(account.suspended_until)} · ${
            account.suspension_reason || "Motivo não informado"
          }`;

        card.appendChild(suspended);
      }

      card.appendChild(tools);

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
        )) {
          return;
        }

        deleteButton.disabled = true;
        deleteButton.textContent = "EXCLUINDO...";

        try {
          await api("delete_account", "POST", {
            userId: account.user_id
          });

          alert("Conta excluída com sucesso!");

          await Promise.all([
            loadAccounts(),
            loadDevices()
          ]);
        } catch (error) {
          alert("Erro ao excluir conta: " + error.message);
          deleteButton.disabled = false;
          deleteButton.textContent = "EXCLUIR CONTA";
        }
      });

      card.appendChild(deleteButton);
      accountsList.appendChild(card);
    }

  } catch (error) {
    accountsMessage.textContent =
      "Erro ao carregar contas: " + error.message;
  }
}

async function loadUpdateReports() {
  if (!updateReportsList) return;

  updateReportsList.innerHTML = "";
  updateReportsMessage.textContent = "Consultando relatórios...";

  try {
    const result = await api("list_update_reports");

    const reports = Array.isArray(result.reports)
      ? result.reports
      : [];

    if (!reports.length) {
      updateReportsMessage.textContent =
        "Nenhum agente enviou relatório de atualização ainda.";
      return;
    }

    updateReportsMessage.textContent =
      `${reports.length} relatório(s) recentes.`;

    reports.forEach(report => {
      const item = document.createElement("article");

      item.className =
        `update-report-item ${report.status === "failed" ? "failed" : ""}`;

      const title = document.createElement("h3");

      title.textContent =
        `Versão ${report.version} · ${
          report.status === "success" ? "CONCLUÍDA" : "FALHOU"
        }`;

      const details = document.createElement("p");

      details.textContent =
        `${report.message || "Sem detalhes"} · ${formatDate(report.created_at)}`;

      const identity = document.createElement("p");

      identity.textContent =
        `Usuário: ${report.user_id} · Dispositivo: ${report.device_id}`;

      item.append(title, details, identity);
      updateReportsList.appendChild(item);
    });

  } catch (error) {
    updateReportsMessage.textContent =
      "Erro ao consultar relatórios: " + error.message;
  }
}

if (refreshAccountsButton) {
  refreshAccountsButton.addEventListener("click", loadAccounts);
}

if (refreshUpdateReportsButton) {
  refreshUpdateReportsButton.addEventListener(
    "click",
    loadUpdateReports
  );
}
