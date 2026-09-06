(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid } = BlessERP.utils;

  const userStates = ["activo", "inactivo"];
  const sequenceResets = ["nunca", "anual", "mensual"];
  const sequenceStates = ["activo", "inactivo"];
  const SRI_SEQUENCE_CODES = Object.freeze({
    FAC_EXPORT: Object.freeze({ documentType: "01", name: "Facturas de exportación", module: "Comercial" }),
    FAC_LOCAL: Object.freeze({ documentType: "01", name: "Facturas de venta local", module: "Comercial" }),
    NC_EXPORT: Object.freeze({ documentType: "04", name: "Notas de crédito de exportación", module: "Comercial" }),
    NC_LOCAL: Object.freeze({ documentType: "04", name: "Notas de crédito de venta local", module: "Comercial" }),
    RETE: Object.freeze({ documentType: "07", name: "Comprobantes de retencion", module: "Compras" })
  });
  const costCenterStates = ["activo", "inactivo"];
  const costCenterTypes = ["administrativo", "operativo", "produccion", "empaque", "ventas", "logistica", "otro"];
  const auditResults = ["exitoso", "bloqueado", "error"];
  const roleOptions = Object.freeze(
    (BlessERP.menuService?.ROLE_CODES || ["ADMIN", "SOPORTE", "CONTABILIDAD", "COMERCIAL", "OPERACIONES", "BODEGA", "INVITADO"])
      .map(code => ({
        code,
        label: BlessERP.menuService?.ROLE_LABELS?.[code] || code
      }))
  );

  function nowIso() {
    return new Date().toISOString();
  }

  function isOperationalDeployment() {
    const configured = typeof BlessERP.getAppMode === "function"
      ? BlessERP.getAppMode()
      : window.__ERP_ENV__?.VITE_APP_ENV;
    return ["test", "production"].includes(String(configured || "").trim().toLowerCase());
  }

  function companyProfiles() {
    if (isOperationalDeployment()) {
      const access = BlessERP.authAccess?.activeAccess?.() || {};
      const allowedKeys = new Set(
        (access.allowedCompanyKeys || []).map(value => String(value || "").trim()).filter(Boolean)
      );
      const authorized = (access.companies || [])
        .filter(company => company?.is_active !== false)
        .filter(company => allowedKeys.has(String(company?.company_key || "").trim()))
        .map(company => ({
          id: String(company.company_key || "").trim(),
          uuid: String(company.id || "").trim(),
          companyKey: String(company.company_key || "").trim(),
          code: String(company.company_code || company.company_key || "").trim(),
          commercialName: String(company.commercial_name || company.legal_name || company.company_key || "Empresa").trim(),
          active: company.is_active !== false
        }));
      if (authorized.length) return authorized;

      const cached = BlessERP.state?.state?.db?.authAccess || {};
      const cachedKeys = new Set(
        (cached.allowedCompanyKeys || []).map(value => String(value || "").trim()).filter(Boolean)
      );
      return (cached.companies || [])
        .filter(company => company?.is_active !== false)
        .filter(company => cachedKeys.has(String(company?.company_key || "").trim()))
        .map(company => ({
          id: String(company.company_key || "").trim(),
          uuid: String(company.id || "").trim(),
          companyKey: String(company.company_key || "").trim(),
          code: String(company.company_code || company.company_key || "").trim(),
          commercialName: String(company.commercial_name || company.legal_name || company.company_key || "Empresa").trim(),
          active: company.is_active !== false
        }));
    }
    const rows = BlessERP.companyCapabilities?.listCompanies?.() || [];
    if (rows.length) return rows;
    return [
      { id: "COMP-BLESS-FLOWER", commercialName: "Bless Flower" },
      { id: "COMP-IMPERIO-FLOWERS", commercialName: "Imperio Flowers" }
    ];
  }

  function activeCompanyId() {
    return BlessERP.services?.companyContext?.activeCompanyId?.()
      || stateApi.state.db.activeCompanyId
      || companyProfiles()[0]?.id
      || "COMP-BLESS-FLOWER";
  }

  function normalizeRouteAccess(value = {}) {
    const result = {};
    Object.entries(value && typeof value === "object" ? value : {}).forEach(([routeId, allowed]) => {
      if (allowed === true || allowed === false) result[String(routeId)] = allowed;
    });
    return result;
  }

  function defaultCompanyAccess(roleValue, enabled = true) {
    return {
      enabled: Boolean(enabled),
      status: enabled ? "activo" : "inactivo",
      roleCode: BlessERP.menuService?.normalizeRoleCode?.(roleValue) || "INVITADO",
      membershipRole: "VIEWER",
      profileId: "",
      profileName: "PROFILE_MISSING",
      profileState: "PROFILE_MISSING",
      legacyRoutePermissionCount: 0,
      legacyDependent: false,
      routeAccess: {}
    };
  }

  function normalizeCompanyAccess(value, roleValue, options = {}) {
    const source = value && typeof value === "object" ? value : {};
    const hasExplicitAccess = Object.keys(source).length > 0;
    const result = {};
    companyProfiles().forEach((company, index) => {
      const current = source[company.id];
      if (!current || typeof current !== "object") {
        const enabled = hasExplicitAccess ? false : options.newUser ? index === 0 : true;
        result[company.id] = defaultCompanyAccess(roleValue, enabled);
        return;
      }
      const enabled = current.enabled !== false;
      result[company.id] = {
        enabled,
        status: enabled && String(current.status || "activo").toLowerCase() !== "inactivo" ? "activo" : "inactivo",
        roleCode: BlessERP.menuService?.normalizeRoleCode?.(current.roleCode || roleValue) || "INVITADO",
        membershipRole: ["OWNER", "ADMIN", "EDITOR", "VIEWER"].includes(String(current.membershipRole || "").toUpperCase())
          ? String(current.membershipRole).toUpperCase()
          : "VIEWER",
        isDefault: current.isDefault === true,
        profileId: String(current.profileId || "").trim().toUpperCase(),
        profileName: String(current.profileName || "PROFILE_MISSING"),
        profileState: String(current.profileState || (current.profileId ? "CANONICAL" : "PROFILE_MISSING")),
        legacyRoutePermissionCount: Math.max(0, Number(current.legacyRoutePermissionCount || 0)),
        legacyDependent: current.legacyDependent === true,
        routeAccess: normalizeRouteAccess(current.routeAccess)
      };
    });
    return result;
  }

  function initialCreatorUser() {
    return BlessERP.initialAccess?.creatorUser?.() || null;
  }

  function defaultUsers() {
    return [];
  }

  function defaultSequences() {
    const companyId = activeCompanyId();
    const isBless = companyId === "COMP-BLESS-FLOWER";
    return [
      { id: "SEQ-FAC-EXPORT", code: "FAC_EXPORT", name: "Facturas de exportación", prefix: "", year: "", month: "", currentNumber: 0, length: 9, reset: "nunca", module: "Comercial", status: "activo", documentType: "01", environment: "PRUEBAS", establishmentCode: "001", emissionPointCode: "002", configurationStatus: "CONFIRMADA", observation: isBless ? "Bless Flower: ventas de exportación 001-002." : "Imperio Flowers: ventas de exportación 001-002." },
      { id: "SEQ-FAC-LOCAL", code: "FAC_LOCAL", name: "Facturas de venta local", prefix: "", year: "", month: "", currentNumber: isBless ? 674 : 0, length: 9, reset: "nunca", module: "Comercial", status: "activo", documentType: "01", environment: "PRUEBAS", establishmentCode: "001", emissionPointCode: "003", configurationStatus: "CONFIRMADA", observation: isBless ? "Bless Flower: ventas locales 001-003; último emitido informado 000000674." : "Imperio Flowers: ventas locales 001-003." },
      { id: "SEQ-NC-EXPORT", code: "NC_EXPORT", name: "Notas de crédito de exportación", prefix: "", year: "", month: "", currentNumber: 0, length: 9, reset: "nunca", module: "Comercial", status: "activo", documentType: "04", environment: "PRUEBAS", establishmentCode: "001", emissionPointCode: "002", configurationStatus: "PENDIENTE_CONFIRMACION", observation: isBless ? "Bless Flower: notas de crédito de exportación 001-002." : "Imperio Flowers: notas de crédito de exportación 001-002." },
      { id: "SEQ-NC-LOCAL", code: "NC_LOCAL", name: "Notas de crédito de venta local", prefix: "", year: "", month: "", currentNumber: 0, length: 9, reset: "nunca", module: "Comercial", status: "activo", documentType: "04", environment: "PRUEBAS", establishmentCode: "001", emissionPointCode: "003", configurationStatus: "PENDIENTE_CONFIRMACION", observation: isBless ? "Bless Flower: notas de crédito locales 001-003." : "Imperio Flowers: notas de crédito locales 001-003." },
      { id: "SEQ-ASI", code: "ASI", name: "Asientos contables", prefix: "ASI", year: "2026", month: "", currentNumber: 25, length: 6, reset: "anual", module: "Contabilidad", status: "activo", observation: "Secuencial interno del libro diario." },
      { id: "SEQ-COM", code: "COM", name: "Compras", prefix: "COM", year: "2026", month: "", currentNumber: 3, length: 6, reset: "anual", module: "Compras", status: "activo", observation: "Control interno para documentos de compra." },
      { id: "SEQ-RETE", code: "RETE", name: "Comprobantes de retencion", prefix: "", year: "", month: "", currentNumber: isBless ? 686 : 0, length: 9, reset: "nunca", module: "Compras", status: "activo", documentType: "07", environment: "PRUEBAS", establishmentCode: "001", emissionPointCode: "002", configurationStatus: isBless ? "CONFIRMADA" : "PENDIENTE_CONFIRMACION", observation: "Secuencial tributario tipo 07 para comprobantes de retencion emitidos." },
      { id: "SEQ-RETR", code: "RETR", name: "Retenciones recibidas", prefix: "RETR", year: "2026", month: "", currentNumber: 2, length: 6, reset: "anual", module: "Tributario", status: "activo", observation: "Importaciones XML de retenciones recibidas." },
      { id: "SEQ-PAGO", code: "PAGO", name: "Pagos", prefix: "PAGO", year: "2026", month: "", currentNumber: 2, length: 6, reset: "anual", module: "Carteras", status: "activo", observation: "Pagos individuales y lotes." },
      { id: "SEQ-COBRO", code: "COBRO", name: "Cobros", prefix: "COBRO", year: "2026", month: "", currentNumber: 2, length: 6, reset: "anual", module: "Carteras", status: "activo", observation: "Cobros individuales y lotes." },
      { id: "SEQ-BAN", code: "BAN", name: "Movimientos bancarios", prefix: "BAN", year: "2026", month: "", currentNumber: 3, length: 6, reset: "anual", module: "Bancos", status: "activo", observation: "Movimientos auxiliares de bancos y caja." },
      { id: "SEQ-CONC", code: "CONC", name: "Conciliaciones bancarias", prefix: "CONC", year: "2026", month: "", currentNumber: 1, length: 6, reset: "mensual", module: "Bancos", status: "activo", observation: "Cierres de conciliacion por cuenta y periodo." },
      { id: "SEQ-INV", code: "INV", name: "Movimientos de inventario", prefix: "INV", year: "2026", month: "", currentNumber: 8, length: 6, reset: "anual", module: "Inventario", status: "activo", observation: "Entradas y salidas generales de inventario." },
      { id: "SEQ-CONS", code: "CONS", name: "Consumos de inventario", prefix: "CONS", year: "2026", month: "", currentNumber: 1, length: 6, reset: "anual", module: "Inventario", status: "activo", observation: "Consumos al gasto o costo." },
      { id: "SEQ-AJU", code: "AJU", name: "Ajustes de inventario", prefix: "AJU", year: "2026", month: "", currentNumber: 1, length: 6, reset: "anual", module: "Inventario", status: "activo", observation: "Ajustes positivos y negativos." },
      { id: "SEQ-ATS", code: "ATS", name: "Generaciones ATS", prefix: "ATS", year: "2026", month: "", currentNumber: 1, length: 6, reset: "mensual", module: "Tributario", status: "activo", observation: "XML preliminar y revisiones ATS." }
    ];
  }

  function companyAllows(capability, fallback = true) {
    const companyContext = BlessERP.services?.companyContext;
    return companyContext?.hasCapability ? companyContext.hasCapability(capability) : fallback;
  }

  function sequenceAllowed(code) {
    const normalized = String(code || "").trim().toUpperCase();
    if (normalized === "FAC") return false;
    if (normalized === "RETE") return companyAllows("purchases.issueWithholdings");
    if (["INV", "CONS", "AJU"].includes(normalized)) return companyAllows("inventory.materials");
    return true;
  }

  function companyDefaultSequences() {
    return defaultSequences().filter(item => sequenceAllowed(item.code));
  }

  function defaultCostCenters() {
    return [
      { id: "CC-ADMINISTRACION", code: "ADMINISTRACION", name: "Administracion", type: "administrativo", responsible: "James Lanchimba", status: "activo", relatedAccount: "5.3", observation: "Centro administrativo general." },
      { id: "CC-CAMPO", code: "CAMPO", name: "Campo", type: "produccion", responsible: "Responsable de campo", status: "activo", relatedAccount: "5.1", observation: "Base operativa de campo." },
      { id: "CC-POSCOSECHA", code: "POSCOSECHA", name: "Poscosecha", type: "produccion", responsible: "Responsable poscosecha", status: "activo", relatedAccount: "5.1", observation: "Preparado para integracion futura con Parte 1." },
      { id: "CC-EMPAQUE", code: "EMPAQUE", name: "Empaque", type: "empaque", responsible: "Responsable de empaque", status: "activo", relatedAccount: "5.2", observation: "Consumos y costos de materiales de empaque." },
      { id: "CC-BODEGA", code: "BODEGA", name: "Bodega", type: "operativo", responsible: "Usuario Bodega", status: "activo", relatedAccount: "1.1.03.02", observation: "Control operativo de suministros y materiales." },
      { id: "CC-VENTAS", code: "VENTAS", name: "Ventas", type: "ventas", responsible: "Equipo comercial", status: "activo", relatedAccount: "4.1", observation: "Reservado para la fase comercial futura." },
      { id: "CC-LOGISTICA", code: "LOGISTICA", name: "Logistica", type: "logistica", responsible: "Coordinacion logistica", status: "activo", relatedAccount: "5.3", observation: "Apoyo a operaciones de despacho y transporte." },
      { id: "CC-MANTENIMIENTO", code: "MANTENIMIENTO", name: "Mantenimiento", type: "operativo", responsible: "Responsable de mantenimiento", status: "activo", relatedAccount: "5.4", observation: "Consumos y gastos por mantenimiento." },
      { id: "CC-GERENCIA", code: "GERENCIA", name: "Gerencia", type: "administrativo", responsible: "Gerencia general", status: "activo", relatedAccount: "5.3", observation: "Centro de decisiones y direccion." }
    ];
  }

  function defaultAuditLogs() {
    return [
      {
        id: "AUD-DEMO-001",
        createdAt: "2026-07-24T09:15:00.000Z",
        userId: "USR-ADMIN-001",
        userName: "James Lanchimba",
        userEmail: "",
        userRole: "Administrador / Contador",
        userArea: "Administracion / Contabilidad",
        module: "COMPRAS",
        action: "CONTABILIZAR_COMPRA",
        entityType: "purchase",
        entityId: "PUR-DEMO-001",
        entityLabel: "001-001-000000123",
        documentLabel: "Compra Agroinsumos del Ecuador",
        previousStatus: "PENDIENTE_CLASIFICACION",
        nextStatus: "PENDIENTE_RETENCION",
        description: "Compra contabilizada y enviada a cuenta por pagar.",
        reason: "",
        result: "exitoso",
        ipDevice: "local / navegador",
        before: { status: "PENDIENTE_CLASIFICACION" },
        after: { status: "PENDIENTE_RETENCION" }
      },
      {
        id: "AUD-DEMO-002",
        createdAt: "2026-07-24T10:30:00.000Z",
        userId: "USR-WHS-004",
        userName: "Usuario Bodega",
        userEmail: "",
        userRole: "Responsable bodega",
        userArea: "Bodega",
        module: "INVENTARIO",
        action: "CONFIRMAR_MOVIMIENTO",
        entityType: "inventory_movement",
        entityId: "MOV-DEMO-001",
        entityLabel: "INV-2026-000006",
        documentLabel: "Consumo ligas empaque",
        previousStatus: "BORRADOR",
        nextStatus: "CONFIRMADO",
        description: "Movimiento de consumo confirmado con impacto en stock y asiento.",
        reason: "",
        result: "exitoso",
        ipDevice: "local / navegador",
        before: { status: "BORRADOR" },
        after: { status: "CONFIRMADO" }
      },
      {
        id: "AUD-DEMO-003",
        createdAt: "2026-07-24T11:05:00.000Z",
        userId: "USR-ACC-003",
        userName: "Usuario Contable",
        userEmail: "",
        userRole: "Asistente contable",
        userArea: "Contabilidad",
        module: "BANCOS",
        action: "CERRAR_CONCILIACION",
        entityType: "bank_reconciliation",
        entityId: "REC-DEMO-001",
        entityLabel: "CONC-2026-000001",
        documentLabel: "Conciliacion Banco Pichincha Junio 2026",
        previousStatus: "EN_REVISION",
        nextStatus: "CERRADA",
        description: "Conciliacion cerrada con diferencia en cero.",
        reason: "",
        result: "exitoso",
        ipDevice: "local / navegador",
        before: { status: "EN_REVISION" },
        after: { status: "CERRADA" }
      },
      {
        id: "AUD-DEMO-004",
        createdAt: "2026-07-24T12:45:00.000Z",
        userId: "USR-ADMIN-001",
        userName: "James Lanchimba",
        userEmail: "",
        userRole: "Administrador / Contador",
        userArea: "Administracion / Contabilidad",
        module: "ATS",
        action: "GENERAR_ATS_PRELIMINAR",
        entityType: "ats_generation",
        entityId: "ATS-DEMO-001",
        entityLabel: "ATS-2026-000001",
        documentLabel: "ATS Junio 2026",
        previousStatus: "PREPARADO",
        nextStatus: "CON_ERRORES",
        description: "Validacion preliminar ATS detecto un error critico y una advertencia.",
        reason: "",
        result: "bloqueado",
        ipDevice: "local / navegador",
        before: { status: "PREPARADO" },
        after: { status: "CON_ERRORES" }
      }
    ];
  }

  function ensureStore() {
    const db = stateApi.state.db;
    if (!Array.isArray(db.visualUsers)) db.visualUsers = defaultUsers();
    if (!db.visualUsers.length && !isOperationalDeployment()) db.visualUsers = defaultUsers();
    if (isOperationalDeployment()) {
      db.visualUsers = db.visualUsers.filter(user => user?.localOnly !== true);
    } else {
      const creator = initialCreatorUser();
      const creatorIndex = creator ? db.visualUsers.findIndex(user => user?.id === creator.id) : -1;
      if (creator && creatorIndex < 0) {
        db.visualUsers.unshift(creator);
      } else if (creator) {
        const current = db.visualUsers[creatorIndex] || {};
        db.visualUsers[creatorIndex] = {
          ...creator,
          ...current,
          username: current.username || creator.username,
          email: current.email || creator.email,
          status: "activo",
          protectedCreator: true,
          localOnly: true,
          localCredential: current.localCredential || creator.localCredential,
          companyAccess: creator.companyAccess
        };
      }
    }
    db.visualUsers = db.visualUsers.map(user => normalizeUser(user));
    const defaultsForCompany = companyDefaultSequences();
    if (!Array.isArray(db.documentSequences) || !db.documentSequences.length) {
      db.documentSequences = defaultsForCompany;
    } else {
      db.documentSequences = db.documentSequences.filter(item => sequenceAllowed(item.code));
      const existingCodes = new Set(db.documentSequences.map(item => String(item.code || "").toUpperCase()));
      db.documentSequences.push(...defaultsForCompany.filter(item => !existingCodes.has(item.code)));
    }
    db.documentSequences = db.documentSequences.map(sequence => migrateSriSequence(sequence));
    const invoiceSequence = db.documentSequences.find(sequence => sequence.code === "FAC_EXPORT");
    const retentionSequence = db.documentSequences.find(sequence => sequence.code === "RETE");
    db.companySettings = {
      ...(db.companySettings || {}),
      ...(invoiceSequence ? {
        mainEstablishment: invoiceSequence.establishmentCode,
        mainEmissionPoint: invoiceSequence.emissionPointCode
      } : {}),
      ...(retentionSequence ? {
        retentionEstablishmentCode: retentionSequence.establishmentCode,
        retentionEmissionPointCode: retentionSequence.emissionPointCode
      } : {})
    };
    if (!Array.isArray(db.costCenters) || !db.costCenters.length) db.costCenters = defaultCostCenters();
    if (!Array.isArray(db.auditLogs)) db.auditLogs = defaultAuditLogs();
    if (!db.session) db.session = {};
    if (!db.session.activeUser && db.visualUsers.length) {
      const user = normalizeUser(db.visualUsers[0]);
      db.session.activeUser = toSessionUser(user);
    }
  }

  function normalizeUser(user = {}) {
    const current = { ...clone(user || {}) };
    const role = String(current.role || current.cargo || "").trim();
    const username = String(current.username || current.code || current.email || "").trim();
    return {
      id: String(current.id || uid("USR")).trim(),
      code: String(current.code || "").trim(),
      name: String(current.name || current.fullName || "").trim(),
      fullName: String(current.fullName || current.name || "").trim(),
      email: String(current.email || "").trim(),
      username,
      role,
      cargo: String(current.cargo || current.role || "").trim(),
      area: String(current.area || "").trim(),
      status: userStates.includes(String(current.status || "").toLowerCase()) ? String(current.status || "").toLowerCase() : "activo",
      observation: String(current.observation || "").trim(),
      cloudManaged: current.cloudManaged === true,
      preserveAuthEmail: current.preserveAuthEmail === true,
      protectedCreator: current.protectedCreator === true,
      localOnly: current.localOnly === true,
      localCredential: current.localCredential && typeof current.localCredential === "object"
        ? clone(current.localCredential)
        : null,
      companyAccess: normalizeCompanyAccess(current.companyAccess, current.roleCode || role, {
        newUser: Boolean(current.__newUser)
      })
    };
  }

  function toSessionUser(user, companyId = activeCompanyId()) {
    const membership = BlessERP.menuService?.membershipForUser?.(user, companyId);
    return {
      id: user.id,
      name: user.name || user.fullName,
      email: user.email || "",
      role: membership?.roleCode || user.role || user.cargo || "",
      roleLabel: BlessERP.menuService?.ROLE_LABELS?.[membership?.roleCode] || user.role || user.cargo || "",
      cargo: user.cargo || user.role || "",
      area: user.area || ""
    };
  }

  function normalizeSequence(sequence = {}) {
    const current = { ...clone(sequence || {}) };
    const code = String(current.code || "").trim().toUpperCase();
    const sriDefinition = SRI_SEQUENCE_CODES[code] || null;
    const sriSequence = Boolean(sriDefinition);
    const normalizeThreeDigits = value => String(value || "").replace(/\D/g, "").slice(-3).padStart(3, "0");
    return {
      id: String(current.id || uid("SEQ")).trim(),
      code,
      name: sriSequence ? sriDefinition.name : String(current.name || "").trim(),
      prefix: sriSequence ? "" : String(current.prefix || current.code || "").trim().toUpperCase(),
      year: sriSequence ? "" : String(current.year || new Date().getFullYear()).trim(),
      month: sriSequence ? "" : String(current.month || "").trim(),
      currentNumber: Math.max(0, Number(current.currentNumber || 0)),
      length: sriSequence ? 9 : Math.max(3, Number(current.length || 6)),
      reset: sriSequence ? "nunca" : (sequenceResets.includes(String(current.reset || "").toLowerCase()) ? String(current.reset || "").toLowerCase() : "anual"),
      module: sriSequence ? sriDefinition.module : String(current.module || "").trim(),
      status: sequenceStates.includes(String(current.status || "").toLowerCase()) ? String(current.status || "").toLowerCase() : "activo",
      documentType: sriSequence ? sriDefinition.documentType : "",
      environment: sriSequence ? "PRUEBAS" : "",
      establishmentCode: sriSequence ? normalizeThreeDigits(current.establishmentCode || current.establishment_code || "001") : "",
      emissionPointCode: sriSequence ? normalizeThreeDigits(current.emissionPointCode || current.emission_point_code || "001") : "",
      configurationStatus: sriSequence
        ? (String(current.configurationStatus || "").trim().toUpperCase() || "PENDIENTE_CONFIRMACION")
        : "",
      observation: String(current.observation || "").trim()
    };
  }

  function migrateSriSequence(sequence = {}) {
    const current = { ...clone(sequence || {}) };
    const code = String(current.code || "").trim().toUpperCase();
    const companyId = activeCompanyId();
    const isBless = companyId === "COMP-BLESS-FLOWER";
    if (!SRI_SEQUENCE_CODES[code]) return normalizeSequence(current);

    if (isBless && code === "FAC_LOCAL") {
      current.currentNumber = Math.max(674, Number(current.currentNumber || 0));
      current.establishmentCode = "001";
      current.emissionPointCode = "003";
      current.configurationStatus = "CONFIRMADA";
    } else if (isBless && code === "FAC_EXPORT") {
      current.currentNumber = Math.max(0, Number(current.currentNumber || 0));
      current.establishmentCode = "001";
      current.emissionPointCode = "002";
      current.configurationStatus = "CONFIRMADA";
    } else if (isBless && code === "RETE") {
      current.currentNumber = Math.max(686, Number(current.currentNumber || 0));
      current.establishmentCode = current.documentType ? (current.establishmentCode || "001") : "001";
      current.emissionPointCode = current.documentType ? (current.emissionPointCode || "002") : "002";
      current.configurationStatus = "CONFIRMADA";
    } else if (["FAC_EXPORT", "FAC_LOCAL"].includes(code)) {
      current.currentNumber = Math.max(0, Number(current.currentNumber || 0));
      current.establishmentCode = current.establishmentCode || "001";
      current.emissionPointCode = current.emissionPointCode || "001";
      current.configurationStatus = current.configurationStatus || "PENDIENTE_CONFIRMACION";
    }
    current.documentType = SRI_SEQUENCE_CODES[code].documentType;
    return normalizeSequence(current);
  }

  function normalizeCostCenter(costCenter = {}) {
    const current = { ...clone(costCenter || {}) };
    return {
      id: String(current.id || uid("CC")).trim(),
      code: String(current.code || "").trim().toUpperCase(),
      name: String(current.name || "").trim(),
      type: costCenterTypes.includes(String(current.type || "").toLowerCase()) ? String(current.type || "").toLowerCase() : "otro",
      responsible: String(current.responsible || "").trim(),
      status: costCenterStates.includes(String(current.status || "").toLowerCase()) ? String(current.status || "").toLowerCase() : "activo",
      relatedAccount: String(current.relatedAccount || "").trim(),
      observation: String(current.observation || "").trim()
    };
  }

  function sanitizePayload(payload, level = 0) {
    if (payload == null || level > 4) return payload;
    if (Array.isArray(payload)) return payload.slice(0, 25).map(item => sanitizePayload(item, level + 1));
    if (typeof payload === "object") {
      const next = {};
      Object.entries(payload).forEach(([key, value]) => {
        const lowered = key.toLowerCase();
        if (lowered.includes("password") || lowered.includes("credential") || lowered.includes("secret") || lowered.includes("token")) return;
        if (lowered.includes("preview") && typeof value === "object") return;
        if (typeof value === "string" && value.length > 500) {
          next[key] = `${value.slice(0, 497)}...`;
          return;
        }
        next[key] = sanitizePayload(value, level + 1);
      });
      return next;
    }
    return payload;
  }

  function activeUser() {
    ensureStore();
    const sessionUser = stateApi.state.db.session.activeUser || {};
    const found = visualUsers().find(item => item.id === sessionUser.id);
    return found || normalizeUser({
      id: sessionUser.id || "USR-LOCAL",
      name: sessionUser.name || "Usuario local",
      fullName: sessionUser.name || "Usuario local",
      email: sessionUser.email || "",
      role: sessionUser.role || "",
      cargo: sessionUser.cargo || sessionUser.role || "",
      area: sessionUser.area || "",
      status: "activo"
    });
  }

  function visualUsers(filters = {}) {
    ensureStore();
    const search = String(filters.search || "").trim().toLowerCase();
    return (stateApi.state.db.visualUsers || [])
      .map(normalizeUser)
      .filter(item => {
        if (filters.status && item.status !== filters.status) return false;
        if (!search) return true;
        const haystack = [item.code, item.name, item.fullName, item.email, item.role, item.cargo, item.area].join(" ").toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  function replaceCloudDirectory(users = []) {
    if (!isOperationalDeployment()) return false;
    ensureStore();
    stateApi.state.db.visualUsers = (Array.isArray(users) ? users : []).map(normalizeUser);
    BlessERP.storage?.save?.(stateApi.state.db, { replaceAll: true });
    return true;
  }

  function nextUserCode() {
    const max = visualUsers().reduce((current, user) => {
      const number = Number(String(user.code || "").replace(/\D/g, "")) || 0;
      return Math.max(current, number);
    }, 0);
    return `USR-${String(max + 1).padStart(3, "0")}`;
  }

  function createUserDraft() {
    return normalizeUser({
      id: uid("USR"),
      code: nextUserCode(),
      name: "",
      fullName: "",
      email: "",
      username: "",
      role: "Solo consulta básica",
      cargo: "",
      area: "",
      status: "activo",
      observation: "",
      __newUser: true
    });
  }

  function findUser(userId) {
    return visualUsers().find(item => item.id === userId) || null;
  }

  function isAccessAdministrator(user, companyId) {
    const context = BlessERP.menuService?.getUserAccessContext?.(user, companyId);
    if (!context?.active || !["ADMIN", "SOPORTE"].includes(context.roleCode)) return false;
    return BlessERP.menuService?.canUserAccessRoute?.(user, companyId, "settings-users") !== false;
  }

  function validateAdministratorContinuity(rows) {
    const errors = [];
    companyProfiles().forEach(company => {
      if (!rows.some(user => isAccessAdministrator(user, company.id))) {
        errors.push(`Debe mantenerse al menos un administrador o soporte activo con acceso a Usuarios en ${company.commercialName}.`);
      }
    });
    return errors;
  }

  function saveUser(user, options = {}) {
    if (isOperationalDeployment()) return { ok: false, errors: ["El acceso requiere confirmación del perfil canónico en Supabase."] };
    ensureStore();
    const rows = visualUsers();
    const candidate = normalizeUser(user);
    const index = rows.findIndex(item => item.id === candidate.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    const errors = [];
    if (!candidate.code) errors.push("El codigo del usuario es obligatorio.");
    if (!candidate.fullName && !candidate.name) errors.push("El nombre del usuario es obligatorio.");
    if (!candidate.username) errors.push("El usuario de ingreso es obligatorio.");
    if (!candidate.cargo) errors.push("El cargo del usuario es obligatorio.");
    if (rows.some(item => item.id !== candidate.id && item.code.toUpperCase() === candidate.code.toUpperCase())) {
      errors.push("No se permite un codigo de usuario duplicado.");
    }
    if (candidate.email && rows.some(item => item.id !== candidate.id && item.email && item.email.toLowerCase() === candidate.email.toLowerCase())) {
      errors.push("Ese correo ya pertenece a otro usuario.");
    }
    if (rows.some(item => item.id !== candidate.id && item.username && item.username.toLowerCase() === candidate.username.toLowerCase())) {
      errors.push("Ese usuario de ingreso ya pertenece a otra persona.");
    }

    const currentUserId = stateApi.state.db.session?.activeUser?.id;
    if (candidate.id === currentUserId) {
      if (candidate.status !== "activo") errors.push("No puede inactivar al usuario que mantiene abierta la sesion local.");
      if (!BlessERP.menuService?.canUserAccessRoute?.(candidate, activeCompanyId(), "settings-users")) {
        errors.push("No puede quitarse a si mismo el acceso a Usuarios en la empresa actual. Use la vista previa para comprobar otros perfiles.");
      }
    }

    const nextRows = [...rows];
    if (index >= 0) nextRows[index] = candidate;
    else nextRows.unshift(candidate);
    errors.push(...validateAdministratorContinuity(nextRows));

    const accessChanged = before && JSON.stringify(before.companyAccess || {}) !== JSON.stringify(candidate.companyAccess || {});
    const reason = String(options.reason || "").trim();
    if (accessChanged && !reason) errors.push("Indique el motivo del cambio de accesos.");
    if (errors.length) return { ok: false, errors: [...new Set(errors)] };

    stateApi.state.db.visualUsers = nextRows;
    if (candidate.id === currentUserId) {
      stateApi.state.db.session.activeUser = toSessionUser(candidate);
    }
    stateApi.saveDb();
    addAuditLog({
      module: "CONFIGURACION",
      action: index >= 0 ? "EDITAR_USUARIO_ACCESOS" : "CREAR_USUARIO_ACCESOS",
      entityType: "visual_user",
      entityId: candidate.id,
      entityLabel: candidate.code,
      documentLabel: candidate.fullName || candidate.name,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el usuario ${candidate.fullName || candidate.name} y su matriz de acceso por empresa.`,
      reason,
      before,
      after: candidate,
      result: "exitoso"
    });
    stateApi.refreshNavigationAccess?.();
    return { ok: true, user: clone(candidate) };
  }

  function userUsage(userId) {
    ensureStore();
    const auditCount = (stateApi.state.db.auditLogs || []).filter(item => item.userId === userId).length;
    return {
      activeSession: stateApi.state.db.session?.activeUser?.id === userId,
      auditCount,
      used: auditCount > 0
    };
  }

  function removeUser(userId, options = {}) {
    if (isOperationalDeployment()) return { ok: false, errors: ["La eliminación requiere confirmación de Supabase."] };
    ensureStore();
    const rows = visualUsers();
    const index = rows.findIndex(item => item.id === userId);
    if (index < 0) return { ok: false, errors: ["Usuario no encontrado."] };
    const current = rows[index];
    const usage = userUsage(userId);
    const reason = String(options.reason || "").trim();
    const errors = [];
    if (usage.activeSession) errors.push("No se puede eliminar el usuario que mantiene abierta la sesion local.");
    if (current.status !== "inactivo") errors.push("Primero cambie el usuario a inactivo antes de eliminarlo.");
    if (usage.used) errors.push(`El usuario tiene ${usage.auditCount} registro(s) de auditoria y debe conservarse inactivo para mantener trazabilidad.`);
    if (!reason) errors.push("Indique el motivo de eliminacion.");
    const nextRows = rows.filter(item => item.id !== userId);
    errors.push(...validateAdministratorContinuity(nextRows));
    if (errors.length) return { ok: false, errors: [...new Set(errors)] };

    stateApi.state.db.visualUsers = nextRows;
    stateApi.saveDb();
    addAuditLog({
      module: "CONFIGURACION",
      action: "ELIMINAR_USUARIO_SIN_USO",
      entityType: "visual_user",
      entityId: current.id,
      entityLabel: current.code,
      documentLabel: current.fullName || current.name,
      previousStatus: current.status,
      nextStatus: "eliminado",
      description: `Se elimino el usuario sin uso ${current.fullName || current.name}.`,
      reason,
      before: current,
      after: null,
      result: "exitoso"
    });
    return { ok: true, user: clone(current) };
  }

  function removeCloudUser(userId, options = {}) {
    if (isOperationalDeployment() && options.confirmed !== true) return { ok: false, errors: ["Supabase no confirmó la eliminación."] };
    ensureStore();
    const rows = visualUsers();
    const current = rows.find(item => item.id === userId);
    if (!current) return { ok: true, user: null };
    const usage = userUsage(userId);
    if (usage.activeSession) {
      return { ok: false, errors: ["No puede eliminar la cuenta que mantiene abierta la sesión actual."] };
    }
    const nextRows = rows.filter(item => item.id !== userId);
    const continuityErrors = validateAdministratorContinuity(nextRows);
    if (continuityErrors.length) return { ok: false, errors: continuityErrors };

    stateApi.state.db.visualUsers = nextRows;
    if (isOperationalDeployment()) {
      BlessERP.storage?.save?.(stateApi.state.db, { replaceAll: true });
      return { ok: true, user: clone(current), confirmed: true };
    }
    stateApi.saveDb();
    addAuditLog({
      module: "CONFIGURACION",
      action: "ELIMINAR_USUARIO_SUPABASE",
      entityType: "visual_user",
      entityId: current.id,
      entityLabel: current.code,
      documentLabel: current.fullName || current.name,
      previousStatus: current.status,
      nextStatus: "eliminado",
      description: `Se eliminó la cuenta ${current.fullName || current.name} de Supabase Auth y del directorio ERP.`,
      reason: String(options.reason || "Eliminación solicitada por un propietario").trim(),
      before: current,
      after: null,
      result: "exitoso"
    });
    return { ok: true, user: clone(current) };
  }

  function accessPreview(userOrId, companyId) {
    const user = typeof userOrId === "string" ? findUser(userOrId) : normalizeUser(userOrId || {});
    if (!user) return { ok: false, message: "Usuario no encontrado.", routes: [] };
    const context = BlessERP.menuService?.getUserAccessContext?.(user, companyId);
    const routes = BlessERP.menuService?.getVisiblePagesForUser?.(user, companyId) || [];
    return {
      ok: true,
      user: clone(user),
      companyId,
      context: clone(context),
      routes: routes.map(item => ({
        id: item.ruta,
        label: item.nombre,
        groupId: item.metadata?.groupId || "",
        menuId: item.metadata?.menuId || ""
      }))
    };
  }

  function setActiveUser(userId) {
    if (isOperationalDeployment()) return { ok: false, message: "Cambie de usuario mediante una sesión autenticada." };
    ensureStore();
    const user = visualUsers().find(item => item.id === userId);
    if (!user) return { ok: false, message: "Usuario no encontrado." };
    if (user.status !== "activo") return { ok: false, message: "Solo se pueden activar usuarios visuales activos." };
    const membership = BlessERP.menuService?.getUserAccessContext?.(user, activeCompanyId());
    if (!membership?.active) return { ok: false, message: "El usuario no tiene membresia activa en la empresa de esta pestaña." };
    stateApi.state.db.session.activeUser = toSessionUser(user);
    stateApi.saveDb();
    addAuditLog({
      module: "CONFIGURACION",
      action: "CAMBIAR_USUARIO_ACTIVO",
      entityType: "visual_user",
      entityId: user.id,
      entityLabel: user.name,
      documentLabel: user.code || user.name,
      description: `Usuario activo temporal cambiado a ${user.name}.`,
      result: "exitoso"
    });
    return { ok: true, user: clone(user) };
  }

  function detectSequenceUsage(code, configuredSequence = null, options = {}) {
    if (options.readOnly !== true) ensureStore();
    const db = stateApi.state.db;
    switch (code) {
      case "ASI":
        return Math.max(0, ...(db.journalEntries || []).map(item => Number(String(item.entryNumber || "").split("-").pop() || 0)));
      case "COM":
        return (db.purchases || []).length;
      case "RETE":
        return Math.max(0, ...(db.issuedWithholdings || []).map(item => {
          const full = /^(\d{3})-(\d{3})-(\d{9})$/.exec(String(item.fullNumber || "").trim());
          if (!full) return 0;
          if (configuredSequence && (full[1] !== configuredSequence.establishmentCode || full[2] !== configuredSequence.emissionPointCode)) return 0;
          return Number(full[3]) || 0;
        }));
      case "FAC_EXPORT":
      case "FAC_LOCAL":
        return Math.max(0, ...(db.commercial?.orders || []).map(item => {
          const full = /^(\d{3})-(\d{3})-(\d{9})$/.exec(String(item.sriInvoiceNumber || "").trim());
          if (!full) return 0;
          if (configuredSequence && (full[1] !== configuredSequence.establishmentCode || full[2] !== configuredSequence.emissionPointCode)) return 0;
          return Number(full[3]) || 0;
        }));
      case "NC_EXPORT":
      case "NC_LOCAL":
        return Math.max(0, ...(db.commercial?.orders || []).flatMap(item => (
          Array.isArray(item.sriCreditNotes) ? item.sriCreditNotes : []
        )).map(item => {
          const full = /^(\d{3})-(\d{3})-(\d{9})$/.exec(String(
            item.documentNumber || item.fullNumber || item.number || ""
          ).trim());
          if (!full) return 0;
          if (configuredSequence && (full[1] !== configuredSequence.establishmentCode || full[2] !== configuredSequence.emissionPointCode)) return 0;
          return Number(full[3]) || 0;
        }));
      case "RETR":
        return (db.receivedWithholdings || []).length;
      case "PAGO":
        return Math.max((db.payments || []).length, (db.paymentBatches || []).length);
      case "COBRO":
        return Math.max((db.collections || []).length, (db.collectionBatches || []).length);
      case "BAN":
        return Math.max(0, ...(db.bankMovements || []).map(item => Number(String(item.movementNumber || "").split("-").pop() || 0)));
      case "CONC":
        return Math.max(0, ...(db.bankReconciliations || []).map(item => Number(String(item.reconciliationNumber || "").split("-").pop() || 0)), (db.bankReconciliations || []).length);
      case "INV":
        return Math.max(0, ...(db.inventoryMovements || []).map(item => Number(String(item.movementNumber || "").split("-").pop() || 0)));
      case "CONS":
        return (db.inventoryMovements || []).filter(item => item.movementType === "SALIDA_CONSUMO").length;
      case "AJU":
        return (db.inventoryMovements || []).filter(item => String(item.movementType || "").startsWith("AJUSTE_")).length;
      case "ATS":
        return (db.atsHistory || []).length;
      default:
        return 0;
    }
  }

  function syncSequenceCounters() {
    ensureStore();
    const rows = (stateApi.state.db.documentSequences || []).map(normalizeSequence);
    let changed = false;
    rows.forEach(item => {
       const used = detectSequenceUsage(item.code, item);
      if (used > Number(item.currentNumber || 0)) {
        item.currentNumber = used;
        changed = true;
      }
    });
    if (changed) {
      stateApi.state.db.documentSequences = rows;
      stateApi.saveDb();
    }
    return rows;
  }

  function formatSequencePreview(sequence, nextNumber = null) {
    const item = normalizeSequence(sequence);
    const number = nextNumber == null ? Number(item.currentNumber || 0) + 1 : Number(nextNumber || 0);
    if (item.documentType) {
      return `${item.establishmentCode}-${item.emissionPointCode}-${String(number).padStart(9, "0")}`;
    }
    const parts = [item.prefix];
    if (item.year) parts.push(item.year);
    if (item.reset === "mensual" && item.month) parts.push(item.month.padStart(2, "0"));
    parts.push(String(number).padStart(item.length, "0"));
    return parts.filter(Boolean).join("-");
  }

  function sequences(filters = {}) {
    const search = String(filters.search || "").trim().toLowerCase();
    return syncSequenceCounters()
      .filter(item => {
        if (filters.status && item.status !== filters.status) return false;
        if (filters.module && item.module !== filters.module) return false;
        if (!search) return true;
        const haystack = [item.code, item.name, item.prefix, item.module, item.observation].join(" ").toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => a.code.localeCompare(b.code, "es"));
  }

  function findSequenceByCode(code) {
    return sequences().find(item => item.code === String(code || "").trim().toUpperCase()) || null;
  }

  async function saveNonSriSequence(sequence) {
    const candidate = normalizeSequence(sequence);
    const rows = clone(stateApi.state.db.documentSequences || []).map(normalizeSequence);
    const errors = [];
    if (!sequenceAllowed(candidate.code)) errors.push('Secuencial no habilitado para esta empresa.');
    if (!candidate.code || !candidate.name) errors.push('El código y nombre del secuencial son obligatorios.');
    if (!Number.isSafeInteger(candidate.currentNumber) || candidate.currentNumber < 0 || candidate.currentNumber > 999999999) errors.push('El último número debe ser un entero entre 0 y 999999999.');
    if (rows.some(item => item.id !== candidate.id && item.code === candidate.code)) errors.push('No se permite código de secuencial duplicado.');
    if (rows.some(item => item.id !== candidate.id && !item.documentType && item.prefix === candidate.prefix && item.year === candidate.year && item.module === candidate.module)) errors.push('Ese prefijo ya está usado en el mismo módulo y año.');
    if (candidate.currentNumber < detectSequenceUsage(candidate.code, candidate, { readOnly: true })) errors.push('No se puede retroceder el número ya utilizado.');
    if (errors.length) return { ok: false, errors };
    const ack = await BlessERP.services.confirmedOperationalWrite.commit('accounting_document_sequences', candidate);
    return { ...ack, sequence: clone(ack.serverRecord?.payload || candidate) };
  }

  async function saveSequence(sequence) {
    if (!sequence?.documentType && !SRI_SEQUENCE_CODES[sequence?.code]) return saveNonSriSequence(sequence);
    ensureStore();
    const candidate = normalizeSequence(sequence);
    const rawEstablishmentCode = String(sequence?.establishmentCode || "").trim();
    const rawEmissionPointCode = String(sequence?.emissionPointCode || "").trim();
    if (!sequenceAllowed(candidate.code)) {
      return {
        ok: false,
        errors: [`El secuencial ${candidate.code || "indicado"} no está habilitado para la empresa activa.`]
      };
    }
    if (candidate.documentType) {
      Object.assign(candidate, {
        name: SRI_SEQUENCE_CODES[candidate.code].name,
        prefix: "",
        year: "",
        month: "",
        length: 9,
        reset: "nunca",
        module: SRI_SEQUENCE_CODES[candidate.code].module,
        status: "activo"
      });
    }
    const rows = syncSequenceCounters();
    const errors = [];
    if (!candidate.code) errors.push("El codigo del secuencial es obligatorio.");
    if (!candidate.name) errors.push("El nombre del secuencial es obligatorio.");
    if (!Number.isSafeInteger(candidate.currentNumber) || candidate.currentNumber < 0 || candidate.currentNumber > 999999999) {
      errors.push("El ultimo secuencial emitido debe ser un entero entre 0 y 999999999.");
    }
    if (candidate.documentType && !/^\d{3}$/.test(rawEstablishmentCode)) {
      errors.push("El establecimiento SRI debe contener exactamente 3 digitos.");
    }
    if (candidate.documentType && !/^\d{3}$/.test(rawEmissionPointCode)) {
      errors.push("El punto de emision SRI debe contener exactamente 3 digitos.");
    }
    const blessCompany = activeCompanyId() === "COMP-BLESS-FLOWER";
    const fixedBlessSeries = blessCompany && ["FAC_LOCAL", "FAC_EXPORT"].includes(candidate.code)
      ? {
          establishmentCode: "001",
          emissionPointCode: candidate.code === "FAC_EXPORT" ? "002" : "003"
        }
      : null;
    if (fixedBlessSeries && (
      candidate.establishmentCode !== fixedBlessSeries.establishmentCode
      || candidate.emissionPointCode !== fixedBlessSeries.emissionPointCode
    )) {
      errors.push(`Bless Flower usa obligatoriamente ${fixedBlessSeries.establishmentCode}-${fixedBlessSeries.emissionPointCode} para ${candidate.code === "FAC_EXPORT" ? "exportaciones" : "ventas locales"}.`);
    }
    const duplicateCode = rows.find(item => item.id !== candidate.id && item.code === candidate.code);
    if (duplicateCode) errors.push("No se permite codigo de secuencial duplicado.");
    const duplicatePrefix = !candidate.documentType && rows.find(item =>
      item.id !== candidate.id
      && !item.documentType
      && item.prefix === candidate.prefix
      && item.year === candidate.year
      && item.module === candidate.module
    );
    if (duplicatePrefix) errors.push("Ese prefijo ya esta usado en el mismo modulo y ano.");
    const usedFloor = detectSequenceUsage(candidate.code, candidate);
    if (Number(candidate.currentNumber || 0) < usedFloor) {
      errors.push(`No se puede retroceder el numero actual porque ya existen documentos hasta ${usedFloor}.`);
    }
    if (errors.length) return { ok: false, errors };
    if (candidate.documentType) candidate.configurationStatus = "CONFIRMADA";
    const index = rows.findIndex(item => item.id === candidate.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    if (!candidate.documentType) {
      const ack = await BlessERP.services.confirmedOperationalWrite.commit('accounting_document_sequences', candidate);
      return { ...ack, sequence: clone(ack.serverRecord?.payload || candidate) };
    }
    stateApi.state.db.documentSequences = rows;
    stateApi.saveDb();
    if (candidate.documentType && BlessERP.services?.companySettings?.save) {
      const settings = BlessERP.services.companySettings.settings() || {};
      const seriesFields = candidate.code === "RETE"
        ? {
            retentionEstablishmentCode: candidate.establishmentCode,
            retentionEmissionPointCode: candidate.emissionPointCode
          }
        : candidate.code === "FAC_LOCAL"
          ? {
              localEstablishmentCode: candidate.establishmentCode,
              localEmissionPointCode: candidate.emissionPointCode
            }
          : candidate.code === "FAC_EXPORT"
            ? {
                exportEstablishmentCode: candidate.establishmentCode,
                exportEmissionPointCode: candidate.emissionPointCode
              }
            : {
             mainEstablishment: candidate.establishmentCode,
             mainEmissionPoint: candidate.emissionPointCode
            };
      BlessERP.services.companySettings.save({ ...settings, ...seriesFields });
    }
    addAuditLog({
      module: "CONFIGURACION",
      action: index >= 0 ? "EDITAR_SECUENCIAL" : "CREAR_SECUENCIAL",
      entityType: "sequence",
      entityId: candidate.id,
      entityLabel: candidate.code,
      documentLabel: candidate.name,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el secuencial ${candidate.code}.`,
      before,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, sequence: clone(candidate) };
  }

  function costCenters(filters = {}) {
    ensureStore();
    const search = String(filters.search || "").trim().toLowerCase();
    return (stateApi.state.db.costCenters || [])
      .map(normalizeCostCenter)
      .filter(item => {
        if (filters.status && item.status !== filters.status) return false;
        if (filters.type && item.type !== filters.type) return false;
        if (!search) return true;
        const haystack = [item.code, item.name, item.type, item.responsible, item.relatedAccount, item.observation].join(" ").toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => a.code.localeCompare(b.code, "es"));
  }

  async function saveCostCenter(costCenter) {

    const candidate = normalizeCostCenter(costCenter);
    const rows = clone(stateApi.state.db.costCenters || []).map(normalizeCostCenter);
    const errors = [];
    if (!candidate.code) errors.push("El codigo del centro de costo es obligatorio.");
    if (!candidate.name) errors.push("El nombre del centro de costo es obligatorio.");
    const duplicate = rows.find(item => item.id !== candidate.id && item.code === candidate.code);
    if (duplicate) errors.push("No se permite codigo duplicado de centro de costo.");
    if (errors.length) return { ok: false, errors };
    const index = rows.findIndex(item => item.id === candidate.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    const ack = await BlessERP.services.confirmedOperationalWrite.commit('accounting_cost_centers', candidate, {});
    return { ...ack, costCenter: clone(ack.serverRecord?.payload || candidate) };
  }

  async function toggleCostCenterStatus(costCenterId) {

    const rows = clone(stateApi.state.db.costCenters || []).map(normalizeCostCenter);
    const index = rows.findIndex(item => item.id === costCenterId);
    if (index < 0) return { ok: false, message: "Centro de costo no encontrado." };
    const before = clone(rows[index]);
    rows[index].status = rows[index].status === "activo" ? "inactivo" : "activo";
    const ack = await BlessERP.services.confirmedOperationalWrite.commit('accounting_cost_centers', rows[index], {});
    return { ...ack, costCenter: clone(ack.serverRecord?.payload || rows[index]) };
  }

  function normalizeAuditLog(log = {}) {
    const user = activeUser();
    return {
      id: String(log.id || uid("AUD")).trim(),
      createdAt: String(log.createdAt || nowIso()).trim(),
      userId: String(log.userId || user.id || "").trim(),
      userName: String(log.userName || user.name || "").trim(),
      userEmail: String(log.userEmail || user.email || "").trim(),
      userRole: String(log.userRole || user.role || user.cargo || "").trim(),
      userArea: String(log.userArea || user.area || "").trim(),
      module: String(log.module || "").trim().toUpperCase(),
      action: String(log.action || "").trim().toUpperCase(),
      entityType: String(log.entityType || "").trim(),
      entityId: String(log.entityId || "").trim(),
      entityLabel: String(log.entityLabel || "").trim(),
      documentLabel: String(log.documentLabel || log.entityLabel || "").trim(),
      previousStatus: String(log.previousStatus || "").trim(),
      nextStatus: String(log.nextStatus || "").trim(),
      description: String(log.description || "").trim(),
      reason: String(log.reason || "").trim(),
      result: auditResults.includes(String(log.result || "").toLowerCase()) ? String(log.result || "").toLowerCase() : "exitoso",
      ipDevice: String(log.ipDevice || "local / navegador").trim(),
      before: sanitizePayload(log.before),
      after: sanitizePayload(log.after)
    };
  }

  function addAuditLog(payload = {}) {
    try {
      ensureStore();
      const rows = (stateApi.state.db.auditLogs || []).map(normalizeAuditLog);
      const normalized = normalizeAuditLog(payload);
      rows.unshift(normalized);
      stateApi.state.db.auditLogs = rows;
      stateApi.saveDb();
      return { ok: true, audit: clone(normalized) };
    } catch (error) {
      console.warn("No se pudo registrar auditoria", error);
      return { ok: false, message: error?.message || "No se pudo registrar auditoria." };
    }
  }

  function logFailure(payload = {}, result = "bloqueado") {
    return addAuditLog({ ...payload, result });
  }

  function auditLogs(filters = {}) {
    ensureStore();
    const search = String(filters.search || "").trim().toLowerCase();
    return (stateApi.state.db.auditLogs || [])
      .map(normalizeAuditLog)
      .filter(item => {
        if (filters.userId && item.userId !== filters.userId) return false;
        if (filters.module && item.module !== String(filters.module || "").trim().toUpperCase()) return false;
        if (filters.action && item.action !== String(filters.action || "").trim().toUpperCase()) return false;
        if (filters.result && item.result !== String(filters.result || "").trim().toLowerCase()) return false;
        if (filters.dateFrom && item.createdAt.slice(0, 10) < filters.dateFrom) return false;
        if (filters.dateTo && item.createdAt.slice(0, 10) > filters.dateTo) return false;
        if (!search) return true;
        const haystack = [
          item.userName,
          item.module,
          item.action,
          item.documentLabel,
          item.entityLabel,
          item.description,
          item.reason
        ].join(" ").toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt, "es"));
  }

  function auditSummary() {
    const rows = auditLogs();
    return {
      total: rows.length,
      today: rows.filter(item => item.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
      success: rows.filter(item => item.result === "exitoso").length,
      blocked: rows.filter(item => item.result === "bloqueado").length,
      errors: rows.filter(item => item.result === "error").length
    };
  }

  BlessERP.services = BlessERP.services || {};
  BlessERP.services.adminConfig = {
    userStates,
    roleOptions,
    sequenceResets,
    sequenceStates,
    costCenterStates,
    costCenterTypes,
    auditResults,
    sequenceAllowed,
    ensureStore,
    activeUser,
    accessPreview,
    companyProfiles,
    createUserDraft,
    findUser,
    normalizeUser,
    removeCloudUser,
    removeUser,
    saveUser,
    userUsage,
    visualUsers,
    replaceCloudDirectory,
    setActiveUser,
    sequences,
    findSequenceByCode,
    saveSequence,
    formatSequencePreview,
    costCenters,
    saveCostCenter,
    toggleCostCenterStatus,
    auditLogs,
    auditSummary,
    addAuditLog,
    logFailure
  };
})();
