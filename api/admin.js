
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

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!secret || secret.length < 32) {
    return res.status(500).json({
      error: "Chave de sessão não configurada"
    });
  }

  const action = req.method === "GET"
    ? req.query?.action
    : req.body?.action;

  // LOGIN
  if (action === "login" && req.method === "POST") {
    try {
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

    } catch (error) {
      console.error("[ADMIN LOGIN]", error);

      return res.status(500).json({
        error: "Erro interno no login"
      });
    }
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

  return res.status(404).json({
    error: "Operação não encontrada"
  });
};
        
