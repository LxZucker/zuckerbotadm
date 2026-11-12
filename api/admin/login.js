
const crypto = require("crypto");

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function sign(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    const usernameAdmin = process.env.ADMIN_USERNAME;
    const passwordAdmin = process.env.ADMIN_PASSWORD;
    const secret = process.env.ADMIN_SESSION_SECRET;

    if (
      !usernameAdmin ||
      !passwordAdmin ||
      !secret ||
      secret.length < 32
    ) {
      return res.status(500).json({
        error: "Configuração administrativa incompleta"
      });
    }

    const { username, password } = req.body || {};

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

    const validUsername = safeEqual(username, usernameAdmin);
    const validPassword = safeEqual(password, passwordAdmin);

    if (!validUsername || !validPassword) {
      return res.status(401).json({
        error: "Usuário ou senha incorretos"
      });
    }

    const payload = Buffer.from(JSON.stringify({
      user: usernameAdmin,
      exp: Date.now() + (8 * 60 * 60 * 1000)
    })).toString("base64url");

    const signature = sign(payload, secret);
    const session = `${payload}.${signature}`;

    res.setHeader(
      "Set-Cookie",
      `zucker_admin=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
    );

    return res.status(200).json({
      success: true,
      message: "Login realizado com sucesso"
    });

  } catch (error) {
    console.error("[ADMIN LOGIN]", error);

    return res.status(500).json({
      error: "Erro interno ao realizar login"
    });
  }
};
        
