const SUPABASE_URL = process.env.SUPABASE_URL || "https://khkjlodngoahevxkxswj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CONTROL_FIELDS = [
  "zucker_valid_until",
  "zucker_validity_type",
  "zucker_validity_trial_granted_at",
  "zucker_validity_renewal_count",
  "zucker_validity_updated_at",
  "zucker_validity_last_renewed_at",
  "zucker_suspended_until",
  "zucker_suspended_at",
  "zucker_suspension_reason"
];

function adminHeaders(json = false) {
  if (!SUPABASE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada.");
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...(json ? { "Content-Type": "application/json" } : {})
  };
}

function parseTime(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

async function fetchUserById(userId) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { headers: adminHeaders() }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.msg || data.message || "Não foi possível consultar a conta.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function writeAppMetadata(userId, appMetadata) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      headers: adminHeaders(true),
      body: JSON.stringify({ app_metadata: appMetadata })
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.msg || data.message || "Não foi possível atualizar os dados de acesso.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function resolveControlMetadata(user, migrateLegacy = true) {
  const appMetadata = { ...(user.app_metadata || {}) };
  const legacyMetadata = user.user_metadata || {};
  let changed = false;

  for (const field of CONTROL_FIELDS) {
    if (appMetadata[field] === undefined && legacyMetadata[field] !== undefined) {
      appMetadata[field] = legacyMetadata[field];
      changed = true;
    }
  }

  if (changed && migrateLegacy) {
    const migrated = await writeAppMetadata(user.id, {
      ...appMetadata,
      zucker_access_control_version: 1
    });
    return { ...(migrated.app_metadata || appMetadata) };
  }

  if (changed) {
    return appMetadata;
  }

  return appMetadata;
}

function evaluateAccess(metadata = {}, now = Date.now()) {
  const suspendedUntil = metadata.zucker_suspended_until || null;
  const suspensionTime = parseTime(suspendedUntil);
  const validUntil = metadata.zucker_valid_until || null;
  const validityTime = parseTime(validUntil);
  const suspended = suspensionTime > now;
  const validityExpired = validityTime > 0 && validityTime <= now;
  const validityType = metadata.zucker_validity_type === "trial" ? "trial" :
    validUntil ? "paid" : "none";

  return {
    suspended,
    suspendedUntil,
    suspensionReason: String(metadata.zucker_suspension_reason || "Motivo não informado."),
    suspensionRemainingMs: suspended ? suspensionTime - now : 0,
    validityExpired,
    validityUntil: validUntil,
    validityType,
    validityRemainingMs: validityTime > now ? validityTime - now : 0,
    validityRenewalCount: Math.max(0, Number(metadata.zucker_validity_renewal_count) || 0),
    trialGrantedAt: metadata.zucker_validity_trial_granted_at || null,
    allowed: !suspended && !validityExpired
  };
}

async function getAccountAccessForUser(user, migrateLegacy = true) {
  const metadata = await resolveControlMetadata(user, migrateLegacy);
  return { user, metadata, ...evaluateAccess(metadata) };
}

async function getAccountAccessById(userId) {
  const user = await fetchUserById(userId);
  return getAccountAccessForUser(user, true);
}

async function getAccountAccessFromToken(userToken) {
  if (!userToken) throw new Error("Sessão ausente.");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${userToken}`
    }
  });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user.id) {
    const error = new Error("Sessão inválida.");
    error.status = 401;
    throw error;
  }
  const metadata = await resolveControlMetadata(user, true);
  return { user, metadata, ...evaluateAccess(metadata) };
}

async function updateAccountControl(userId, updates) {
  const access = await getAccountAccessById(userId);
  const nextMetadata = { ...access.metadata, ...updates, zucker_access_control_version: 1 };
  const updatedUser = await writeAppMetadata(userId, nextMetadata);
  const metadata = { ...(updatedUser.app_metadata || nextMetadata) };
  return { user: updatedUser, metadata, ...evaluateAccess(metadata) };
}

function accessBlockPayload(access) {
  if (access.suspended) {
    return {
      accessBlocked: true,
      suspended: true,
      reason: access.suspensionReason,
      suspendedUntil: access.suspendedUntil,
      remainingMs: access.suspensionRemainingMs
    };
  }
  if (access.validityExpired) {
    return {
      accessBlocked: true,
      validityExpired: true,
      validityType: access.validityType,
      validityUntil: access.validityUntil,
      remainingMs: 0
    };
  }
  return {
    accessBlocked: false,
    suspended: false,
    validityExpired: false,
    validityType: access.validityType,
    validityUntil: access.validityUntil,
    remainingMs: access.validityRemainingMs
  };
}

module.exports = {
  SUPABASE_URL,
  CONTROL_FIELDS,
  fetchUserById,
  writeAppMetadata,
  getAccountAccessById,
  getAccountAccessForUser,
  resolveControlMetadata,
  getAccountAccessFromToken,
  updateAccountControl,
  evaluateAccess,
  accessBlockPayload
};
  
