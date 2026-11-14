async function api(action, method = "GET", data = {}) {
  const options = {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" }
  };

  if (method === "POST") options.body = JSON.stringify({ ...data, action });

  const url = method === "GET"
    ? `/api/admin?action=${encodeURIComponent(action)}`
    : "/api/admin";

  const response = await fetch(url, options);
  const result = await response.json();

  if (!response.ok) throw new Error(result.error || "Erro na comunicação com o servidor");
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
    if (result.authenticated) window.location.href = "/admin.html";
  }).catch(() => {});
}

if (dashboardScreen) {
  async function protectDashboard() {
    try {
      const result = await api("auth");
      if (!result.authenticated) {
        window.location.href = "/";
        return;
      }
      await Promise.all([loadReleases(), loadCoreFiles(), loadAccounts(), loadUpdateReports()]);
    } catch {
      window.location.href = "/";
    }
  }
  protectDashboard();
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
  return Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const releasesContainer = document.getElementById("releases-list");
const releasesMessage = document.getElementById("releases-message");

function formatDate(value) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data não informada" : date.toLocaleString("pt-BR");
}

function makeEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

async function loadReleases() {
  if (!releasesContainer) return;
  releasesContainer.innerHTML = "";
  if (releasesMessage) releasesMessage.textContent = "Carregando histórico de versões...";

  try {
    const result = await api("list_releases");
    const releases = Array.isArray(result.releases) ? result.releases : [];
    releasesContainer.innerHTML = "";

    if (!releases.length) {
      releasesContainer.appendChild(makeEmptyState("Nenhuma versão cadastrada ainda."));
      if (releasesMessage) releasesMessage.textContent = "Seu histórico aparecerá aqui quando você cadastrar uma versão.";
      return;
    }

    if (releasesMessage) releasesMessage.textContent = `${releases.length} versão(ões) no histórico.`;

    releases.forEach(release => {
      const published = release.status === "published";
      const card = document.createElement("article");
      card.className = `release-item ${published ? "is-published" : "is-draft"}`;

      const main = document.createElement("div");
      main.className = "release-main";

      const titleRow = document.createElement("div");
      titleRow.className = "release-title-row";

      const title = document.createElement("h3");
      title.className = "release-title";
      title.textContent = `Versão ${release.version}`;

      const status = document.createElement("span");
      status.className = `release-status ${published ? "published" : "draft"}`;
      status.textContent = published ? "✓ PUBLICADA" : "● RASCUNHO";

      titleRow.append(title, status);

      const date = document.createElement("p");
      date.className = "release-date";
      date.textContent = `Criada em ${formatDate(release.created_at)}`;

      const notes = document.createElement("p");
      notes.className = "release-notes";
      notes.textContent = release.release_notes || "Sem descrição cadastrada para esta versão.";

      main.append(titleRow, date, notes);
      card.appendChild(main);

      if (!published) {
        const actions = document.createElement("div");
        actions.className = "release-actions";

        const publishButton = document.createElement("button");
        publishButton.type = "button";
        publishButton.className = "publish-release-button";
        publishButton.textContent = "PUBLICAR VERSÃO ↗";

        publishButton.addEventListener("click", async () => {
          if (!confirm(`Deseja realmente publicar a versão ${release.version}? Essa ação disponibiliza a atualização aos bots que consultarem o painel.`)) return;

          publishButton.disabled = true;
          publishButton.textContent = "PUBLICANDO...";

          try {
            const publishedResult = await api("publish_release", "POST", { id: String(release.id) });
            alert(publishedResult.message || "Versão publicada!");
            await loadReleases();
          } catch (error) {
            alert(error.message);
            publishButton.disabled = false;
            publishButton.textContent = "PUBLICAR VERSÃO ↗";
          }
        });

        actions.appendChild(publishButton);
        card.appendChild(actions);
      }

      releasesContainer.appendChild(card);
    });
  } catch (error) {
    releasesContainer.innerHTML = "";
    releasesContainer.appendChild(makeEmptyState("Não foi possível carregar o histórico."));
    if (releasesMessage) releasesMessage.textContent = error.message;
  }
}

