(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
  let active = false;

  function isPasswordSetupRoute() {
    const path = String(window.location.pathname || "").replace(/\/+$/, "");
    const query = new URLSearchParams(window.location.search || "");
    return path === "/crear-contrasena" || query.get("public") === "crear-contrasena";
  }

  function invitationSignalInUrl() {
    const hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search || "");
    return [hash.get("type"), query.get("type")]
      .some(value => ["invite", "signup"].includes(String(value || "").toLowerCase()));
  }

  function passwordWasInitialized(user) {
    return user?.user_metadata?.jaeder_password_initialized === true;
  }

  function isPendingInvitedUser(user) {
    return Boolean(user?.invited_at && !passwordWasInitialized(user));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function render(content) {
    document.body.classList.add("auth-gate-active", "password-setup-active");
    document.body.innerHTML = `
      <main class="auth-gate password-setup-gate">
        <section class="auth-gate-card password-setup-card" aria-labelledby="password-setup-title">
          <p class="auth-gate-kicker">JAEDER SYSTEMS</p>
          ${content}
        </section>
      </main>
    `;
  }

  function renderLoading() {
    render(`
      <h1 id="password-setup-title">Preparando su acceso</h1>
      <p>Estamos validando la invitación segura. No cierre esta página.</p>
      <div class="password-setup-loader" role="status" aria-label="Validando invitación"></div>
    `);
  }

  function renderInvalid(message) {
    render(`
      <h1 id="password-setup-title">La invitación no está disponible</h1>
      <p>${escapeHtml(message || "El enlace venció, ya fue utilizado o no pudo validarse.")}</p>
      <div class="inline-feedback danger">Solicite al administrador una nueva invitación desde Usuarios.</div>
      <div class="auth-gate-actions">
        <button class="secondary-button" type="button" data-password-setup-login>Volver al inicio de sesión</button>
      </div>
    `);
    document.querySelector("[data-password-setup-login]")?.addEventListener("click", goToLogin);
  }

  function renderForm(user) {
    render(`
      <h1 id="password-setup-title">Crear contraseña</h1>
      <p>Acceso invitado para <strong>${escapeHtml(user?.email || "su cuenta")}</strong>.</p>
      <form class="auth-gate-form password-setup-form" id="password-setup-form">
        <label>Nueva contraseña
          <input name="password" type="password" autocomplete="new-password" minlength="12" required>
        </label>
        <label>Confirmar contraseña
          <input name="confirmation" type="password" autocomplete="new-password" minlength="12" required>
        </label>
        <small>Use al menos 12 caracteres, mayúscula, minúscula, número y símbolo.</small>
        <div class="inline-feedback danger" data-password-setup-error hidden></div>
        <button type="submit" data-password-setup-submit>Guardar contraseña</button>
      </form>
    `);
    document.querySelector("#password-setup-form")?.addEventListener("submit", submitPassword);
    document.querySelector('[name="password"]')?.focus();
  }

  function cleanLoginUrl() {
    return window.location.protocol === "file:"
      ? `${window.location.pathname}`
      : "/";
  }

  function goToLogin() {
    window.location.replace(cleanLoginUrl());
  }

  async function submitPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorNode = form.querySelector("[data-password-setup-error]");
    const button = form.querySelector("[data-password-setup-submit]");
    const password = String(form.elements.password?.value || "");
    const confirmation = String(form.elements.confirmation?.value || "");
    const fail = message => {
      errorNode.textContent = message;
      errorNode.hidden = false;
    };
    errorNode.hidden = true;
    if (password !== confirmation) return fail("Las contraseñas no coinciden.");
    if (!PASSWORD_PATTERN.test(password)) {
      return fail("La contraseña debe tener 12 caracteres, mayúscula, minúscula, número y símbolo.");
    }
    button.disabled = true;
    button.textContent = "Guardando...";
    try {
      const client = BlessERP.getSupabaseClient?.();
      if (!client) throw new Error("Supabase no está configurado en este ambiente.");
      const { data: sessionData } = await client.auth.getSession();
      const { error } = await client.auth.updateUser({
        password,
        data: {
          ...(sessionData?.session?.user?.user_metadata || {}),
          jaeder_password_initialized: true,
          jaeder_password_initialized_at: new Date().toISOString()
        }
      });
      if (error) throw error;
      render(`
        <h1 id="password-setup-title">Contraseña creada</h1>
        <p>La contraseña quedó protegida exclusivamente por Supabase Auth.</p>
        <div class="inline-feedback success">Ahora ingrese normalmente con su correo y la contraseña creada.</div>
      `);
      await client.auth.signOut({ scope: "local" }).catch(() => null);
      window.setTimeout(goToLogin, 1400);
    } catch (error) {
      fail(error?.message || "No se pudo guardar la contraseña. Solicite una nueva invitación.");
      button.disabled = false;
      button.textContent = "Guardar contraseña";
    }
  }

  async function waitForInviteSession(client) {
    const started = Date.now();
    let lastError = null;
    while (Date.now() - started < 12000) {
      const { data, error } = await client.auth.getSession();
      if (error) lastError = error;
      if (data?.session?.user) return data.session;
      await new Promise(resolve => window.setTimeout(resolve, 250));
    }
    throw lastError || new Error("No se pudo recuperar la sesión de la invitación.");
  }

  async function bootIfNeeded() {
    const client = BlessERP.getSupabaseClient?.();
    const explicitRoute = isPasswordSetupRoute() || invitationSignalInUrl();
    if (!explicitRoute && !client) return false;
    let existingSession = null;
    if (!explicitRoute) {
      const { data } = await client.auth.getSession();
      existingSession = data?.session || null;
      if (!isPendingInvitedUser(existingSession?.user)) return false;
    }
    active = true;
    renderLoading();
    if (!client) {
      renderInvalid("La invitación solo puede validarse desde el dominio web configurado.");
      return true;
    }
    try {
      const session = existingSession || await waitForInviteSession(client);
      if (!isPendingInvitedUser(session.user) && !explicitRoute) return false;
      try {
        if (window.location.protocol !== "file:" && window.location.pathname !== "/crear-contrasena") {
          window.history.replaceState({}, "", "/crear-contrasena");
        }
      } catch {
        // El formulario sigue siendo público aunque el navegador no permita actualizar la ruta.
      }
      renderForm(session.user);
    } catch (error) {
      renderInvalid(error?.message);
    }
    return true;
  }

  BlessERP.invitePassword = {
    bootIfNeeded,
    isPendingInvitedUser,
    isActive: () => active,
    isPasswordSetupRoute
  };
})();
