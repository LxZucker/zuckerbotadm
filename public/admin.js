
async function api(action, method = "GET", data = {}) {
  const options = {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    }
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
    throw new Error(result.error || "Erro na comunicação com o servidor");
  }

  return result;
}

// =====================================
// IDENTIFICAR A PÁGINA
// =====================================

const loginForm = document.getElementById("login-form");
const dashboardScreen = document.getElementById("dashboard-screen");

// =====================================
// LOGIN
// =====================================

if (loginForm) {
  const loginButton = document.getElementById("login-button");
  const loginError = document.getElementById("login-error");

  loginForm.addEventListener("submit", async (event) => {
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

  api("auth")
    .then(result => {
      if (result.authenticated) {
        window.location.href = "/admin.html";
      }
    })
    .catch(() => {});
}

// =====================================
// PROTEÇÃO DO PAINEL
// =====================================

if (dashboardScreen) {
  async function protectDashboard() {
    try {
      const result = await api("auth");

      if (!result.authenticated) {
        window.location.href = "/";
        return;
      }

      await Promise.all([
        loadReleases(),
        loadCoreFiles()
      ]);

    } catch (error) {
      window.location.href = "/";
    }
  }

  protectDashboard();
}

// =====================================
// SAIR
// =====================================

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

// =====================================
// CALCULAR SHA-256
// =====================================

async function calculateSHA256(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

// =====================================
// LISTAR VERSÕES
// =====================================

const releasesContainer = document.getElementById("releases-list");
const releasesMessage = document.getElementById("releases-message");

async function loadReleases() {
  if (!releasesContainer) return;

  releasesContainer.innerHTML = "<p>Carregando versões...</p>";

  if (releasesMessage) {
    releasesMessage.textContent = "";
  }

  try {
    const result = await api("list_releases");

    releasesContainer.innerHTML = "";

    if (!result.releases || result.releases.length === 0) {
      releasesContainer.innerHTML =
        "<p>Nenhuma versão cadastrada ainda.</p>";
      return;
    }

    result.releases.forEach(release => {
      const card = document.createElement("div");
      card.className = "release-item";

      const title = document.createElement("h3");
      title.textContent = "Versão " + release.version;

      const status = document.createElement("p");
      status.textContent =
        "Status: " +
        (release.status === "published" ? "PUBLICADA" : "RASCUNHO");

      const date = document.createElement("p");
      date.textContent = release.created_at
        ? "Criada em: " + new Date(release.created_at).toLocaleString("pt-BR")
        : "";

      const notes = document.createElement("p");
      notes.textContent = release.release_notes || "Sem descrição.";

      card.appendChild(title);
      card.appendChild(status);
      card.appendChild(date);
      card.appendChild(notes);

      if (release.status !== "published") {
        const publishButton = document.createElement("button");

        publishButton.type = "button";
        publishButton.textContent = "PUBLICAR VERSÃO";

        publishButton.addEventListener("click", async () => {
          if (!confirm("Deseja realmente publicar a versão " + release.version + "?")) {
            return;
          }

          publishButton.disabled = true;
          publishButton.textContent = "PUBLICANDO...";

          try {
            const published = await api("publish_release", "POST", {
              id: String(release.id)
            });

            alert(published.message || "Versão publicada!");
            await loadReleases();

          } catch (error) {
            alert(error.message);
            publishButton.disabled = false;
            publishButton.textContent = "PUBLICAR VERSÃO";
          }
        });

        card.appendChild(publishButton);
      }

      releasesContainer.appendChild(card);
    });

  } catch (error) {
    releasesContainer.innerHTML = "";

    if (releasesMessage) {
      releasesMessage.textContent = error.message;
    } else {
      releasesContainer.textContent = error.message;
    }
  }
}

// =====================================
// ATUALIZAR LISTA DE VERSÕES
// =====================================

const refreshReleasesButton =
  document.getElementById("refresh-releases");

if (refreshReleasesButton) {
  refreshReleasesButton.addEventListener("click", loadReleases);
}

// =====================================
// PUBLICAR NOVA VERSÃO
// =====================================

const releaseForm = document.getElementById("release-form");

if (releaseForm) {
  releaseForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = document.getElementById("release-message");
    const button = document.getElementById("publish-button");

    const version = document.getElementById("release-version").value.trim();
    const notes = document.getElementById("release-notes").value.trim();
    const file = document.getElementById("release-file").files[0];

    message.textContent = "";
    message.style.color = "#ff5555";

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      message.textContent = "Use o formato X.Y.Z. Exemplo: 1.0.0";
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
      message.textContent = "Calculando integridade do pacote...";
      button.textContent = "CALCULANDO...";

      const sha256 = await calculateSHA256(file);

      message.textContent = "Preparando armazenamento seguro...";
      button.textContent = "PREPARANDO ENVIO...";

      const upload = await api("create_upload", "POST", {
        version,
        fileName: file.name,
        fileSize: file.size
      });

      message.textContent = "Enviando pacote ao Supabase...";
      button.textContent = "ENVIANDO ZIP...";

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
      button.textContent = "REGISTRANDO...";

      await api("save_release", "POST", {
        version,
        storagePath: upload.storagePath,
        sha256,
        packageSize: file.size,
        releaseNotes: notes
      });

      message.style.color = "#36e58a";
      message.textContent =
        "SUCESSO! Versão " + version + " salva como rascunho.";

      releaseForm.reset();
      await loadReleases();

    } catch (error) {
      console.error("[PUBLICAÇÃO]", error);
      message.style.color = "#ff5555";
      message.textContent = error.message ||
        "Não foi possível preparar a atualização.";

    } finally {
      button.disabled = false;
      button.textContent = "PREPARAR NOVA PUBLICAÇÃO ↗";
    }
  });
}

