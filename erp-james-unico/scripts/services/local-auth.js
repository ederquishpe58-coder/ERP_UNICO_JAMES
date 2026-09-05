(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const SESSION_KEY = "bless_flower_erp_local_auth_session_v1";
  const SESSION_DURATION_MS = 15 * 60 * 60 * 1000;
  const SESSION_HEARTBEAT_MS = 5 * 60 * 1000;
  const ITERATIONS = 210000;
  const HASH_BYTES = 32;
  const SALT_BYTES = 16;
  let sessionSupervisorStarted = false;

  function database() {
    return BlessERP.state?.state?.db || {};
  }

  function users() {
    return Array.isArray(database().visualUsers) ? database().visualUsers : [];
  }

  function credentialOf(user) {
    const credential = user?.localCredential;
    return credential
      && credential.version === 1
      && credential.algorithm === "PBKDF2-SHA256"
      && credential.salt
      && credential.hash
      ? credential
      : null;
  }

  function isConfigured() {
    return users().some(user => user.status === "activo" && credentialOf(user));
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach(value => { binary += String.fromCharCode(value); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ""));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  async function derive(password, salt, iterations = ITERATIONS) {
    if (!window.crypto?.subtle) {
      throw new Error("Este navegador no permite proteger contraseñas locales con Web Crypto.");
    }
    const material = await window.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(String(password || "")),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await window.crypto.subtle.deriveBits({
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    }, material, HASH_BYTES * 8);
    return new Uint8Array(bits);
  }

  function passwordErrors(password) {
    const value = String(password || "");
    const errors = [];
    if (value.length < 12) errors.push("La contraseña debe tener al menos 12 caracteres.");
    if (!/[a-záéíóúñ]/.test(value)) errors.push("La contraseña debe incluir una letra minúscula.");
    if (!/[A-ZÁÉÍÓÚÑ]/.test(value)) errors.push("La contraseña debe incluir una letra mayúscula.");
    if (!/[0-9]/.test(value)) errors.push("La contraseña debe incluir un número.");
    if (!/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/.test(value)) errors.push("La contraseña debe incluir un símbolo.");
    return errors;
  }

  async function createCredential(password) {
    const errors = passwordErrors(password);
    if (errors.length) return { ok: false, errors };
    const salt = window.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const hash = await derive(password, salt, ITERATIONS);
    return {
      ok: true,
      credential: {
        version: 1,
        algorithm: "PBKDF2-SHA256",
        iterations: ITERATIONS,
        salt: bytesToBase64(salt),
        hash: bytesToBase64(hash),
        updatedAt: new Date().toISOString()
      }
    };
  }

  function constantTimeEqual(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    return difference === 0;
  }

  async function verifyPassword(password, credential) {
    try {
      const expected = base64ToBytes(credential.hash);
      const actual = await derive(password, base64ToBytes(credential.salt), Number(credential.iterations || ITERATIONS));
      return constantTimeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  function normalizeLogin(value) {
    return String(value || "").trim().toLocaleLowerCase("es");
  }

  function findLoginUser(login) {
    const wanted = normalizeLogin(login);
    if (!wanted) return null;
    return users().find(user => (
      user.status === "activo"
      && credentialOf(user)
      && [user.username, user.code, user.email]
        .map(normalizeLogin)
        .filter(Boolean)
        .includes(wanted)
    )) || null;
  }

  function activeCompanyId() {
    return BlessERP.services?.companyContext?.activeCompanyId?.()
      || database().activeCompanyId
      || "COMP-BLESS-FLOWER";
  }

  function accessContext(user) {
    return BlessERP.menuService?.getUserAccessContext?.(user, activeCompanyId()) || { active: true };
  }

  function sessionUser(user) {
    const membership = accessContext(user);
    return {
      id: user.id,
      name: user.name || user.fullName || user.username || user.code,
      email: user.email || "",
      username: user.username || user.code || "",
      role: membership.roleCode || user.role || user.cargo || "",
      roleLabel: membership.roleLabel || user.role || user.cargo || "",
      cargo: user.cargo || user.role || "",
      area: user.area || ""
    };
  }

  function writeSession(userId, previousSession = null) {
    try {
      const now = Date.now();
      const session = {
        userId,
        companyId: activeCompanyId(),
        createdAt: previousSession?.createdAt || new Date(now).toISOString(),
        lastHeartbeatAt: new Date(now).toISOString(),
        expiresAt: new Date(now + SESSION_DURATION_MS).toISOString(),
        durationHours: SESSION_DURATION_MS / 3600000
      };
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        sessionStorage.removeItem(SESSION_KEY);
      } else {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
      return true;
    } catch {
      return false;
    }
  }

  function readSession() {
    try {
      const raw = (typeof localStorage !== "undefined" ? localStorage.getItem(SESSION_KEY) : "")
        || sessionStorage.getItem(SESSION_KEY);
      const session = JSON.parse(raw || "null");
      if (!session?.userId) return null;
      const expiresAt = Date.parse(session.expiresAt || "");
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        clearSession();
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  function clearSession() {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // La sesión se perderá al cerrar el navegador si el almacenamiento está bloqueado.
    }
  }

  function keepSessionAlive() {
    const session = readSession();
    if (!session?.userId) return false;
    return writeSession(session.userId, session);
  }

  function sessionStatus() {
    const session = readSession();
    const expiresAt = Date.parse(session?.expiresAt || "");
    return {
      active: Boolean(session),
      mode: "LOCAL",
      durationHours: SESSION_DURATION_MS / 3600000,
      expiresAt: session?.expiresAt || "",
      remainingMs: Number.isFinite(expiresAt) ? Math.max(expiresAt - Date.now(), 0) : 0
    };
  }

  function startSessionSupervisor() {
    if (sessionSupervisorStarted) return;
    sessionSupervisorStarted = true;
    if (typeof window.setInterval === "function") {
      window.setInterval(() => {
        if (document.visibilityState === "visible") keepSessionAlive();
      }, SESSION_HEARTBEAT_MS);
    }
    document.addEventListener?.("visibilitychange", () => {
      if (document.visibilityState === "visible") keepSessionAlive();
    });
    keepSessionAlive();
  }

  function activate(user) {
    const context = accessContext(user);
    if (!context.active) {
      return { ok: false, message: "El usuario no tiene acceso activo a la empresa abierta en esta pestaña." };
    }
    database().session = database().session || {};
    database().session.activeUser = sessionUser(user);
    BlessERP.storage?.save?.(database());
    writeSession(user.id);
    startSessionSupervisor();
    return { ok: true, user };
  }

  async function signIn(login, password) {
    const user = findLoginUser(login);
    if (!user || !(await verifyPassword(password, credentialOf(user)))) {
      return { ok: false, message: "Usuario o contraseña incorrectos." };
    }
    return activate(user);
  }

  async function signOut() {
    clearSession();
    return { ok: true };
  }

  async function boot(options = {}) {
    if (!isConfigured()) return { ok: true, mode: "LOCAL_SETUP" };
    const session = readSession();
    const user = users().find(item => (
      item.id === session?.userId
      && item.status === "activo"
      && credentialOf(item)
    ));
    if (user) {
      const result = activate(user);
      if (result.ok) {
        document.body.classList.remove("auth-gate-active");
        return { ok: true, mode: "LOCAL_AUTHENTICATED", user };
      }
    }
    clearSession();
    options.renderGate?.({
      title: "Acceso local a JAEDER SYSTEMS",
      message: "Ingrese con el usuario y la contraseña creados por el administrador dentro de JAEDER SYSTEMS.",
      showLogin: true,
      localMode: true
    });
    return { ok: false, mode: "LOCAL_LOGIN_REQUIRED" };
  }

  BlessERP.localAuth = {
    boot,
    clearSession,
    createCredential,
    credentialOf,
    isConfigured,
    markCurrentSession: writeSession,
    passwordErrors,
    sessionStatus,
    signIn,
    signOut,
    startSessionSupervisor,
    verifyPassword
  };
})();
