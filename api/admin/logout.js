
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  res.setHeader(
    "Set-Cookie",
    "zucker_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
  );

  return res.status(200).json({
    success: true,
    message: "Sessão encerrada"
  });
};
