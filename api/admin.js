
const crypto = require("crypto");
const { getAccountAccessById, getAccountAccessForUser, updateAccountControl } = require("../account-access");

const BUCKET = "zuckerbots-releases";
const CORE_PREFIX = "core/";
const MAX_CORE_FILE_SIZE = 2 * 1024 * 1024;
// O agente do site cliente consulta este projeto Supabase diretamente.
const AGENT_SUPABASE_PROJECT_REF = "khkjlodngoahevxkxswj";

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));

  return x.length === y.length &&
    crypto.timingSafeEqual(x, y);
}

function sign(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || "").split(";");

  for (const item of cookies) {
    const separator = item.indexOf("=");

    if (separator < 0) continue;

    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();

    if (key === name) return value;
  }

  return null;
}

function verifySession(req, secret) {
  const session = getCookie(req, "zucker_admin");

  if (!session) return null;

  const parts = session.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expected = sign(payload, secret);

  if (!safeEqual(signature, expected)) return null;

  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    if (
      !data.user ||
      !data.exp ||
      data.exp < Date.now() ||
      data.user !== process.env.ADMIN_USERNAME
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

function supabaseBaseUrl() {
  const value = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!value) throw new Error("SUPABASE_URL não configurada.");

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SUPABASE_URL inválida.");
  }

  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
    throw new Error("SUPABASE_URL deve apontar para um projeto Supabase HTTPS.");
  }

  return `${parsed.protocol}//${parsed.host}`;
}

function supabaseProjectRef() {
  return new URL(supabaseBaseUrl()).hostname.split(".")[0];
}

function assertAgentSupabaseProject() {
  const actual = supabaseProjectRef();
  if (actual !== AGENT_SUPABASE_PROJECT_REF) {
    const error = new Error(
      `O painel administrativo está conectado ao projeto Supabase ${actual}, mas os agentes consultam ${AGENT_SUPABASE_PROJECT_REF}. Configure SUPABASE_URL no Vercel Admin para o mesmo projeto usado pelo site cliente.`
    );
    error.code = "SUPABASE_PROJECT_MISMATCH";
    throw error;
  }
  return actual;
}

async function supabaseRequest(path, options = {}) {
  const url = supabaseBaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada.");
  }

  return fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(options.headers || {})
    }
  });
}

