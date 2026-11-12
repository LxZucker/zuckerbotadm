
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
    options.body = JSON.stringify({
      ...data,
      action
    });
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

document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await api("logout", "POST");
    showLogin();
  } catch (error) {
    alert(error.message);
  }
});

// FORMULÁRIO DE PUBLICAÇÃO
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

    if (!version || !file) {
      message.textContent = "Informe a versão e selecione o pacote ZIP.";
      return;
    }

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      message.textContent = "Use o formato de versão X.Y.Z. Exemplo: 1.0.0";
      return;
    }

    if (!file.name.toLowerCase().endsWith(".zip")) {
      message.textContent = "Selecione um arquivo ZIP.";
      return;
    }

    message.textContent =
      "Formulário validado. O envio será ativado na próxima etapa.";

    button.disabled = true;
    button.textContent = "AGUARDANDO INTEGRAÇÃO...";

    setTimeout(() => {
      button.disabled = false;
      button.textContent = "PREPARAR PUBLICAÇÃO";
    }, 1500);
  });
}

checkSession();