// =====================================
// GERENCIADOR DO NÚCLEO
// =====================================

const coreFilesContainer =
  document.getElementById("core-files-list");

const coreFilesMessage =
  document.getElementById("core-files-message");

const coreFileForm =
  document.getElementById("core-file-form");

// =====================================
// FORMATAR TAMANHO
// =====================================

function formatFileSize(bytes) {
  if (!bytes) return "Tamanho desconhecido";

  if (bytes < 1024) {
    return bytes + " B";
  }

  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + " KB";
  }

  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

// =====================================
// LISTAR ARQUIVOS DO NÚCLEO
// =====================================

async function loadCoreFiles() {
  if (!coreFilesContainer) return;

  coreFilesContainer.innerHTML = "";
  coreFilesMessage.textContent = "Carregando arquivos do núcleo...";

  try {
    const result = await api("list_core_files");

    coreFilesContainer.innerHTML = "";

    if (!result.files || result.files.length === 0) {
      coreFilesMessage.textContent =
        "Nenhum arquivo encontrado na pasta core/.";
      return;
    }

    coreFilesMessage.textContent =
      result.files.length + " arquivo(s) armazenado(s).";

    result.files.forEach(file => {
      const card = document.createElement("div");

      card.style.cssText = `
        background:#090d0b;
        border:1px solid rgba(25,230,140,.15);
        border-radius:11px;
        padding:14px;
        display:flex;
        flex-direction:column;
        gap:10px;
        overflow-wrap:anywhere;
      `;

      const name = document.createElement("strong");
      name.textContent = file.name;
      name.style.color = "#fff";
      name.style.fontSize = "13px";

      const path = document.createElement("small");
      path.textContent = file.path;
      path.style.color = "#19e68c";
      path.style.fontSize = "11px";

      const size = document.createElement("small");
      size.textContent = formatFileSize(file.size);
      size.style.color = "#888";
      size.style.fontSize = "11px";

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "EXCLUIR ARQUIVO";

      deleteButton.style.cssText = `
        background:#351316;
        border:1px solid rgba(255,48,59,.25);
        color:#ff626a;
        padding:10px;
        border-radius:8px;
        font-size:10px;
        font-weight:800;
        align-self:flex-start;
      `;

      deleteButton.addEventListener("click", async () => {
        if (!confirm(
          "Deseja excluir este arquivo do núcleo?\n\n" + file.path
        )) {
          return;
        }

        deleteButton.disabled = true;
        deleteButton.textContent = "EXCLUINDO...";

        try {
          await api("delete_core_file", "POST", {
            storagePath: file.path
          });

          await loadCoreFiles();

        } catch (error) {
          alert(error.message);
          deleteButton.disabled = false;
          deleteButton.textContent = "EXCLUIR ARQUIVO";
        }
      });

      card.appendChild(name);
      card.appendChild(path);
      card.appendChild(size);
      card.appendChild(deleteButton);

      coreFilesContainer.appendChild(card);
    });

  } catch (error) {
    coreFilesMessage.textContent =
      "Erro ao carregar arquivos: " + error.message;
  }
}

// =====================================
// ATUALIZAR ARQUIVOS
// =====================================

const refreshCoreFilesButton =
  document.getElementById("refresh-core-files");

if (refreshCoreFilesButton) {
  refreshCoreFilesButton.addEventListener("click", loadCoreFiles);
}

// =====================================
// ENVIAR OU SUBSTITUIR ARQUIVO
// =====================================

if (coreFileForm) {
  coreFileForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const pathInput =
      document.getElementById("core-file-path");

    const fileInput =
      document.getElementById("core-file-input");

    const message =
      document.getElementById("core-file-message");

    const button =
      coreFileForm.querySelector('button[type="submit"]');

    const filePath = pathInput.value.trim();
    const file = fileInput.files[0];

    message.style.color = "#ff5555";

    if (!filePath) {
      message.textContent = "Informe o caminho do arquivo.";
      return;
    }

    if (!file) {
      message.textContent = "Selecione um arquivo.";
      return;
    }

    if (file.size <= 0 || file.size > 2 * 1024 * 1024) {
      message.textContent = "O arquivo deve ter até 2 MB.";
      return;
    }

    const allowedExtensions = [
      ".js",
      ".cjs",
      ".mjs",
      ".json",
      ".html",
      ".css",
      ".md",
      ".txt"
    ];

    const extension = filePath
      .slice(filePath.lastIndexOf("."))
      .toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      message.textContent =
        "Extensão não permitida. Confira o caminho informado.";
      return;
    }

    button.disabled = true;

    try {
      message.style.color = "#19e68c";
      message.textContent = "Preparando envio seguro...";
      button.textContent = "PREPARANDO...";

      const upload = await api("create_core_upload", "POST", {
        filePath,
        fileSize: file.size
      });

      message.textContent = "Enviando arquivo ao Supabase...";
      button.textContent = "ENVIANDO...";

      const response = await fetch(upload.signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-upsert": "true"
        },
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

      message.style.color = "#ff5555";
      message.textContent = error.message;

    } finally {
      button.disabled = false;
      button.textContent = "ENVIAR ARQUIVO PARA O NÚCLEO ↑";
    }
  });
    }
    
