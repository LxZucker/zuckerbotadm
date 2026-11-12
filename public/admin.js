
const crypto = require("crypto");

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

async function supabaseRequest(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Variáveis do Supabase não configuradas");
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

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!secret || secret.length < 32) {
    return res.status(500).json({
      error: "Chave de sessão não configurada"
    });
  }

  // RECONHECER OPERAÇÃO PELA URL OU PELO CORPO
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

  const supabaseUrl = process.env.SUPABASE_URL;

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
        releases: result
      });
    } catch (error) {
      console.error("[SUPABASE]", error);

      return res.status(500).json({
        error: "Falha ao conectar com Supabase"
      });
    }
  }

  // GERAR AUTORIZAÇÃO TEMPORÁRIA DE UPLOAD
  if (action === "create_upload" && req.method === "POST") {
    try {
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
        `/storage/v1/object/upload/sign/zuckerbots-releases/${storagePath}`,
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

      const signedUrl = result.url.startsWith("http")
        ? result.url
        : `${supabaseUrl}/storage/v1${result.url}`;

      return res.status(200).json({
        success: true,
        storagePath,
        signedUrl
      });

    } catch (error) {
      console.error("[CREATE UPLOAD]", error);

      return res.status(500).json({
        error: "Erro ao preparar o envio."
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

      return res.status(500).json({
        error: "Erro ao registrar a versão."
      });
    }
  }

  return res.status(404).json({
    error: "Operação não encontrada",
    receivedAction: action || null,
    receivedMethod: req.method
  });
};
      