const refreshReleasesButton = document.getElementById("refresh-releases");
if (refreshReleasesButton) refreshReleasesButton.addEventListener("click", loadReleases);

const releaseForm = document.getElementById("release-form");
const releaseFileInput = document.getElementById("release-file");

if (releaseFileInput) {
  releaseFileInput.addEventListener("change", () => {
    const file = releaseFileInput.files[0];
    const label = document.getElementById("release-file-label");
    const hint = document.getElementById("release-file-hint");
    const area = document.getElementById("release-upload-area");
    if (!file) {
      label.textContent = "Selecionar pacote ZIP";
      hint.textContent = "Toque para escolher o arquivo · até 50 MB";
      area.classList.remove("is-selected");
      return;
    }
    label.textContent = file.name;
    hint.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB · arquivo selecionado`;
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
    const file = document.getElementById("release-file").files[0];

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
        version, fileName: file.name, fileSize: file.size
      });

      message.textContent = "Enviando pacote ao Supabase...";
      button.textContent = "ENVIANDO PACOTE...";

      const uploadResponse = await fetch(upload.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/zip", "x-upsert": "false" },
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
      message.textContent = `✓ Versão ${version} salva como rascunho. Ela ainda não foi publicada.`;
      releaseForm.reset();

      if (releaseFileInput) releaseFileInput.dispatchEvent(new Event("change"));
      await loadReleases();
    } catch (error) {
      console.error("[PUBLICAÇÃO]", error);
      message.style.color = "#ff747d";
      message.textContent = error.message || "Não foi possível preparar a atualização.";
    } finally {
      button.disabled = false;
      button.innerHTML = 'PREPARAR NOVA PUBLICAÇÃO <span>↗</span>';
    }
  });
}

const coreFilesContainer = document.getElementById("core-files-list");
const coreFilesMessage = document.getElementById("core-files-message");
const coreFileForm = document.getElementById("core-file-form");

function formatFileSize(bytes) {
  if (!bytes) return "Tamanho desconhecido";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function loadCoreFiles() {
  if (!coreFilesContainer) return;
  coreFilesContainer.innerHTML = "";
  if (coreFilesMessage) coreFilesMessage.textContent = "Carregando arquivos do núcleo...";

  try {
    const result = await api("list_core_files");
    const files = Array.isArray(result.files) ? result.files : [];
    coreFilesContainer.innerHTML = "";

    if (!files.length) {
      coreFilesMessage.textContent = "Nenhum arquivo encontrado na pasta core/.";
      return;
    }

    coreFilesMessage.textContent = `${files.length} arquivo(s) armazenado(s).`;

    files.forEach(file => {
      const card = document.createElement("article");
      card.className = "core-file-card";

      const name = document.createElement("strong");
      name.className = "core-file-name";
      name.textContent = file.name;

      const path = document.createElement("small");
      path.className = "core-file-path";
      path.textContent = file.path;

      const size = document.createElement("small");
      size.className = "core-file-size";
      size.textContent = formatFileSize(file.size);

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-file-button";
      deleteButton.textContent = "EXCLUIR ARQUIVO";

      deleteButton.addEventListener("click", async () => {
        if (!confirm(`Deseja excluir este arquivo do núcleo?\n\n${file.path}`)) return;
        deleteButton.disabled = true;
        deleteButton.textContent = "EXCLUINDO...";
        try {
          await api("delete_core_file", "POST", { storagePath: file.path });
          await loadCoreFiles();
        } catch (error) {
          alert(error.message);
          deleteButton.disabled = false;
          deleteButton.textContent = "EXCLUIR ARQUIVO";
        }
      });

      card.append(name, path, size, deleteButton);
      coreFilesContainer.appendChild(card);
    });
  } catch (error) {
    coreFilesMessage.textContent = "Erro ao carregar arquivos: " + error.message;
  }
}

const refreshCoreFilesButton = document.getElementById("refresh-core-files");
if (refreshCoreFilesButton) refreshCoreFilesButton.addEventListener("click", loadCoreFiles);

if (coreFileForm) {
  coreFileForm.addEventListener("submit", async event => {
    event.preventDefault();

    const pathInput = document.getElementById("core-file-path");
    const fileInput = document.getElementById("core-file-input");
    const message = document.getElementById("core-file-message");
    const button = coreFileForm.querySelector('button[type="submit"]');
    const filePath = pathInput.value.trim();
    const file = fileInput.files[0];

    message.style.color = "#ff747d";
    if (!filePath) { message.textContent = "Informe o caminho do arquivo."; return; }
    if (!file) { message.textContent = "Selecione um arquivo."; return; }
    if (file.size <= 0 || file.size > 2 * 1024 * 1024) {
      message.textContent = "O arquivo deve ter até 2 MB.";
      return;
    }

    const allowedExtensions = [".js", ".cjs", ".mjs", ".json", ".html", ".css", ".md", ".txt"];
    const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      message.textContent = "Extensão não permitida. Confira o caminho informado.";
      return;
    }

    button.disabled = true;
    try {
      message.style.color = "#19e68c";
      message.textContent = "Preparando envio seguro...";
      button.textContent = "PREPARANDO...";

      const upload = await api("create_core_upload", "POST", { filePath, fileSize: file.size });

      message.textContent = "Enviando arquivo ao Supabase...";
      button.textContent = "ENVIANDO...";

      const response = await fetch(upload.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "x-upsert": "true" },
        body: file
      });

      if (!response.ok) {
        const details = await response.text();
        console.error("[CORE UPLOAD]", details);
        throw new Error("Falha ao enviar arquivo ao Supabase.");
      }

      message.textContent = "Arquivo enviado com sucesso!";
      message.style.color = "#19e68c";
      coreFileForm.reset();
      await loadCoreFiles();
    } catch (error) {
      console.error("[CORE UPLOAD]", error);
      message.style.color = "#ff747d";
      message.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "ENVIAR ARQUIVO PARA O NÚCLEO ↑";
    }
  });
                     }
      
// ==========================================
// DISPOSITIVOS CONECTADOS
// ==========================================

const devicesList = document.getElementById("devices-list");
const devicesMessage = document.getElementById("devices-message");
const refreshDevicesButton = document.getElementById("refresh-devices");

function formatDeviceDate(value) {
  if (!value) return "Sem registro";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Data inválida";

  return date.toLocaleString("pt-BR");
}

function formatRemaining(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

async function loadDevices() {
  if (!devicesList) return;

  devicesMessage.textContent = "Consultando dispositivos...";

  try {
    const result = await api("list_devices");
    const devices = Array.isArray(result.devices) ? result.devices : [];

    devicesList.innerHTML = "";

    const processed = devices.map(device => {
      const lastSeen = device.last_seen
        ? new Date(device.last_seen).getTime()
        : 0;

      const signalRecent =
        lastSeen > 0 &&
        Date.now() - lastSeen >= 0 &&
        Date.now() - lastSeen <= 120000;

      let status = "OFFLINE";
      let statusClass = "offline";

      if (device.status === "unlink_pending") {
        status = "DESVINCULANDO";
        statusClass = "pending";
      } else if (device.status === "online" && signalRecent) {
        status = "ONLINE";
        statusClass = "online";
      }

      return { ...device, displayStatus: status, statusClass };
    });

    const online = processed.filter(
      device => device.displayStatus === "ONLINE"
    );

    const whatsapp = online.filter(
      device => device.whatsapp_connected === true
    );

    document.getElementById("devices-total").textContent = devices.length;
    document.getElementById("devices-online").textContent = online.length;
    document.getElementById("devices-whatsapp").textContent = whatsapp.length;

    if (!devices.length) {
      devicesMessage.textContent = "Nenhum dispositivo encontrado.";
      return;
    }

    processed.forEach(device => {
  const card = document.createElement("article");
  card.className = "device-card";

  const name = document.createElement("h3");
  name.textContent = device.device_name || "Dispositivo sem nome";

  const account = document.createElement("p");
  account.textContent =
    `Conta: ${device.account_name || "Não identificado"}`;

  const id = document.createElement("p");
  id.textContent = `ID: ${device.id}`;

  const status = document.createElement("span");
  status.className = `device-status ${device.statusClass}`;
  status.textContent = `STATUS: ${device.displayStatus}`;

  const lastSeenText = document.createElement("p");
  lastSeenText.textContent =
    `Último sinal: ${formatDeviceDate(device.last_seen)}`;

  const whatsappStatus = document.createElement("p");
whatsappStatus.textContent = device.whatsapp_connected
  ? "WhatsApp: conectado"
  : "WhatsApp: desconectado";

const whatsappNumber = document.createElement("p");
whatsappNumber.textContent = device.whatsapp_number
  ? `Número do último pareamento: ${device.whatsapp_number}`
  : "Número: não registrado";

  const validity = document.createElement("p");
  if (device.valid_until) {
    validity.textContent = device.validity_expired
      ? `VALIDADE EXPIRADA · ${device.validity_type === "trial" ? "TESTE" : "PLANO"}`
      : `VALIDADE ATÉ: ${formatDate(device.valid_until)} · Restam ${formatRemaining(device.validity_remaining_ms)}`;
    validity.style.color = device.validity_expired ? "#ff747d" : "#19e68c";
  } else {
    validity.textContent = "VALIDADE NÃO CONFIGURADA";
    validity.style.color = "#ffbf69";
  }

  const validityDaysInput = document.createElement("input");
  validityDaysInput.type = "number";
  validityDaysInput.min = "1";
  validityDaysInput.max = "3650";
  validityDaysInput.placeholder = "Adicionar validade (dias)";
  validityDaysInput.style.cssText = "width:100%;padding:12px;margin:10px 0;background:#111;color:white;border:1px solid #444;border-radius:8px;";

  const validityButton = document.createElement("button");
  validityButton.type = "button";
  validityButton.textContent = "ADICIONAR VALIDADE";
  validityButton.className = "logout";
  validityButton.style.cssText = "width:100%;margin-bottom:8px;border-color:#19e68c;color:#19e68c;";
  validityButton.addEventListener("click", async () => {
    const days = Number(validityDaysInput.value);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      alert("Informe entre 1 e 3650 dias.");
      return;
    }
    if (!confirm(`Adicionar ${days} dia(s) de validade para esta conta?`)) return;
    validityButton.disabled = true;
    try {
      await api("set_validity", "POST", { userId: device.user_id, days });
      alert("Validade atualizada com sucesso!");
      await loadDevices();
    } catch (error) {
      alert("Erro ao atualizar validade: " + error.message);
      validityButton.disabled = false;
    }
  });

  const suspension = document.createElement("p");

  if (device.suspended) {
    suspension.textContent =
      `CONTA SUSPENSA · Restam ${formatRemaining(device.suspension_remaining_ms)}`;
    suspension.style.color = "#ff747d";
  } else {
    suspension.textContent = "CONTA LIBERADA";
    suspension.style.color = "#19e68c";
  }

const reasonInput = document.createElement("textarea");
reasonInput.placeholder = "Motivo da suspensão";
reasonInput.maxLength = 500;
reasonInput.rows = 3;
reasonInput.style.cssText =
  "width:100%;padding:12px;margin:10px 0;background:#111;color:white;border:1px solid #444;border-radius:8px;resize:vertical;";
      
  const minutesInput = document.createElement("input");
  minutesInput.type = "number";
  minutesInput.min = "1";
  minutesInput.max = "43200";
  minutesInput.placeholder = "Minutos de suspensão";
  minutesInput.style.cssText =
    "width:100%;padding:12px;margin:10px 0;background:#111;color:white;border:1px solid #444;border-radius:8px;";

  const suspendButton = document.createElement("button");
  suspendButton.type = "button";
  suspendButton.textContent = "SUSPENDER CONTA";
  suspendButton.className = "logout";
  suspendButton.style.cssText =
    "width:100%;margin-bottom:8px;";

  suspendButton.addEventListener("click", async () => {
    const minutes = Number(minutesInput.value);
const reason = reasonInput.value.trim();

if (!reason) {
  alert("Informe o motivo da suspensão.");
  return;
}
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43200) {
      alert("Informe um tempo entre 1 e 43200 minutos.");
      return;
    }

    if (!confirm(`Suspender esta conta por ${minutes} minutos?`)) return;

    suspendButton.disabled = true;

    try {
      await api("suspend_user", "POST", {
  userId: device.user_id,
  minutes,
  reason
});

      alert("Conta suspensa com sucesso!");
      await loadDevices();
    } catch (error) {
      alert("Erro ao suspender: " + error.message);
      suspendButton.disabled = false;
    }
  });

  const releaseButton = document.createElement("button");
  releaseButton.type = "button";
  releaseButton.textContent = "LIBERAR CONTA";
  releaseButton.className = "logout";
  releaseButton.style.cssText =
    "width:100%;border-color:#19e68c;color:#19e68c;";

  releaseButton.addEventListener("click", async () => {
    if (!confirm("Deseja liberar esta conta agora?")) return;

    releaseButton.disabled = true;

    try {
      await api("unsuspend_user", "POST", {
        userId: device.user_id
      });

      alert("Conta liberada com sucesso!");
      await loadDevices();
    } catch (error) {
      alert("Erro ao liberar: " + error.message);
      releaseButton.disabled = false;
    }
  });

  card.append(
    name,
    account,
    id,
    status,
    lastSeenText,
    whatsappStatus,
    validity,
    validityDaysInput,
    validityButton,
    suspension
  );

  if (device.suspended) {
    card.append(releaseButton);
  } else {
    card.append(reasonInput, minutesInput, suspendButton);
  }

  devicesList.appendChild(card);
});

  } catch (error) {
    devicesMessage.textContent =
      "Erro ao carregar dispositivos: " + error.message;
  }
      }


// ==========================================
// CONTAS E RELATÓRIOS DOS AGENTES
// ==========================================
const accountsList = document.getElementById("accounts-list");
const accountsMessage = document.getElementById("accounts-message");
const refreshAccountsButton = document.getElementById("refresh-accounts");
const updateReportsList = document.getElementById("update-reports-list");
const updateReportsMessage = document.getElementById("update-reports-message");
const refreshUpdateReportsButton = document.getElementById("refresh-update-reports");

function remainingAccountTime(ms) {
  const totalMinutes = Math.max(0, Math.ceil(Number(ms || 0) / 60000));
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
    const accounts = Array.isArray(result.accounts) ? result.accounts : [];
    if (!accounts.length) {
      accountsMessage.textContent = "Nenhuma conta encontrada.";
      return;
    }
    accountsMessage.textContent = `${accounts.length} conta(s) cadastrada(s).`;
    for (const account of accounts) {
      const card = document.createElement("article");
      card.className = "account-item";
      const title = document.createElement("h3");
      title.textContent = account.account_name || "Conta sem nome";
      const identity = document.createElement("p");
      identity.textContent = `ID: ${account.user_id}`;
      const email = document.createElement("p");
      email.textContent = `Login: ${account.email || "Não informado"}`;
      const status = document.createElement("span");
      status.className = "account-state";
      if (account.suspended) {
        status.textContent = "SUSPENSA";
        status.classList.add("suspended");
      } else if (account.validity_expired) {
        status.textContent = "VALIDADE EXPIRADA";
        status.classList.add("expired");
      } else if (account.validity_type === "trial" && !account.renewal_count) {
        status.textContent = "PERÍODO DE TESTE";
      } else if (account.validity_type === "paid") {
        status.textContent = `RENOVADA · ${account.renewal_count || 1} RENOVAÇÃO(ÕES)`;
      } else {
        status.textContent = "VALIDADE NÃO CONFIGURADA";
        status.classList.add("expired");
      }
      const validity = document.createElement("p");
      validity.textContent = account.valid_until
        ? `Válida até: ${formatDate(account.valid_until)}${account.validity_expired ? " · expirada" : ` · restam ${remainingAccountTime(account.validity_remaining_ms)}`}`
        : "Sem data de vencimento cadastrada.";
      const created = document.createElement("p");
      created.textContent = `Cadastro: ${formatDate(account.created_at)}`;
      const renewalInput = document.createElement("input");
      renewalInput.type = "number";
      renewalInput.min = "1";
      renewalInput.max = "3650";
      renewalInput.value = "30";
      renewalInput.setAttribute("aria-label", "Dias de validade para adicionar");
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
        if (!confirm(`Adicionar ${days} dia(s) à conta ${account.account_name}?`)) return;
        renewButton.disabled = true;
        try {
          await api("set_validity", "POST", { userId: account.user_id, days });
          await Promise.all([loadAccounts(), loadDevices()]);
        } catch (error) {
          alert("Não foi possível renovar: " + error.message);
          renewButton.disabled = false;
        }
      });
      const tools = document.createElement("div");
      tools.className = "account-tools";
      tools.append(renewalInput, renewButton);
      card.append(title, identity, email, status, validity, created);
      if (account.suspended_until) {
        const suspended = document.createElement("p");
        suspended.textContent = `Suspensa até: ${formatDate(account.suspended_until)} · ${account.suspension_reason || "Motivo não informado"}`;
        card.appendChild(suspended);
      }
      card.appendChild(tools);
      accountsList.appendChild(card);
    }
  } catch (error) {
    accountsMessage.textContent = "Erro ao carregar contas: " + error.message;
  }
}

async function loadUpdateReports() {
  if (!updateReportsList) return;
  updateReportsList.innerHTML = "";
  updateReportsMessage.textContent = "Consultando relatórios...";
  try {
    const result = await api("list_update_reports");
    const reports = Array.isArray(result.reports) ? result.reports : [];
    if (!reports.length) {
      updateReportsMessage.textContent = "Nenhum agente enviou relatório de atualização ainda.";
      return;
    }
    updateReportsMessage.textContent = `${reports.length} relatório(s) recentes.`;
    reports.forEach(report => {
      const item = document.createElement("article");
      item.className = `update-report-item ${report.status === "failed" ? "failed" : ""}`;
      const title = document.createElement("h3");
      title.textContent = `Versão ${report.version} · ${report.status === "success" ? "CONCLUÍDA" : "FALHOU"}`;
      const details = document.createElement("p");
      details.textContent = `${report.message || "Sem detalhes"} · ${formatDate(report.created_at)}`;
      const identity = document.createElement("p");
      identity.textContent = `Usuário: ${report.user_id} · Dispositivo: ${report.device_id}`;
      item.append(title, details, identity);
      updateReportsList.appendChild(item);
    });
  } catch (error) {
    updateReportsMessage.textContent = "Erro ao consultar relatórios: " + error.message;
  }
}

if (refreshAccountsButton) refreshAccountsButton.addEventListener("click", loadAccounts);
if (refreshUpdateReportsButton) refreshUpdateReportsButton.addEventListener("click", loadUpdateReports);

if (refreshDevicesButton) {
  refreshDevicesButton.addEventListener("click", loadDevices);
}

if (devicesList) {
  loadDevices();
  }
