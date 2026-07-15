(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const stateApi = BlessERP.state;
  const { clone, uid } = BlessERP.utils;

  const userStates = ["activo", "inactivo"];
  const sequenceResets = ["nunca", "anual", "mensual"];
  const sequenceStates = ["activo", "inactivo"];
  const costCenterStates = ["activo", "inactivo"];
  const costCenterTypes = ["administrativo", "operativo", "produccion", "empaque", "ventas", "logistica", "otro"];
  const auditResults = ["exitoso", "bloqueado", "error"];

  function nowIso() {
    return new Date().toISOString();
  }

  function defaultUsers() {
    return [
      {
        id: "USR-ADMIN-001",
        code: "USR-001",
        name: "James Lanchimba",
        fullName: "James Santiago Lanchimba Tipanluisa",
        email: "",
        role: "Administrador / Contador",
        cargo: "Administrador / Contador",
        area: "Administracion / Contabilidad",
        status: "activo",
        observation: "Usuario visual principal para pruebas de auditoria."
      },
      {
        id: "USR-SUP-002",
        code: "USR-002",
        name: "Eder Lenin Quishpe",
        fullName: "Eder Lenin Quishpe",
        email: "",
        role: "Co-creador / Soporte",
        cargo: "Co-creador / Soporte",
        area: "Tecnologia / Soporte",
        status: "activo",
        observation: "Usuario visual de soporte funcional."
      },
      {
        id: "USR-ACC-003",
        code: "USR-003",
        name: "Usuario Contable",
        fullName: "Usuario Contable",
        email: "",
        role: "Asistente contable",
        cargo: "Asistente contable",
        area: "Contabilidad",
        status: "activo",
        observation: "Perfil visual para pruebas de registros contables."
      },
      {
        id: "USR-WHS-004",
        code: "USR-004",
        name: "Usuario Bodega",
        fullName: "Usuario Bodega",
        email: "",
        role: "Responsable bodega",
        cargo: "Responsable bodega",
        area: "Bodega",
        status: "activo",
        observation: "Perfil visual para inventario y movimientos de bodega."
      }
    ];
  }

  function defaultSequences() {
    return [
      { id: "SEQ-ASI", code: "ASI", name: "Asientos contables", prefix: "ASI", year: "2026", month: "", currentNumber: 25, length: 6, reset: "anual", module: "Contabilidad", status: "activo", observation: "Secuencial interno del libro diario." },
      { id: "SEQ-COM", code: "COM", name: "Compras", prefix: "COM", year: "2026", month: "", currentNumber: 3, length: 6, reset: "anual", module: "Compras", status: "activo", observation: "Control interno para documentos de compra." },
      { id: "SEQ-RETE", code: "RETE", name: "Retenciones emitidas", prefix: "RETE", year: "2026", month: "", currentNumber: 1, length: 6, reset: "anual", module: "Compras", status: "activo", observation: "Borradores y confirmaciones de retenciones emitidas." },
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

  function defaultCostCenters() {
    return [
      { id: "CC-ADMINISTRACION", code: "ADMINISTRACION", name: "Administracion", type: "administrativo", responsible: "James Lanchimba", status: "activo", relatedAccount: "6.1", observation: "Centro administrativo general." },
      { id: "CC-CAMPO", code: "CAMPO", name: "Campo", type: "produccion", responsible: "Responsable de campo", status: "activo", relatedAccount: "5.1", observation: "Base operativa de campo." },
      { id: "CC-POSCOSECHA", code: "POSCOSECHA", name: "Poscosecha", type: "produccion", responsible: "Responsable poscosecha", status: "activo", relatedAccount: "5.1", observation: "Preparado para integracion futura con Parte 1." },
      { id: "CC-EMPAQUE", code: "EMPAQUE", name: "Empaque", type: "empaque", responsible: "Responsable de empaque", status: "activo", relatedAccount: "5.2", observation: "Consumos y costos de materiales de empaque." },
      { id: "CC-BODEGA", code: "BODEGA", name: "Bodega", type: "operativo", responsible: "Usuario Bodega", status: "activo", relatedAccount: "1.1.03.02", observation: "Control operativo de suministros y materiales." },
      { id: "CC-VENTAS", code: "VENTAS", name: "Ventas", type: "ventas", responsible: "Equipo comercial", status: "activo", relatedAccount: "4.1", observation: "Reservado para la fase comercial futura." },
      { id: "CC-LOGISTICA", code: "LOGISTICA", name: "Logistica", type: "logistica", responsible: "Coordinacion logistica", status: "activo", relatedAccount: "6.1", observation: "Apoyo a operaciones de despacho y transporte." },
      { id: "CC-MANTENIMIENTO", code: "MANTENIMIENTO", name: "Mantenimiento", type: "operativo", responsible: "Responsable de mantenimiento", status: "activo", relatedAccount: "6.2", observation: "Consumos y gastos por mantenimiento." },
      { id: "CC-GERENCIA", code: "GERENCIA", name: "Gerencia", type: "administrativo", responsible: "Gerencia general", status: "activo", relatedAccount: "6.1", observation: "Centro de decisiones y direccion." }
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
    if (!Array.isArray(db.visualUsers) || !db.visualUsers.length) db.visualUsers = defaultUsers();
    if (!Array.isArray(db.documentSequences) || !db.documentSequences.length) db.documentSequences = defaultSequences();
    if (!Array.isArray(db.costCenters) || !db.costCenters.length) db.costCenters = defaultCostCenters();
    if (!Array.isArray(db.auditLogs)) db.auditLogs = defaultAuditLogs();
    if (!db.session) db.session = {};
    if (!db.session.activeUser) {
      const user = normalizeUser(db.visualUsers[0]);
      db.session.activeUser = toSessionUser(user);
    }
  }

  function normalizeUser(user = {}) {
    const current = { ...clone(user || {}) };
    return {
      id: String(current.id || uid("USR")).trim(),
      code: String(current.code || "").trim(),
      name: String(current.name || current.fullName || "").trim(),
      fullName: String(current.fullName || current.name || "").trim(),
      email: String(current.email || "").trim(),
      role: String(current.role || current.cargo || "").trim(),
      cargo: String(current.cargo || current.role || "").trim(),
      area: String(current.area || "").trim(),
      status: userStates.includes(String(current.status || "").toLowerCase()) ? String(current.status || "").toLowerCase() : "activo",
      observation: String(current.observation || "").trim()
    };
  }

  function toSessionUser(user) {
    return {
      id: user.id,
      name: user.name || user.fullName,
      email: user.email || "",
      role: user.role || user.cargo || "",
      cargo: user.cargo || user.role || "",
      area: user.area || ""
    };
  }

  function normalizeSequence(sequence = {}) {
    const current = { ...clone(sequence || {}) };
    return {
      id: String(current.id || uid("SEQ")).trim(),
      code: String(current.code || "").trim().toUpperCase(),
      name: String(current.name || "").trim(),
      prefix: String(current.prefix || current.code || "").trim().toUpperCase(),
      year: String(current.year || new Date().getFullYear()).trim(),
      month: String(current.month || "").trim(),
      currentNumber: Math.max(0, Number(current.currentNumber || 0)),
      length: Math.max(3, Number(current.length || 6)),
      reset: sequenceResets.includes(String(current.reset || "").toLowerCase()) ? String(current.reset || "").toLowerCase() : "anual",
      module: String(current.module || "").trim(),
      status: sequenceStates.includes(String(current.status || "").toLowerCase()) ? String(current.status || "").toLowerCase() : "activo",
      observation: String(current.observation || "").trim()
    };
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
        if (lowered.includes("password") || lowered.includes("secret") || lowered.includes("token")) return;
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
      id: sessionUser.id || "USR-DEMO",
      name: sessionUser.name || "Usuario demo",
      fullName: sessionUser.name || "Usuario demo",
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

  function setActiveUser(userId) {
    ensureStore();
    const user = visualUsers().find(item => item.id === userId);
    if (!user) return { ok: false, message: "Usuario no encontrado." };
    if (user.status !== "activo") return { ok: false, message: "Solo se pueden activar usuarios visuales activos." };
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

  function detectSequenceUsage(code) {
    ensureStore();
    const db = stateApi.state.db;
    switch (code) {
      case "ASI":
        return Math.max(0, ...(db.journalEntries || []).map(item => Number(String(item.entryNumber || "").split("-").pop() || 0)));
      case "COM":
        return (db.purchases || []).length;
      case "RETE":
        return Math.max(0, ...(db.issuedWithholdings || []).map(item => Number(String(item.draftNumber || "").replace(/\D/g, "") || 0)));
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
      const used = detectSequenceUsage(item.code);
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

  function saveSequence(sequence) {
    ensureStore();
    const candidate = normalizeSequence(sequence);
    const rows = syncSequenceCounters();
    const errors = [];
    if (!candidate.code) errors.push("El codigo del secuencial es obligatorio.");
    if (!candidate.name) errors.push("El nombre del secuencial es obligatorio.");
    const duplicateCode = rows.find(item => item.id !== candidate.id && item.code === candidate.code);
    if (duplicateCode) errors.push("No se permite codigo de secuencial duplicado.");
    const duplicatePrefix = rows.find(item =>
      item.id !== candidate.id
      && item.prefix === candidate.prefix
      && item.year === candidate.year
      && item.module === candidate.module
    );
    if (duplicatePrefix) errors.push("Ese prefijo ya esta usado en el mismo modulo y ano.");
    const usedFloor = detectSequenceUsage(candidate.code);
    if (Number(candidate.currentNumber || 0) < usedFloor) {
      errors.push(`No se puede retroceder el numero actual porque ya existen documentos hasta ${usedFloor}.`);
    }
    if (errors.length) return { ok: false, errors };
    const index = rows.findIndex(item => item.id === candidate.id);
    const before = index >= 0 ? clone(rows[index]) : null;
    if (index >= 0) rows[index] = candidate;
    else rows.unshift(candidate);
    stateApi.state.db.documentSequences = rows;
    stateApi.saveDb();
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

  function saveCostCenter(costCenter) {
    ensureStore();
    const candidate = normalizeCostCenter(costCenter);
    const rows = costCenters();
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
    stateApi.state.db.costCenters = rows;
    stateApi.saveDb();
    addAuditLog({
      module: "CONFIGURACION",
      action: index >= 0 ? "EDITAR_CENTRO_COSTO" : "CREAR_CENTRO_COSTO",
      entityType: "cost_center",
      entityId: candidate.id,
      entityLabel: candidate.code,
      documentLabel: candidate.name,
      previousStatus: before?.status || "",
      nextStatus: candidate.status,
      description: `${index >= 0 ? "Se actualizo" : "Se creo"} el centro de costo ${candidate.code}.`,
      before,
      after: candidate,
      result: "exitoso"
    });
    return { ok: true, costCenter: clone(candidate) };
  }

  function toggleCostCenterStatus(costCenterId) {
    ensureStore();
    const rows = costCenters();
    const index = rows.findIndex(item => item.id === costCenterId);
    if (index < 0) return { ok: false, message: "Centro de costo no encontrado." };
    const before = clone(rows[index]);
    rows[index].status = rows[index].status === "activo" ? "inactivo" : "activo";
    stateApi.state.db.costCenters = rows;
    stateApi.saveDb();
    addAuditLog({
      module: "CONFIGURACION",
      action: "CAMBIAR_ESTADO_CENTRO_COSTO",
      entityType: "cost_center",
      entityId: rows[index].id,
      entityLabel: rows[index].code,
      documentLabel: rows[index].name,
      previousStatus: before.status,
      nextStatus: rows[index].status,
      description: `Centro de costo ${rows[index].code} cambiado a estado ${rows[index].status}.`,
      before,
      after: rows[index],
      result: "exitoso"
    });
    return { ok: true, costCenter: clone(rows[index]) };
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
    sequenceResets,
    sequenceStates,
    costCenterStates,
    costCenterTypes,
    auditResults,
    ensureStore,
    activeUser,
    visualUsers,
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
