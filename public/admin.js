
const loginScreen = document.getElementById("login-screen");
const dashboardScreen = document.getElementById("dashboard-screen");
const loginForm = document.getElementById("login-form");
const loginButton = document.getElementById("login-button");
const loginError = document.getElementById("login-error");

function showDashboard() {
  loginScreen.classList.add("hidden");
  dashboardScreen.classList.remove("hidden");
}

function showLogin() {
  dashboardScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

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

// LOGIN
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
    showDashboard();

  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "ENTRAR NO PAINEL";
  }
});

// SAIR
document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await api("logout", "POST");
    showLogin();
  } catch (error) {
    alert(error.message);
  }
});

// CALCULAR SHA-256
async function calculateSHA256(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

// PUBLICAR RASCUNHO
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
      // 1. CALCULAR HASH
      message.textContent = "Calculando integridade do pacote...";
      button.textContent = "CALCULANDO...";

      const sha256 = await calculateSHA256(file);

      // 2. SOLICITAR AUTORIZAÇÃO
      message.textContent = "Preparando armazenamento seguro...";
      button.textContent = "PREPARANDO ENVIO...";

      const upload = await api("create_upload", "POST", {
        version,
        fileName: file.name,
        fileSize: file.size
      });

      // 3. ENVIAR ZIP DIRETAMENTE AO SUPABASE
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

      // 4. REGISTRAR VERSÃO NO BANCO
      message.textContent = "Registrando versão no banco de dados...";
      button.textContent = "REGISTRANDO...";

      await api("save_release", "POST", {
        version,
        storagePath: upload.storagePath,
        sha256,
        packageSize: file.size,
        releaseNotes: notes
      });

      message.textContent =
        "SUCESSO! Versão " + version + " salva como rascunho.";

      message.style.color = "#36e58a";

      releaseForm.reset();

    } catch (error) {
      console.error("[PUBLICAÇÃO]", error);

      message.style.color = "#ff5555";
      message.textContent = error.message ||
        "Não foi possível preparar a atualização.";

    } finally {
      button.disabled = false;
      button.textContent = "PREPARAR PUBLICAÇÃO";
    }
  });
}

// VERIFICAR SESSÃO
async function checkSession() {
  try {
    const result = await api("auth");

    if (result.authenticated) {
      showDashboard();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

checkSession();
    