async function verifyReleaseObject(version, storagePath, expectedSize) {
  assertAgentSupabaseProject();

  if (
    typeof storagePath !== "string" ||
    !new RegExp(`^releases/${version}/[a-f0-9-]{36}\\.zip$`, "i").test(storagePath)
  ) {
    throw new Error("O caminho do pacote não corresponde à versão publicada.");
  }

  const response = await supabaseRequest(
    `/storage/v1/object/sign/${BUCKET}/${storagePathUrl(storagePath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 120 })
    }
  );
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.message || result.error || "O ZIP não foi encontrado no Storage.");
  }

  const signedPath = result.signedURL || result.signedUrl || result.url;
  if (typeof signedPath !== "string" || !signedPath) {
    throw new Error("O Storage não forneceu um link temporário para validar o ZIP.");
  }

  const base = supabaseBaseUrl();
  const downloadUrl = /^https?:\/\//i.test(signedPath)
    ? signedPath
    : signedPath.startsWith("/storage/v1/")
      ? `${base}${signedPath}`
      : signedPath.startsWith("/")
        ? `${base}/storage/v1${signedPath}`
        : null;

  if (!downloadUrl) throw new Error("O Storage retornou um link de download inválido.");

  const head = await fetch(downloadUrl, {
    method: "HEAD",
    signal: AbortSignal.timeout(20000)
  });
  if (!head.ok) {
    throw new Error(`O ZIP não está acessível para os agentes (HTTP ${head.status}).`);
  }

  const contentLength = Number(head.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 0 && contentLength !== Number(expectedSize)) {
    throw new Error(`O tamanho armazenado (${contentLength} bytes) não confere com o tamanho registrado (${expectedSize} bytes).`);
  }

  return { projectRef: supabaseProjectRef(), size: contentLength || null };
}

function safeCorePath(value) {
  if (typeof value !== "string") return null;

  const path = value.trim();

  if (
    !path ||
    path.length > 180 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    !/^[a-zA-Z0-9._/-]+$/.test(path)
  ) {
    return null;
  }

  const parts = path.split("/");

  if (
    parts.some(part =>
      !part ||
      part === "." ||
      part === ".."
    )
  ) {
    return null;
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

  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();

  if (!allowedExtensions.includes(extension)) {
    return null;
  }

  return path;
}

function storagePathUrl(path) {
  return path
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

// LISTAR ARQUIVOS RECURSIVAMENTE
async function listCoreFilesRecursive(prefix = "core", depth = 0) {
  if (depth > 20) {
    throw new Error("Profundidade máxima de pastas excedida.");
  }

  const files = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const response = await supabaseRequest(
      `/storage/v1/object/list/${BUCKET}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prefix,
          limit,
          offset,
          sortBy: {
            column: "name",
            order: "asc"
          }
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("[CORE DIRECTORY]", prefix, result);

      throw new Error(
        result.message ||
        result.error ||
        "Erro ao consultar pasta do núcleo."
      );
    }

    if (!Array.isArray(result)) {
      throw new Error("Resposta inválida do Storage.");
    }

    for (const item of result) {
      if (!item || !item.name) continue;

      const name = item.name;

      const fullPath = name.startsWith(prefix + "/")
        ? name
        : `${prefix}/${name}`;

      const isFolder =
        item.id == null &&
        item.metadata == null;

      if (isFolder) {
        const nestedFiles = await listCoreFilesRecursive(
          fullPath,
          depth + 1
        );

        files.push(...nestedFiles);
      } else {
        files.push({
          name: name.split("/").pop(),
          path: fullPath,
          size: Number(item.metadata?.size || 0),
          updatedAt: item.updated_at || item.created_at || null
        });
      }
    }

    if (result.length < limit) break;

    offset += limit;
  }

  return files;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!secret || secret.length < 32) {
    return res.status(500).json({
      error: "Chave de sessão não configurada"
    });
  }

  const action =
    req.query?.action ||
    req.body?.action;

  // LOGIN
  if (action === "login" && req.method === "POST") {
    const username = req.body?.username;
    const password = req.body?.password;

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      username.length > 100 ||
      password.length > 200
    ) {
      return res.status(400).json({
        error: "Preencha usuário e senha corretamente"
      });
    }

    if (
      !safeEqual(username, process.env.ADMIN_USERNAME || "") ||
      !safeEqual(password, process.env.ADMIN_PASSWORD || "")
    ) {
      return res.status(401).json({
        error: "Usuário ou senha incorretos"
      });
    }

    const payload = Buffer.from(JSON.stringify({
      user: username,
      exp: Date.now() + 8 * 60 * 60 * 1000
    })).toString("base64url");

    const signature = sign(payload, secret);

    res.setHeader(
      "Set-Cookie",
      `zucker_admin=${payload}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
    );

    return res.status(200).json({
      success: true
    });
  }

  // VERIFICAR SESSÃO
  if (action === "auth" && req.method === "GET") {
    const session = verifySession(req, secret);

    if (!session) {
      return res.status(401).json({
        authenticated: false
      });
    }

    return res.status(200).json({
      authenticated: true,
      user: session.user
    });
  }

  // LOGOUT
  if (action === "logout" && req.method === "POST") {
    res.setHeader(
      "Set-Cookie",
      "zucker_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
    );

    return res.status(200).json({
      success: true
    });
  }

  // PROTEGER TODAS AS OUTRAS OPERAÇÕES
  const session = verifySession(req, secret);

  if (!session) {
    return res.status(401).json({
      error: "Acesso não autorizado"
    });
  }

  const supabaseUrl = supabaseBaseUrl();

  // TESTAR SUPABASE
  if (action === "supabase_test" && req.method === "GET") {
    try {
      const response = await supabaseRequest(
        "/rest/v1/bot_releases?select=id,version,status,created_at&order=created_at.desc"
      );

      const result = await response.json();

      if (!response.ok) {
        return res.status(502).json({
          error: "O Supabase recusou a consulta",
          details: result.message || result.error || "Erro desconhecido"
        });
      }

      return res.status(200).json({
        success: true,
        message: "Conexão com Supabase estabelecida!",
        projectRef: supabaseProjectRef(),
        agentProjectRef: AGENT_SUPABASE_PROJECT_REF,
        agentProjectMatch: supabaseProjectRef() === AGENT_SUPABASE_PROJECT_REF,
        releases: result
      });
    } catch (error) {
      console.error("[SUPABASE]", error);

      return res.status(500).json({
        error: "Falha ao conectar com Supabase"
      });
    }
  }

  // LISTAR VERSÕES
  if (action === "list_releases" && req.method === "GET") {
    try {
      const response = await supabaseRequest(
        "/rest/v1/bot_releases?select=id,version,status,created_at,release_notes,package_size,sha256,storage_path&order=created_at.desc"
      );

      const result = await response.json();

      if (!response.ok) {
        console.error("[LIST RELEASES]", result);

        return res.status(502).json({
          error: "Não foi possível listar as versões."
        });
      }

      return res.status(200).json({
        success: true,
        releases: result
      });

    } catch (error) {
      console.error("[LIST RELEASES]", error);

      return res.status(500).json({
        error: "Erro ao buscar as versões."
      });
    }
  }

  // PUBLICAR VERSÃO — só publica depois de confirmar que o arquivo existe
  // e que o painel utiliza o mesmo projeto Supabase consultado pelos agentes.
  if (action === "publish_release" && req.method === "POST") {
    try {
      assertAgentSupabaseProject();
      const { id } = req.body || {};

      if (typeof id !== "string" || !id.trim() || id.length > 100) {
        return res.status(400).json({ error: "Identificador da versão inválido." });
      }

      const lookup = await supabaseRequest(
        `/rest/v1/bot_releases?id=eq.${encodeURIComponent(id)}&select=id,version,status,storage_path,sha256,package_size`
      );
      const releaseRows = await lookup.json().catch(() => []);
      if (!lookup.ok || !Array.isArray(releaseRows)) {
        throw new Error("Não foi possível validar o registro da versão.");
      }
      if (!releaseRows.length) {
        return res.status(404).json({ error: "Versão não encontrada." });
      }

      const release = releaseRows[0];
      if (!/^\d+\.\d+\.\d+$/.test(String(release.version || ""))) {
        return res.status(400).json({ error: "A versão cadastrada possui um número inválido." });
      }
      if (!/^[a-f0-9]{64}$/i.test(String(release.sha256 || ""))) {
        return res.status(400).json({ error: "O SHA-256 cadastrado é inválido." });
      }
      if (!Number.isSafeInteger(Number(release.package_size)) || Number(release.package_size) <= 0) {
        return res.status(400).json({ error: "O tamanho do pacote cadastrado é inválido." });
      }

      await verifyReleaseObject(
        release.version,
        release.storage_path,
        Number(release.package_size)
      );

      const response = await supabaseRequest(
        `/rest/v1/bot_releases?id=eq.${encodeURIComponent(id)}&select=id,version,status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Prefer: "return=representation"
          },
          body: JSON.stringify({ status: "published" })
        }
      );
      const result = await response.json().catch(() => []);

      if (!response.ok) {
        console.error("[PUBLISH RELEASE]", result);
        return res.status(400).json({
          error: result.message || result.error || "Não foi possível publicar a versão."
        });
      }
      if (!result.length) return res.status(404).json({ error: "Versão não encontrada." });

      return res.status(200).json({
        success: true,
        message: `Versão ${release.version} validada no Storage e publicada para os agentes.`,
        release: result[0]
      });

    } catch (error) {
      console.error("[PUBLISH RELEASE]", error);
      return res.status(error.code === "SUPABASE_PROJECT_MISMATCH" ? 409 : 502).json({
        error: error.message || "Erro ao publicar a versão."
      });
    }
  }

  // PREPARAR UPLOAD DE PACOTE ZIP
  if (action === "create_upload" && req.method === "POST") {
    try {
      assertAgentSupabaseProject();
      const { version, fileName, fileSize } = req.body || {};

      if (
        typeof version !== "string" ||
        !/^\d+\.\d+\.\d+$/.test(version)
      ) {
        return res.status(400).json({
          error: "Versão inválida. Use X.Y.Z."
        });
      }

      if (
        typeof fileName !== "string" ||
        !fileName.toLowerCase().endsWith(".zip")
      ) {
        return res.status(400).json({
          error: "O arquivo precisa ser ZIP."
        });
      }

      if (
        !Number.isSafeInteger(fileSize) ||
        fileSize <= 0 ||
        fileSize > 50 * 1024 * 1024
      ) {
        return res.status(400).json({
          error: "O ZIP deve ter até 50 MB."
        });
      }

      const storagePath =
        `releases/${version}/${crypto.randomUUID()}.zip`;

      const response = await supabaseRequest(
        `/storage/v1/object/upload/sign/${BUCKET}/${storagePathUrl(storagePath)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({})
        }
      );

      const result = await response.json();

      if (!response.ok || !result.url) {
        console.error("[STORAGE SIGN]", result);

        return res.status(502).json({
          error: "Não foi possível preparar o envio do ZIP.",
          details: result.message || result.error || "Erro no Storage"
        });
      }

      const signedUrl = /^https?:\/\//i.test(result.url)
        ? result.url
        : result.url.startsWith("/storage/v1/")
          ? `${supabaseUrl}${result.url}`
          : `${supabaseUrl}/storage/v1${result.url.startsWith("/") ? result.url : `/${result.url}`}`;

      return res.status(200).json({
        success: true,
        storagePath,
        signedUrl
      });

    } catch (error) {
      console.error("[CREATE UPLOAD]", error);

      return res.status(error.code === "SUPABASE_PROJECT_MISMATCH" ? 409 : 500).json({
        error: error.message || "Erro ao preparar o envio."
      });
    }
  }

  // REGISTRAR VERSÃO COMO RASCUNHO
  if (action === "save_release" && req.method === "POST") {
    try {
      const {
        version,
        storagePath,
        sha256,
        packageSize,
        releaseNotes
      } = req.body || {};

      if (
        typeof version !== "string" ||
        !/^\d+\.\d+\.\d+$/.test(version)
      ) {
        return res.status(400).json({
          error: "Versão inválida."
        });
      }

      if (
        typeof storagePath !== "string" ||
        !storagePath.startsWith(`releases/${version}/`) ||
        !storagePath.endsWith(".zip")
      ) {
        return res.status(400).json({
          error: "Caminho do pacote inválido."
        });
      }

      if (
        typeof sha256 !== "string" ||
        !/^[a-f0-9]{64}$/i.test(sha256)
      ) {
        return res.status(400).json({
          error: "Hash SHA-256 inválido."
        });
      }

      if (
        !Number.isSafeInteger(packageSize) ||
        packageSize <= 0 ||
        packageSize > 50 * 1024 * 1024
      ) {
        return res.status(400).json({
          error: "Tamanho do pacote inválido."
        });
      }

      // Não registra um release se o ZIP não estiver acessível no mesmo Supabase
      // que os agentes consultam.
      await verifyReleaseObject(version, storagePath, packageSize);

      const response = await supabaseRequest(
        "/rest/v1/bot_releases",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            version,
            storage_path: storagePath,
            sha256: sha256.toLowerCase(),
            package_size: packageSize,
            release_notes: String(releaseNotes || "").slice(0, 5000),
            status: "draft"
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        console.error("[SAVE RELEASE]", result);

        return res.status(400).json({
          error: result.code === "23505"
            ? "Essa versão já existe."
            : "Não foi possível registrar a versão.",
          details: result.message || result.error || "Erro desconhecido"
        });
      }

      return res.status(200).json({
        success: true,
        message: "Versão salva como rascunho.",
        release: result[0]
      });

    } catch (error) {
      console.error("[SAVE RELEASE]", error);

      return res.status(error.code === "SUPABASE_PROJECT_MISMATCH" ? 409 : 502).json({
        error: error.message || "Erro ao registrar a versão."
      });
    }
  }

  // ==========================================
  // GERENCIADOR DO NÚCLEO
  // ==========================================

  // LISTAR ARQUIVOS DO NÚCLEO
  if (action === "list_core_files" && req.method === "GET") {
    try {
      const files = await listCoreFilesRecursive("core");

      return res.status(200).json({
        success: true,
        files
      });

    } catch (error) {
      console.error("[LIST CORE FILES]", error);

      return res.status(502).json({
        error: "Não foi possível listar os arquivos do núcleo.",
        details: error.message
      });
    }
  }

    // PREPARAR UPLOAD OU SUBSTITUIÇÃO DE ARQUIVO DO NÚCLEO
  if (action === "create_core_upload" && req.method === "POST") {
    try {
      const { filePath, fileSize } = req.body || {};

      const safePath = safeCorePath(filePath);

      if (!safePath) {
        return res.status(400).json({
          error: "Caminho ou extensão de arquivo não permitido."
        });
      }

      if (
        !Number.isSafeInteger(fileSize) ||
        fileSize <= 0 ||
        fileSize > MAX_CORE_FILE_SIZE
      ) {
        return res.status(400).json({
          error: "O arquivo deve ter até 2 MB."
        });
      }

      const storagePath = `${CORE_PREFIX}${safePath}`;

      const response = await supabaseRequest(
        `/storage/v1/object/upload/sign/${BUCKET}/${storagePathUrl(storagePath)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            upsert: true
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.url) {
        console.error("[CORE UPLOAD SIGN]", result);

        return res.status(502).json({
          error: "Não foi possível preparar o envio do arquivo.",
          details: result.message || result.error || "Erro no Storage"
        });
      }

      const signedUrl = /^https?:\/\//i.test(result.url)
        ? result.url
        : result.url.startsWith("/storage/v1/")
          ? `${supabaseUrl}${result.url}`
          : `${supabaseUrl}/storage/v1${result.url.startsWith("/") ? result.url : `/${result.url}`}`;

      return res.status(200).json({
        success: true,
        storagePath,
        signedUrl
      });

    } catch (error) {
      console.error("[CORE UPLOAD]", error);

      return res.status(500).json({
        error: "Erro ao preparar o envio do arquivo."
      });
    }
  }

  // EXCLUIR ARQUIVO DO NÚCLEO
  if (action === "delete_core_file" && req.method === "POST") {
    try {
      const { storagePath } = req.body || {};

      if (
        typeof storagePath !== "string" ||
        !storagePath.startsWith(CORE_PREFIX)
      ) {
        return res.status(400).json({
          error: "Caminho do arquivo inválido."
        });
      }

      const safePath = safeCorePath(
        storagePath.slice(CORE_PREFIX.length)
      );

      if (!safePath) {
        return res.status(400).json({
          error: "Arquivo não permitido."
        });
      }

      const response = await supabaseRequest(
        `/storage/v1/object/${BUCKET}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            prefixes: [`${CORE_PREFIX}${safePath}`]
          })
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        console.error("[DELETE CORE FILE]", result);

        return res.status(502).json({
          error: "Não foi possível excluir o arquivo.",
          details: result.message || result.error || "Erro no Storage"
        });
      }

      return res.status(200).json({
        success: true,
        message: "Arquivo excluído com sucesso."
      });

    } catch (error) {
      console.error("[DELETE CORE FILE]", error);

      return res.status(500).json({
        error: "Erro ao excluir o arquivo."
      });
    }
  }

  
  
  // ==========================================
  // SUSPENSÃO E VALIDADE DAS CONTAS
  // ==========================================

  if (
    (action === "suspend_user" || action === "unsuspend_user") &&
    req.method === "POST"
  ) {
    try {
      const { userId } = req.body || {};
      const minutes = Number(req.body?.minutes);
      const reason = String(req.body?.reason || "").trim();

      if (typeof userId !== "string" || !userId.trim() || userId.length > 100) {
        return res.status(400).json({ error: "Conta inválida." });
      }
      if (action === "suspend_user" && (!Number.isInteger(minutes) || minutes < 1 || minutes > 43200)) {
        return res.status(400).json({ error: "Informe uma duração entre 1 e 43200 minutos." });
      }
      if (action === "suspend_user" && !reason) {
        return res.status(400).json({ error: "Informe o motivo da suspensão." });
      }
      if (reason.length > 500) {
        return res.status(400).json({ error: "O motivo pode ter no máximo 500 caracteres." });
      }

      const now = new Date();
      const updates = action === "suspend_user"
        ? {
            zucker_suspended_until: new Date(now.getTime() + minutes * 60000).toISOString(),
            zucker_suspended_at: now.toISOString(),
            zucker_suspension_reason: reason
          }
        : {
            zucker_suspended_until: null,
            zucker_suspended_at: null,
            zucker_suspension_reason: null
          };
      const access = await updateAccountControl(userId, updates);

      return res.status(200).json({
        success: true,
        suspended: access.suspended,
        suspended_until: access.suspendedUntil,
        reason: access.suspensionReason
      });
    } catch (error) {
      console.error("[USER SUSPENSION]", error);
      return res.status(error.status === 404 ? 404 : 502).json({
        error: "Não foi possível alterar a suspensão da conta."
      });
    }
  }

  if (action === "set_validity" && req.method === "POST") {
    try {
      const { userId } = req.body || {};
      const days = Number(req.body?.days);
      if (typeof userId !== "string" || !userId.trim() || userId.length > 100) {
        return res.status(400).json({ error: "Conta inválida." });
      }
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        return res.status(400).json({ error: "Informe uma quantidade entre 1 e 3650 dias." });
      }

      const access = await getAccountAccessById(userId);
      const now = Date.now();
      const currentTime = access.validityUntil ? new Date(access.validityUntil).getTime() : 0;
      const baseTime = Number.isFinite(currentTime) && currentTime > now ? currentTime : now;
      const validUntil = new Date(baseTime + days * 24 * 60 * 60 * 1000).toISOString();
      const renewalCount = access.validityRenewalCount + 1;
      const updated = await updateAccountControl(userId, {
        zucker_valid_until: validUntil,
        zucker_validity_type: "paid",
        zucker_validity_updated_at: new Date(now).toISOString(),
        zucker_validity_last_renewed_at: new Date(now).toISOString(),
        zucker_validity_renewal_count: renewalCount
      });

      return res.status(200).json({
        success: true,
        valid_until: updated.validityUntil,
        days_added: days,
        validity_type: "paid",
        renewal_count: updated.validityRenewalCount
      });
    } catch (error) {
      console.error("[SET USER VALIDITY]", error);
      return res.status(error.status === 404 ? 404 : 502).json({
        error: "Não foi possível atualizar a validade da conta."
      });
    }
  }

  // Lista todas as contas cadastradas, inclusive as que ainda não possuem bot vinculado.
  if (action === "list_accounts" && req.method === "GET") {
    try {
      const accounts = [];
      const perPage = 1000;
      for (let page = 1; page <= 20; page++) {
        const response = await supabaseRequest(
          `/auth/v1/admin/users?page=${page}&per_page=${perPage}`
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.message || data.msg || "Falha ao consultar usuários.");
        }
        const users = Array.isArray(data.users) ? data.users : [];
        if (!users.length) break;

        for (const user of users) {
          try {
            const access = await getAccountAccessForUser(user, false);
            const meta = access.metadata;
            accounts.push({
              user_id: user.id,
              account_name: meta.username || user.email?.split("@")[0] || "Não identificado",
              email: user.email || null,
              created_at: user.created_at || null,
              valid_until: access.validityUntil,
              validity_type: access.validityType,
              validity_remaining_ms: access.validityRemainingMs,
              validity_expired: access.validityExpired,
              renewal_count: access.validityRenewalCount,
              trial_granted_at: access.trialGrantedAt,
              suspended: access.suspended,
              suspended_until: access.suspendedUntil,
              suspension_reason: access.suspensionReason
            });
          } catch (accountError) {
            console.error("[LIST ACCOUNT ITEM]", user.id, accountError.message);
          }
        }
        if (users.length < perPage) break;
      }
      accounts.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      return res.status(200).json({ success: true, accounts });
    } catch (error) {
      console.error("[LIST ACCOUNTS]", error);
      return res.status(502).json({ error: "Não foi possível consultar as contas." });
    }
  }

  if (action === "list_update_reports" && req.method === "GET") {
    try {
      const response = await supabaseRequest(
        "/rest/v1/bot_update_events?select=id,user_id,device_id,version,status,message,created_at&order=created_at.desc&limit=100"
      );
      const reports = await response.json().catch(() => []);
      if (!response.ok) throw new Error("Falha ao consultar os relatórios de atualização.");
      return res.status(200).json({ success: true, reports: Array.isArray(reports) ? reports : [] });
    } catch (error) {
      console.error("[UPDATE REPORTS]", error);
      return res.status(502).json({ error: "Não foi possível consultar os relatórios." });
    }
  }

  // ==========================================
  // DISPOSITIVOS CONECTADOS
  // ==========================================
  
  if (action === "list_devices" && req.method === "GET") {
    try {
      const response = await supabaseRequest(
        "/rest/v1/devices?select=id,user_id,device_name,status,last_seen,whatsapp_connected&order=last_seen.desc"
      );

      const result = await response.json();

      if (!response.ok) {
        console.error("[LIST DEVICES]", result);

        return res.status(502).json({
          error: "Não foi possível consultar os dispositivos."
        });
      }

      const userIds = [...new Set(
        result.map(device => device.user_id).filter(Boolean)
      )];


      const accountInfo = {};
      await Promise.all(userIds.map(async userId => {
        try {
          const access = await getAccountAccessById(userId);
          const metadata = access.metadata;
          accountInfo[userId] = {
            account_name: access.user?.user_metadata?.username || access.user?.email?.split("@")[0] || metadata.username || "Não identificado",
            suspended: access.suspended,
            suspended_until: access.suspendedUntil,
            suspension_remaining_ms: access.suspensionRemainingMs,
            suspension_reason: access.suspensionReason,
            valid_until: access.validityUntil,
            validity_type: access.validityType,
            validity_remaining_ms: access.validityRemainingMs,
            validity_expired: access.validityExpired,
            renewal_count: access.validityRenewalCount,
            trial_granted_at: access.trialGrantedAt
          };
        } catch (error) {
          console.error("[DEVICE ACCOUNT INFO]", userId, error.message);
        }
      }));

      const pairingResponse = await supabaseRequest(
  "/rest/v1/whatsapp_pairing?select=device_id,phone_number,created_at&order=created_at.desc&limit=500"
);

const pairings = pairingResponse.ok
  ? await pairingResponse.json().catch(() => [])
  : [];

const pairingInfo = {};

for (const pairing of pairings) {
  if (!pairingInfo[pairing.device_id]) {
    pairingInfo[pairing.device_id] = pairing.phone_number;
  }
}

const devices = result.map(device => ({
  ...device,
  whatsapp_number: pairingInfo[device.id] || null,
  ...(accountInfo[device.user_id] || {
    account_name: "Não identificado",
    suspended: false,
    suspended_until: null,
    suspension_remaining_ms: 0,
    valid_until: null,
    validity_type: "none",
    validity_remaining_ms: 0,
    validity_expired: false,
    renewal_count: 0,
    trial_granted_at: null
  })
}));

      return res.status(200).json({
        success: true,
        devices
      });

    } catch (error) {
      console.error("[LIST DEVICES]", error);

      return res.status(500).json({
        error: "Erro ao buscar dispositivos."
      });
    }
  }

  
  return res.status(404).json({
    error: "Operação não encontrada",
    receivedAction: action || null,
    receivedMethod: req.method
  });
};
  
