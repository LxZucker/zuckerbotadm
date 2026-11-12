
const crypto = require("crypto");

function sign(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    const secret = process.env.ADMIN_SESSION_SECRET;

    if (!secret || secret.length < 32) {
      return res.status(500).json({
        authenticated: false,
        error: "Chave de sessão não configurada"
      });
    }

    const cookies = (req.headers.cookie || "")
      .split(";")
      .map(item => item.trim());

    const cookie = cookies.find(item =>
      item.startsWith("zucker_admin=")
    );

    if (!cookie) {
      return res.status(401).json({
        authenticated: false
      });
    }

    const session = cookie.substring("zucker_admin=".length);
    const parts = session.split(".");

    if (parts.length !== 2) {
      return res.status(401).json({
        authenticated: false
      });
    }

    const [payload, signature] = parts;
    const expected = sign(payload, secret);

    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      return res.status(401).json({
        authenticated: false
      });
    }

    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    if (
      !data.user ||
      !data.exp ||
      data.exp < Date.now() ||
      data.user !== process.env.ADMIN_USERNAME
    ) {
      return res.status(401).json({
        authenticated: false
      });
    }

    return res.status(200).json({
      authenticated: true,
      user: data.user
    });

  } catch (error) {
    console.error("[ADMIN AUTH]", error);

    return res.status(401).json({
      authenticated: false
    });
  }
};
