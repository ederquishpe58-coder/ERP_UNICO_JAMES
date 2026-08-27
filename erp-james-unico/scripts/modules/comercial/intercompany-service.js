(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const BLESS_COMPANY_ID = BlessERP.companyCapabilities?.COMPANY_IDS?.BLESS || "COMP-BLESS-FLOWER";
  const IMPERIO_COMPANY_ID = BlessERP.companyCapabilities?.COMPANY_IDS?.IMPERIO || "COMP-IMPERIO-FLOWERS";
  const INTERCOMPANY_BILLING_ENABLED = false;
  const ACTIVE_ORDER_STATUSES = new Set(["VALIDADO_COMERCIAL", "LISTO_BODEGA", "LISTO_DESPACHO"]);
  const DISPATCHED_ORDER_STATUSES = new Set(["DESPACHADO_DEMO", "DESPACHADO", "CERRADO_DEMO", "CERRADO"]);
  const RELEASED_ORDER_STATUSES = new Set(["BORRADOR", "REFERENCIAL", "REABIERTO_DEMO"]);

  function clone(value) {
    if (BlessERP.utils?.clone) return BlessERP.utils.clone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix) {
    if (BlessERP.utils?.uid) return BlessERP.utils.uid(prefix);
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function normalize(value) {
    return String(value || "").trim().toUpperCase();
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((number(value) + Number.EPSILON) * factor) / factor;
  }

  function today() {
    if (BlessERP.utils?.today) return BlessERP.utils.today();
    return new Date().toISOString().slice(0, 10);
  }

  function now() {
    return new Date().toISOString();
  }

  function resolveState(appState) {
    return appState || BlessERP.state?.state || null;
  }

  function ensureCommercialShape(store = {}) {
    store.orders = Array.isArray(store.orders) ? store.orders : [];
    store.intercompanySettlements = Array.isArray(store.intercompanySettlements) ? store.intercompanySettlements : [];
    store.intercompanyInvoices = Array.isArray(store.intercompanyInvoices) ? store.intercompanyInvoices : [];
    store.intercompanyAudit = Array.isArray(store.intercompanyAudit) ? store.intercompanyAudit : [];
    store.intercompanyInvoiceCounter = Math.max(0, number(store.intercompanyInvoiceCounter));
    return store;
  }

  function currentCompanyId(state) {
    return BlessERP.companyCapabilities?.companyIdOf
      ? BlessERP.companyCapabilities.companyIdOf(state?.db?.activeCompanyId)
      : String(state?.db?.activeCompanyId || BLESS_COMPANY_ID);
  }

  function getCommercialStore(appState, companyId = BLESS_COMPANY_ID) {
    const state = resolveState(appState);
    if (!state) throw new Error("No existe appState para el flujo intercompany.");
    state.db = state.db || {};
    const requestedCompanyId = String(companyId || BLESS_COMPANY_ID);
    if (currentCompanyId(state) === requestedCompanyId) {
      if (!state.db.commercial) {
        state.db.commercial = BlessERP.comercialData?.createCommercialStore
          ? BlessERP.comercialData.createCommercialStore()
          : { orders: [] };
        if (requestedCompanyId === IMPERIO_COMPANY_ID) state.db.commercial.orders = [];
      }
      return ensureCommercialShape(state.db.commercial);
    }
    state.db.companyStores = state.db.companyStores && typeof state.db.companyStores === "object"
      ? state.db.companyStores
      : {};
    state.db.companyStores[requestedCompanyId] = state.db.companyStores[requestedCompanyId] || {};
    if (!state.db.companyStores[requestedCompanyId].commercial) {
      state.db.companyStores[requestedCompanyId].commercial = BlessERP.comercialData?.createCommercialStore
        ? BlessERP.comercialData.createCommercialStore()
        : { orders: [] };
      if (requestedCompanyId === IMPERIO_COMPANY_ID) state.db.companyStores[requestedCompanyId].commercial.orders = [];
    }
    return ensureCommercialShape(state.db.companyStores[requestedCompanyId].commercial);
  }

  function ensureStore(appState) {
    return getCommercialStore(appState, BLESS_COMPANY_ID);
  }

  function getAllOrders(appState) {
    const seen = new Set();
    return [BLESS_COMPANY_ID, IMPERIO_COMPANY_ID]
      .flatMap(companyId => getCommercialStore(appState, companyId).orders)
      .filter(order => {
        const key = String(order.id || order.number || "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        normalizeOrderCompanies(order);
        return true;
      });
  }

  function getAvailabilitySourceState(appState) {
    const state = resolveState(appState);
    if (!state || currentCompanyId(state) === BLESS_COMPANY_ID) return state;
    const blessOperations = state.db?.companyStores?.[BLESS_COMPANY_ID]?.operations;
    if (!blessOperations) return state;
    return {
      ...state,
      db: {
        ...state.db,
        activeCompanyId: BLESS_COMPANY_ID,
        operations: blessOperations
      }
    };
  }

  function save() {
    BlessERP.state?.saveDb?.();
  }

  function activeUser(appState) {
    const state = resolveState(appState);
    return state?.db?.session?.activeUser?.name || "Usuario comercial";
  }

  function companyName(companyId) {
    return String(companyId) === IMPERIO_COMPANY_ID ? "Imperio Flowers" : "Bless Flower";
  }

  function companyRootStore(appState, companyId) {
    const state = resolveState(appState);
    if (!state?.db) return {};
    if (currentCompanyId(state) === companyId) return state.db;
    return state.db.companyStores?.[companyId] || {};
  }

  function companyIdentity(appState, companyId) {
    const resolved = BlessERP.services?.companyBranding?.resolve?.(companyId);
    if (resolved) return resolved;
    const settings = companyRootStore(appState, companyId).companySettings || {};
    const profile = BlessERP.companyCapabilities?.getCompany?.(companyId)
      || BlessERP.companyCapabilities?.COMPANY_PROFILES?.[companyId]
      || {};
    return {
      ...profile,
      ...settings,
      companyId,
      commercialName: settings.commercialName || profile.commercialName || companyName(companyId),
      legalName: settings.legalName || profile.legalName || companyName(companyId),
      ruc: settings.ruc || profile.ruc || "",
      address: settings.matrixAddress || settings.branchAddress || profile.address || ""
    };
  }

  function zeroVat(base) {
    return {
      code: "2",
      percentageCode: "0",
      rate: 0,
      taxableBase: round(base, 2),
      value: 0
    };
  }

  function buildSriDraftPayload(appState, invoiceOrId) {
    const invoice = typeof invoiceOrId === "object"
      ? invoiceOrId
      : getCommercialStore(appState, BLESS_COMPANY_ID).intercompanyInvoices
        .find(item => String(item.id) === String(invoiceOrId));
    if (!invoice) return { ok: false, errors: ["Factura intercompany no encontrada."], payload: null };
    const buyer = companyIdentity(appState, IMPERIO_COMPANY_ID);
    const errors = [];
    if (!/^\d{13}$/.test(String(buyer.ruc || ""))) errors.push("Configure el RUC de Imperio Flowers.");
    if (!String(buyer.legalName || "").trim()) errors.push("Configure la razón social de Imperio Flowers.");
    if (!String(buyer.address || "").trim()) errors.push("Configure la dirección matriz de Imperio Flowers.");
    const lines = (invoice.lines || []).map((line, index) => {
      const quantity = Math.max(0, number(line.stems));
      const unitPrice = round(line.transferUnitPrice, 4);
      const subtotal = round(line.transferTotal ?? (quantity * unitPrice), 2);
      return {
        sourceLineId: null,
        mainCode: `FLOR-${normalize(line.variety || "MIXTA").replace(/[^A-Z0-9]+/g, "-")}`.slice(0, 25),
        auxiliaryCode: String(line.sourceLineId || "").slice(0, 25),
        description: `FLORES CORTADAS ${line.variety || "MIXTAS"} ${number(line.length)} CM`,
        variety: line.variety || "",
        measure: `${number(line.length)} CM`,
        unit: "TALLO",
        quantity,
        unitPrice,
        discount: 0,
        subtotal,
        taxes: [zeroVat(subtotal)],
        additionalDetails: {
          Pedido: line.orderNumber || "",
          Caja: line.boxNumber || index + 1
        }
      };
    }).filter(line => line.quantity > 0 && line.unitPrice >= 0);
    if (!lines.length) errors.push("La liquidación no contiene tallos escaneados para facturar.");
    const subtotal = round(lines.reduce((sum, line) => sum + line.subtotal, 0), 2);
    const payload = {
      buyer: {
        identificationType: "04",
        identification: String(buyer.ruc || ""),
        legalName: buyer.legalName || buyer.commercialName || "Imperio Flowers",
        address: buyer.address || ""
      },
      invoice: {
        commerceType: "LOCAL",
        totalWithoutTax: subtotal,
        discountTotal: 0,
        grandTotal: subtotal,
        currency: "DOLAR",
        payments: [{ method: "20", total: subtotal, term: 0, unit: "dias" }]
      },
      taxes: [zeroVat(subtotal)],
      lines,
      additionalInformation: {
        Liquidacion: invoice.settlementNumber || "",
        Periodo: `${invoice.dateFrom || ""} a ${invoice.dateTo || ""}`,
        Pedidos: (invoice.orderNumbers || []).join(", "),
        Observacion: "Venta local de flores cortadas entre empresas relacionadas. IVA 0%."
      },
      erpEmission: {
        sourceType: "INTERCOMPANY_SETTLEMENT",
        intercompanyInvoiceId: invoice.id,
        settlementId: invoice.settlementId,
        settlementNumber: invoice.settlementNumber,
        sourceOrderDate: invoice.issueDate
      }
    };
    return { ok: errors.length === 0, errors, payload };
  }

  function buildAccountingPreview(appState, invoice) {
    const blessSettings = companyRootStore(appState, BLESS_COMPANY_ID).companySettings || {};
    const imperioSettings = companyRootStore(appState, IMPERIO_COMPANY_ID).companySettings || {};
    const blessAccounts = blessSettings.defaultAccounts || {};
    const imperioAccounts = imperioSettings.defaultAccounts || {};
    const amount = round(invoice.totals?.transferTotal, 2);
    const accounts = {
      blessReceivable: String(blessAccounts.intercompanyReceivable || "").trim(),
      blessSale: String(blessAccounts.intercompanySales || "").trim(),
      imperioCost: String(imperioAccounts.intercompanyCost || "").trim(),
      imperioPayable: String(imperioAccounts.intercompanyPayable || "").trim()
    };
    const missing = Object.entries(accounts).filter(([, value]) => !value).map(([key]) => key);
    return {
      ready: amount > 0 && missing.length === 0,
      status: amount <= 0 ? "SIN_VALOR" : missing.length ? "PENDIENTE_CONFIGURACION" : "BORRADOR_LISTO",
      missingAccounts: missing,
      amount,
      bless: {
        companyId: BLESS_COMPANY_ID,
        concept: `Venta intercompany ${invoice.settlementNumber}`,
        lines: [
          { accountCode: accounts.blessReceivable, debit: amount, credit: 0 },
          { accountCode: accounts.blessSale, debit: 0, credit: amount }
        ]
      },
      imperio: {
        companyId: IMPERIO_COMPANY_ID,
        concept: `Costo directo intercompany ${invoice.settlementNumber}`,
        lines: [
          { accountCode: accounts.imperioCost, debit: amount, credit: 0 },
          { accountCode: accounts.imperioPayable, debit: 0, credit: amount }
        ]
      }
    };
  }

  function sellingCompanyId(order = {}) {
    return String(
      order.sellingCompanyId
      || order.selling_company_id
      || order.companyId
      || order.company_id
      || BLESS_COMPANY_ID
    );
  }

  function normalizeOrderCompanies(order = {}) {
    const sellerCompanyId = sellingCompanyId(order);
    const sellerCompanyName = companyName(sellerCompanyId);
    const supplyMode = normalize(
      order.inventorySupplyMode
      || order.inventory_supply_mode
      || (sellerCompanyId === IMPERIO_COMPANY_ID ? "BLESS_SHARED" : "BLESS_INVENTORY")
    );
    const externalSupply = supplyMode === "EXTERNAL_FARM";
    order.company_id = sellerCompanyId;
    order.companyId = sellerCompanyId;
    order.selling_company_id = sellerCompanyId;
    order.sellingCompanyId = sellerCompanyId;
    order.selling_company_name = sellerCompanyName;
    order.sellingCompanyName = sellerCompanyName;
    order.inventory_supply_mode = supplyMode;
    order.inventorySupplyMode = supplyMode;
    order.fulfilling_company_id = externalSupply ? sellerCompanyId : BLESS_COMPANY_ID;
    order.fulfillingCompanyId = externalSupply ? sellerCompanyId : BLESS_COMPANY_ID;
    order.fulfilling_company_name = externalSupply ? sellerCompanyName : "Bless Flower";
    order.fulfillingCompanyName = externalSupply ? sellerCompanyName : "Bless Flower";
    order.inventory_owner_company_id = externalSupply ? "" : BLESS_COMPANY_ID;
    order.inventoryOwnerCompanyId = externalSupply ? "" : BLESS_COMPANY_ID;
    order.ownsInventory = !externalSupply && sellerCompanyId === BLESS_COMPANY_ID;
    order.availabilityCommitmentStatus = externalSupply
      ? "NO_APLICA"
      : (order.availabilityCommitmentStatus || "BORRADOR");
    order.intercompanySettlementId = order.intercompanySettlementId || "";
    order.intercompanyInvoiceId = order.intercompanyInvoiceId || "";
    order.intercompanyLiquidatedAt = order.intercompanyLiquidatedAt || "";
    return order;
  }

  function orderSnapshot(order = {}) {
    const lines = Array.isArray(order.lines) ? order.lines : [];
    const boxKeys = new Set(lines.map(line => String(line.boxNumber || "")).filter(Boolean));
    const bunches = lines.reduce((sum, line) => sum + Math.max(0, number(line.bunches)), 0);
    const scannedBunches = lines.reduce((sum, line) => sum + (Array.isArray(line.scannedBunches) ? line.scannedBunches.length : 0), 0);
    const stems = lines.reduce((sum, line) => sum + Math.max(0, number(line.bunches) * number(line.stemsPerBunch)), 0);
    return {
      boxes: boxKeys.size,
      bunches,
      scannedBunches,
      pendingBunches: Math.max(bunches - scannedBunches, 0),
      stems
    };
  }

  function recordAudit(appState, event = {}) {
    const store = ensureStore(appState);
    const row = {
      id: uid("COM-INT-AUD"),
      createdAt: now(),
      createdBy: activeUser(appState),
      ...event
    };
    store.intercompanyAudit.unshift(row);
    return row;
  }

  function syncOrderLifecycle(appState, order, previousStatus = "", nextStatus = "") {
    if (!INTERCOMPANY_BILLING_ENABLED) return order;
    if (!order) return null;
    normalizeOrderCompanies(order);
    const externalSupply = normalize(order.inventorySupplyMode || order.inventory_supply_mode) === "EXTERNAL_FARM";
    const oldCommitmentStatus = normalize(order.availabilityCommitmentStatus || "BORRADOR");
    const requestedOrderStatus = normalize(nextStatus || order.status || "BORRADOR");
    const physicalSnapshot = orderSnapshot(order);
    if (externalSupply) {
      order.status = requestedOrderStatus;
      order.availabilityCommitmentStatus = "NO_APLICA";
      order.availabilityCommitmentSnapshot = physicalSnapshot;
      order.inventoryConsumptionMode = "SIN_INVENTARIO";
      order.inventoryConsumptionApplied = false;
      order.availabilityCommittedAt = "";
      order.availabilityConsumedAt = "";
      order.availabilityReleasedAt = "";
      order.dispatchBlockedAt = "";
      order.dispatchBlockedReason = "";
      return order;
    }
    let orderStatus = requestedOrderStatus;
    let commitmentStatus = oldCommitmentStatus;

    if (
      DISPATCHED_ORDER_STATUSES.has(requestedOrderStatus)
      && (physicalSnapshot.bunches <= 0 || physicalSnapshot.pendingBunches > 0)
    ) {
      const safeStatus = ACTIVE_ORDER_STATUSES.has(normalize(previousStatus))
        ? normalize(previousStatus)
        : "LISTO_DESPACHO";
      orderStatus = safeStatus;
      order.status = safeStatus;
      order.dispatchBlockedAt = now();
      order.dispatchBlockedReason = physicalSnapshot.bunches <= 0
        ? "El pedido no contiene ramos para despachar."
        : `Faltan ${physicalSnapshot.pendingBunches} ramo(s) por escanear antes del despacho.`;
      recordAudit(appState, {
        type: "ORDER_DISPATCH_BLOCKED",
        action: "BLOQUEAR_DESPACHO_INCOMPLETO",
        orderId: order.id || "",
        orderNumber: order.number || "",
        requestedStatus: requestedOrderStatus,
        restoredStatus: safeStatus,
        snapshot: clone(physicalSnapshot),
        note: order.dispatchBlockedReason
      });
    } else if (DISPATCHED_ORDER_STATUSES.has(requestedOrderStatus)) {
      order.dispatchBlockedAt = "";
      order.dispatchBlockedReason = "";
    }

    if (orderStatus === "ANULADO") {
      commitmentStatus = "ANULADO";
      order.availabilityReleasedAt = order.availabilityReleasedAt || now();
      order.inventoryConsumptionApplied = false;
    } else if (DISPATCHED_ORDER_STATUSES.has(orderStatus)) {
      commitmentStatus = "DESPACHADO";
      order.availabilityConsumedAt = order.availabilityConsumedAt || now();
      order.inventoryConsumptionMode = "ESCANEO_BODEGA";
      order.inventoryConsumptionApplied = true;
    } else if (ACTIVE_ORDER_STATUSES.has(orderStatus)) {
      commitmentStatus = "EN_PEDIDO";
      order.availabilityCommittedAt = order.availabilityCommittedAt || now();
      order.availabilityReleasedAt = "";
      order.inventoryConsumptionApplied = false;
    } else if (RELEASED_ORDER_STATUSES.has(orderStatus)) {
      commitmentStatus = "BORRADOR";
      if (oldCommitmentStatus === "EN_PEDIDO") order.availabilityReleasedAt = now();
      order.inventoryConsumptionApplied = false;
    }

    order.availabilityCommitmentStatus = commitmentStatus;
    order.availabilityCommitmentSnapshot = physicalSnapshot;

    if (oldCommitmentStatus !== commitmentStatus) {
      recordAudit(appState, {
        type: "ORDER_AVAILABILITY",
        orderId: order.id || "",
        orderNumber: order.number || "",
        sellingCompanyId: order.sellingCompanyId,
        fulfillingCompanyId: BLESS_COMPANY_ID,
        previousStatus: oldCommitmentStatus,
        nextStatus: commitmentStatus,
        sourceOrderStatus: orderStatus,
        sourcePreviousOrderStatus: normalize(previousStatus),
        snapshot: clone(order.availabilityCommitmentSnapshot),
        note: commitmentStatus === "DESPACHADO"
          ? "El despacho consume el compromiso existente mediante escaneo; no crea un segundo descuento."
          : ""
      });
    }
    return order;
  }

  function synchronizeOrders(appState) {
    const orders = getAllOrders(appState);
    orders.forEach(order => syncOrderLifecycle(appState, order, order.status, order.status));
    save();
    return orders;
  }

  function isImperioOrder(order) {
    return sellingCompanyId(order) === IMPERIO_COMPANY_ID;
  }

  function isBlessOrder(order) {
    return sellingCompanyId(order) === BLESS_COMPANY_ID;
  }

  function setOrderSellingCompany(appState, orderId, companyId) {
    const order = getAllOrders(appState).find(item => String(item.id) === String(orderId));
    if (!order) return { ok: false, error: "Pedido no encontrado." };
    const normalizedCompanyId = String(companyId || "");
    if (![BLESS_COMPANY_ID, IMPERIO_COMPANY_ID].includes(normalizedCompanyId)) {
      return { ok: false, error: "La empresa vendedora no es valida." };
    }
    if (!["BORRADOR", "REFERENCIAL"].includes(normalize(order.status))) {
      return { ok: false, error: "La empresa solo puede cambiarse mientras el pedido sea borrador o referencial." };
    }
    if (order.intercompanySettlementId || order.intercompanyInvoiceId) {
      return { ok: false, error: "El pedido ya pertenece a una liquidacion intercompany." };
    }
    const previousCompanyId = sellingCompanyId(order);
    order.sellingCompanyId = normalizedCompanyId;
    order.selling_company_id = normalizedCompanyId;
    order.companyId = normalizedCompanyId;
    order.company_id = normalizedCompanyId;
    normalizeOrderCompanies(order);
    recordAudit(appState, {
      type: "ORDER_COMPANY",
      action: "CAMBIAR_EMPRESA_VENDEDORA",
      orderId: order.id,
      orderNumber: order.number,
      previousCompanyId,
      companyId: normalizedCompanyId,
      fulfillingCompanyId: BLESS_COMPANY_ID
    });
    save();
    return { ok: true, order: clone(order) };
  }

  function getAvailabilitySummary(appState) {
    const rows = BlessERP.comercialOrderFulfillment?.getAvailabilityRows?.(resolveState(appState)) || [];
    const baseRows = rows.filter(row => !row.openMixed && !row.anyLength);
    const physicalBunches = baseRows.reduce((sum, row) => sum + number(row.physicalInventoryBunches ?? row.physicalBunches), 0);
    const totalCommittedBunches = rows.reduce((sum, row) => sum + number(row.demandPendingBunches), 0);
    return {
      inventoryOwnerCompanyId: BLESS_COMPANY_ID,
      imperioHasInventory: false,
      physicalBunches,
      blessCommittedBunches: rows.reduce((sum, row) => sum + number(row.blessPendingOrderBunches), 0),
      imperioCommittedBunches: rows.reduce((sum, row) => sum + number(row.imperioPendingOrderBunches), 0),
      totalCommittedBunches,
      spotAvailableBunches: Math.max(physicalBunches - totalCommittedBunches, 0),
      rows: clone(rows)
    };
  }

  function getScheduledOrders(appState, horizon = "HOY", nowDate = new Date()) {
    const policy = BlessERP.operacionesAvailabilityPolicy;
    if (!policy?.horizonRange || !policy?.isScheduledFutureOrder || !policy?.orderPreparationDate) return [];
    const availabilityState = getAvailabilitySourceState(appState);
    const range = policy.horizonRange(horizon, nowDate);
    return getAllOrders(appState)
      .filter(order => policy.isScheduledFutureOrder(order, availabilityState, nowDate))
      .filter(order => {
        const date = policy.orderPreparationDate(order);
        return date >= range.from && date <= range.to;
      })
      .map(order => ({
        order,
        preparationDate: policy.orderPreparationDate(order),
        bunches: (order.lines || []).reduce((sum, line) => sum + number(line.bunches), 0),
        reserved: policy.isExplicitlyReserved?.(order) === true
      }))
      .sort((left, right) => left.preparationDate.localeCompare(right.preparationDate) || String(left.order.number || "").localeCompare(String(right.order.number || "")));
  }

  function normalizeDate(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const parsed = new Date(`${text}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? "" : text;
  }

  function orderDispatchDate(order = {}) {
    return normalizeDate(String(order.dispatchedAt || order.dispatchDate || order.flightDate || "").slice(0, 10));
  }

  function isDispatchedImperioOrder(order, dateFrom, dateTo) {
    normalizeOrderCompanies(order);
    const date = orderDispatchDate(order);
    const snapshot = orderSnapshot(order);
    return isImperioOrder(order)
      && order.fulfillingCompanyId === BLESS_COMPANY_ID
      && DISPATCHED_ORDER_STATUSES.has(normalize(order.status))
      && snapshot.bunches > 0
      && snapshot.pendingBunches === 0
      && Boolean(date)
      && date >= dateFrom
      && date <= dateTo
      && !String(order.intercompanySettlementId || "").trim()
      && !String(order.intercompanyInvoiceId || "").trim();
  }

  function getEligibleOrders(appState, filters = {}) {
    const dateFrom = normalizeDate(filters.dateFrom);
    const dateTo = normalizeDate(filters.dateTo);
    if (!dateFrom || !dateTo || dateFrom > dateTo) return [];
    const selected = new Set(Array.isArray(filters.orderIds) ? filters.orderIds.map(String) : []);
    return getAllOrders(appState)
      .filter(order => isDispatchedImperioOrder(order, dateFrom, dateTo))
      .filter(order => !selected.size || selected.has(String(order.id)))
      .sort((left, right) => orderDispatchDate(left).localeCompare(orderDispatchDate(right)) || String(left.number).localeCompare(String(right.number)));
  }

  function buildSettlementLines(orders) {
    return orders.flatMap(order => (order.lines || []).flatMap(line => {
      const groupedScans = new Map();
      (Array.isArray(line.scannedBunches) ? line.scannedBunches : []).forEach(scan => {
        const variety = String(scan.variety || line.variety || "").trim();
        const length = number(scan.length || line.length);
        const stemsPerBunch = Math.max(0, number(scan.stemsPerBunch || line.stemsPerBunch));
        const key = `${normalize(variety)}|${length}|${stemsPerBunch}`;
        const current = groupedScans.get(key) || { variety, length, stemsPerBunch, bunches: 0 };
        current.bunches += 1;
        groupedScans.set(key, current);
      });
      const sellingUnitPrice = round(line.unitPrice, 4);
      const transferUnitPrice = round(line.transferUnitPrice ?? line.intercompanyUnitPrice ?? line.unitPrice, 4);
      return [...groupedScans.values()].map(group => {
        const stems = group.bunches * group.stemsPerBunch;
        return {
        id: uid("COM-INT-LIN"),
        orderId: order.id,
        orderNumber: order.number,
        dispatchedAt: orderDispatchDate(order),
        sourceLineId: line.id || "",
        boxNumber: number(line.boxNumber),
        boxType: line.boxType || "",
        variety: group.variety,
        length: group.length,
        bunches: group.bunches,
        stemsPerBunch: group.stemsPerBunch,
        stems,
        sellingUnitPrice,
        transferUnitPrice,
        transferPriceSource: line.transferPriceSource || (
          line.transferUnitPrice !== undefined ? "PRECIO_TRANSFERENCIA" : "PRECIO_VENTA_REFERENCIAL"
        ),
        sellingTotal: round(stems * sellingUnitPrice, 2),
        transferTotal: round(stems * transferUnitPrice, 2)
        };
      });
    }));
  }

  function settlementTotals(lines = []) {
    const orderIds = new Set(lines.map(line => line.orderId));
    const boxesByOrder = new Set(lines.map(line => `${line.orderId}|${line.boxNumber}`));
    const sellingTotal = round(lines.reduce((sum, line) => sum + number(line.sellingTotal), 0), 2);
    const transferTotal = round(lines.reduce((sum, line) => sum + number(line.transferTotal), 0), 2);
    return {
      orders: orderIds.size,
      boxes: boxesByOrder.size,
      bunches: lines.reduce((sum, line) => sum + number(line.bunches), 0),
      stems: lines.reduce((sum, line) => sum + number(line.stems), 0),
      sellingTotal,
      transferTotal,
      imperioGrossMargin: round(sellingTotal - transferTotal, 2)
    };
  }

  function nextSettlementNumber(store, dateFrom) {
    const year = String(dateFrom || today()).slice(0, 4);
    const highest = store.intercompanySettlements.reduce((max, item) => {
      const match = String(item.number || "").match(/(\d+)$/);
      return Math.max(max, match ? number(match[1]) : 0);
    }, 0);
    return `LIQ-BF-IMP-${year}-${String(highest + 1).padStart(4, "0")}`;
  }

  function createWeeklySettlement(appState, payload = {}) {
    if (!INTERCOMPANY_BILLING_ENABLED) return { ok: false, error: "La liquidacion Bless a Imperio ya no forma parte del flujo operativo." };
    const store = ensureStore(appState);
    const dateFrom = normalizeDate(payload.dateFrom);
    const dateTo = normalizeDate(payload.dateTo);
    if (!dateFrom || !dateTo) return { ok: false, error: "Indique un rango semanal valido." };
    if (dateFrom > dateTo) return { ok: false, error: "La fecha inicial no puede ser posterior a la fecha final." };
    const rangeDays = Math.floor((new Date(`${dateTo}T12:00:00`) - new Date(`${dateFrom}T12:00:00`)) / 86400000) + 1;
    if (rangeDays > 7) return { ok: false, error: "La liquidacion semanal no puede abarcar mas de 7 dias." };

    const orders = getEligibleOrders(appState, {
      dateFrom,
      dateTo,
      orderIds: payload.orderIds
    });
    if (!orders.length) {
      return { ok: false, error: "No existen pedidos de Imperio despachados y pendientes de liquidar en el rango." };
    }

    const lines = buildSettlementLines(orders);
    if (!lines.length) return { ok: false, error: "Los pedidos seleccionados no tienen detalle para liquidar." };
    const createdAt = now();
    const settlement = {
      id: uid("COM-INT-LIQ"),
      number: nextSettlementNumber(store, dateFrom),
      status: "BORRADOR",
      dateFrom,
      dateTo,
      sellerCompanyId: BLESS_COMPANY_ID,
      sellerCompanyName: "Bless Flower",
      buyerCompanyId: IMPERIO_COMPANY_ID,
      buyerCompanyName: "Imperio Flowers",
      inventoryOwnerCompanyId: BLESS_COMPANY_ID,
      orderIds: orders.map(order => order.id),
      orderNumbers: orders.map(order => order.number),
      lines,
      totals: settlementTotals(lines),
      invoiceId: "",
      invoiceNumber: "",
      createdAt,
      createdBy: payload.createdBy || activeUser(appState),
      confirmedAt: "",
      confirmedBy: "",
      observation: String(payload.observation || "Liquidacion semanal Bless Flower a Imperio Flowers.").trim(),
      audit: [{
        at: createdAt,
        by: payload.createdBy || activeUser(appState),
        action: "CREAR_BORRADOR",
        reason: String(payload.observation || "").trim()
      }]
    };
    store.intercompanySettlements.unshift(settlement);
    orders.forEach(order => {
      order.intercompanySettlementId = settlement.id;
      order.intercompanySettlementStatus = "BORRADOR";
    });
    recordAudit(appState, {
      type: "WEEKLY_SETTLEMENT",
      action: "CREAR_BORRADOR",
      settlementId: settlement.id,
      settlementNumber: settlement.number,
      orderIds: [...settlement.orderIds],
      totals: clone(settlement.totals)
    });
    save();
    return { ok: true, settlement: clone(settlement) };
  }

  function recalculateSettlement(settlement) {
    settlement.lines.forEach(line => {
      line.transferUnitPrice = round(line.transferUnitPrice, 4);
      line.transferTotal = round(number(line.stems) * line.transferUnitPrice, 2);
      line.sellingTotal = round(number(line.stems) * round(line.sellingUnitPrice, 4), 2);
    });
    settlement.totals = settlementTotals(settlement.lines);
    return settlement;
  }

  function setSettlementLineTransferPrice(appState, settlementId, lineId, value, reason = "") {
    if (!INTERCOMPANY_BILLING_ENABLED) return { ok: false, error: "La liquidacion Bless a Imperio esta deshabilitada." };
    const store = ensureStore(appState);
    const settlement = store.intercompanySettlements.find(item => String(item.id) === String(settlementId));
    if (!settlement) return { ok: false, error: "Liquidacion intercompany no encontrada." };
    if (normalize(settlement.status) !== "BORRADOR") return { ok: false, error: "Solo se pueden editar precios en una liquidacion borrador." };
    const line = settlement.lines.find(item => String(item.id) === String(lineId));
    if (!line) return { ok: false, error: "Linea de liquidacion no encontrada." };
    const unitPrice = round(value, 4);
    if (unitPrice < 0) return { ok: false, error: "El precio de transferencia no puede ser negativo." };
    if (!String(reason || "").trim()) return { ok: false, error: "Debe indicar el motivo del ajuste de precio." };
    const previousValue = line.transferUnitPrice;
    line.transferUnitPrice = unitPrice;
    line.transferPriceSource = "AJUSTE_MANUAL_LIQUIDACION";
    recalculateSettlement(settlement);
    settlement.audit.push({
      at: now(),
      by: activeUser(appState),
      action: "AJUSTAR_PRECIO_TRANSFERENCIA",
      lineId: line.id,
      previousValue,
      newValue: unitPrice,
      reason: String(reason).trim()
    });
    recordAudit(appState, {
      type: "WEEKLY_SETTLEMENT",
      action: "AJUSTAR_PRECIO_TRANSFERENCIA",
      settlementId: settlement.id,
      lineId: line.id,
      previousValue,
      newValue: unitPrice,
      reason: String(reason).trim()
    });
    save();
    return { ok: true, settlement: clone(settlement) };
  }

  function nextInternalInvoiceNumber(store, issueDate) {
    store.intercompanyInvoiceCounter += 1;
    const year = String(issueDate || today()).slice(0, 4);
    return `INT-BF-IMP-${year}-${String(store.intercompanyInvoiceCounter).padStart(6, "0")}`;
  }

  function confirmWeeklySettlement(appState, settlementId, payload = {}) {
    if (!INTERCOMPANY_BILLING_ENABLED) return { ok: false, error: "La liquidacion Bless a Imperio esta deshabilitada." };
    const store = ensureStore(appState);
    const settlement = store.intercompanySettlements.find(item => String(item.id) === String(settlementId));
    if (!settlement) return { ok: false, error: "Liquidacion intercompany no encontrada." };
    if (normalize(settlement.status) !== "BORRADOR") {
      return { ok: false, error: "La liquidacion ya fue confirmada, anulada o procesada." };
    }
    const allOrders = getAllOrders(appState);
    const orders = settlement.orderIds.map(orderId => allOrders.find(order => String(order.id) === String(orderId))).filter(Boolean);
    if (
      orders.length !== settlement.orderIds.length
      || orders.some(order => {
        const snapshot = orderSnapshot(order);
        return !DISPATCHED_ORDER_STATUSES.has(normalize(order.status))
          || snapshot.bunches <= 0
          || snapshot.pendingBunches > 0;
      })
    ) {
      return { ok: false, error: "Todos los pedidos deben continuar despachados y completamente escaneados antes de confirmar la liquidacion." };
    }

    recalculateSettlement(settlement);
    const issueDate = normalizeDate(payload.issueDate) || today();
    const invoiceNumber = nextInternalInvoiceNumber(store, issueDate);
    const confirmedAt = now();
    const invoice = {
      id: uid("COM-INT-FAC"),
      number: invoiceNumber,
      internalSequential: store.intercompanyInvoiceCounter,
      issueDate,
      status: "CONFIRMADA_INTERNA",
      documentType: "FACTURA_INTERCOMPANY_SEMANAL",
      sellerCompanyId: BLESS_COMPANY_ID,
      sellerCompanyName: "Bless Flower",
      buyerCompanyId: IMPERIO_COMPANY_ID,
      buyerCompanyName: "Imperio Flowers",
      settlementId: settlement.id,
      settlementNumber: settlement.number,
      dateFrom: settlement.dateFrom,
      dateTo: settlement.dateTo,
      orderIds: [...settlement.orderIds],
      orderNumbers: [...settlement.orderNumbers],
      lines: clone(settlement.lines),
      totals: clone(settlement.totals),
      currency: "USD",
      sriEnvironment: "PRUEBAS",
      sriStatus: "NO_EMITIDA",
      sriDocumentId: "",
      sriAccessKey: "",
      sriSourceType: "INTERCOMPANY_SETTLEMENT",
      sendsToSri: false,
      note: "Borrador tributario trazable. Se revisa antes de crear, firmar o enviar al SRI.",
      createdAt: confirmedAt,
      createdBy: payload.confirmedBy || activeUser(appState)
    };
    const sriDraft = buildSriDraftPayload(appState, invoice);
    invoice.sriDraftReady = sriDraft.ok;
    invoice.sriDraftErrors = [...sriDraft.errors];
    invoice.sriDraftPayload = sriDraft.payload;
    invoice.sriStatus = sriDraft.ok ? "BORRADOR_LOCAL" : "PENDIENTE_CONFIGURACION";
    invoice.accountingPreview = buildAccountingPreview(appState, invoice);
    invoice.accountingStatus = invoice.accountingPreview.status;
    store.intercompanyInvoices.unshift(invoice);
    settlement.status = "CONFIRMADA_INTERNA";
    settlement.invoiceId = invoice.id;
    settlement.invoiceNumber = invoice.number;
    settlement.confirmedAt = confirmedAt;
    settlement.confirmedBy = payload.confirmedBy || activeUser(appState);
    settlement.audit.push({
      at: confirmedAt,
      by: settlement.confirmedBy,
      action: "CONFIRMAR_Y_GENERAR_FACTURA_INTERNA",
      invoiceId: invoice.id,
      invoiceNumber: invoice.number
    });
    orders.forEach(order => {
      order.intercompanySettlementId = settlement.id;
      order.intercompanySettlementStatus = settlement.status;
      order.intercompanyInvoiceId = invoice.id;
      order.intercompanyInvoiceNumber = invoice.number;
      order.intercompanyLiquidatedAt = confirmedAt;
    });
    recordAudit(appState, {
      type: "INTERCOMPANY_INVOICE",
      action: "CONFIRMAR",
      settlementId: settlement.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      orderIds: [...settlement.orderIds],
      totals: clone(settlement.totals),
      note: invoice.note
    });
    save();
    return { ok: true, settlement: clone(settlement), invoice: clone(invoice) };
  }

  function annulWeeklySettlement(appState, settlementId, reason = "") {
    if (!INTERCOMPANY_BILLING_ENABLED) return { ok: false, error: "La liquidacion Bless a Imperio esta deshabilitada." };
    const store = ensureStore(appState);
    const settlement = store.intercompanySettlements.find(item => String(item.id) === String(settlementId));
    if (!settlement) return { ok: false, error: "Liquidacion intercompany no encontrada." };
    if (!String(reason || "").trim()) return { ok: false, error: "Debe indicar el motivo de anulacion." };
    if (normalize(settlement.status) === "ANULADA") return { ok: false, error: "La liquidacion ya esta anulada." };
    const invoice = store.intercompanyInvoices.find(item => item.id === settlement.invoiceId);
    const cancellableSriStatuses = new Set(["NO_EMITIDA", "BORRADOR_LOCAL", "PENDIENTE_CONFIGURACION"]);
    if (invoice?.sriDocumentId || (invoice && !cancellableSriStatuses.has(normalize(invoice.sriStatus)))) {
      return { ok: false, error: "El documento ya inicio un proceso tributario y no puede anularse desde la liquidacion interna." };
    }
    const annulledAt = now();
    settlement.status = "ANULADA";
    settlement.annulledAt = annulledAt;
    settlement.annulledBy = activeUser(appState);
    settlement.annulReason = String(reason).trim();
    settlement.audit.push({
      at: annulledAt,
      by: settlement.annulledBy,
      action: "ANULAR",
      reason: settlement.annulReason
    });
    if (invoice) {
      invoice.status = "ANULADA_INTERNA";
      invoice.annulledAt = annulledAt;
      invoice.annulledBy = settlement.annulledBy;
      invoice.annulReason = settlement.annulReason;
    }
    settlement.orderIds.forEach(orderId => {
      const order = getAllOrders(appState).find(item => String(item.id) === String(orderId));
      if (!order || order.intercompanySettlementId !== settlement.id) return;
      order.intercompanySettlementId = "";
      order.intercompanySettlementStatus = "";
      order.intercompanyInvoiceId = "";
      order.intercompanyInvoiceNumber = "";
      order.intercompanyLiquidatedAt = "";
    });
    recordAudit(appState, {
      type: "WEEKLY_SETTLEMENT",
      action: "ANULAR",
      settlementId: settlement.id,
      invoiceId: invoice?.id || "",
      reason: settlement.annulReason
    });
    save();
    return { ok: true, settlement: clone(settlement), invoice: invoice ? clone(invoice) : null };
  }

  function getSettlements(appState, filters = {}) {
    if (!INTERCOMPANY_BILLING_ENABLED) return [];
    return ensureStore(appState).intercompanySettlements
      .filter(item => !filters.status || normalize(item.status) === normalize(filters.status))
      .filter(item => !filters.dateFrom || item.dateTo >= filters.dateFrom)
      .filter(item => !filters.dateTo || item.dateFrom <= filters.dateTo)
      .map(clone);
  }

  function getInvoices(appState, filters = {}) {
    if (!INTERCOMPANY_BILLING_ENABLED) return [];
    return ensureStore(appState).intercompanyInvoices
      .filter(item => !filters.status || normalize(item.status) === normalize(filters.status))
      .filter(item => !filters.dateFrom || item.issueDate >= filters.dateFrom)
      .filter(item => !filters.dateTo || item.issueDate <= filters.dateTo)
      .map(clone);
  }

  function getInvoice(appState, invoiceId) {
    const invoice = ensureStore(appState).intercompanyInvoices
      .find(item => String(item.id) === String(invoiceId));
    return invoice ? clone(invoice) : null;
  }

  function refreshSriDraft(appState, invoiceId) {
    const store = ensureStore(appState);
    const invoice = store.intercompanyInvoices.find(item => String(item.id) === String(invoiceId));
    if (!invoice) return { ok: false, errors: ["Factura intercompany no encontrada."] };
    if (invoice.sriDocumentId) return { ok: false, errors: ["La factura ya tiene un borrador SRI remoto."] };
    const result = buildSriDraftPayload(appState, invoice);
    invoice.sriDraftReady = result.ok;
    invoice.sriDraftErrors = [...result.errors];
    invoice.sriDraftPayload = result.payload;
    invoice.sriStatus = result.ok ? "BORRADOR_LOCAL" : "PENDIENTE_CONFIGURACION";
    save();
    return { ...result, invoice: clone(invoice) };
  }

  function syncSriInvoice(appState, invoiceId, detail) {
    const store = ensureStore(appState);
    const invoice = store.intercompanyInvoices.find(item => String(item.id) === String(invoiceId));
    const document = detail?.document || detail;
    if (!invoice || !document) return { ok: false, error: "No fue posible vincular el documento SRI." };
    invoice.sriDocumentId = document.id || invoice.sriDocumentId || "";
    invoice.sriStatus = String(document.status || invoice.sriStatus || "BORRADOR").toUpperCase();
    invoice.sriAccessKey = document.access_key || invoice.sriAccessKey || "";
    invoice.sriFullNumber = document.full_number || invoice.sriFullNumber || "";
    invoice.sriAuthorizationNumber = document.authorization_number || invoice.sriAuthorizationNumber || "";
    invoice.sriAuthorizedAt = document.authorized_at || invoice.sriAuthorizedAt || "";
    invoice.sriLastSyncAt = now();
    invoice.sendsToSri = ["FIRMADO", "ENVIADO_SRI", "RECIBIDO_SRI", "AUTORIZADO"].includes(invoice.sriStatus);
    const settlement = store.intercompanySettlements.find(item => item.id === invoice.settlementId);
    if (settlement) {
      settlement.sriDocumentId = invoice.sriDocumentId;
      settlement.sriStatus = invoice.sriStatus;
      settlement.sriFullNumber = invoice.sriFullNumber;
    }
    save();
    return { ok: true, invoice: clone(invoice) };
  }

  BlessERP.comercialIntercompany = {
    BLESS_COMPANY_ID,
    IMPERIO_COMPANY_ID,
    billingEnabled: INTERCOMPANY_BILLING_ENABLED,
    annulWeeklySettlement,
    confirmWeeklySettlement,
    createWeeklySettlement,
    buildAccountingPreview,
    buildSriDraftPayload,
    getAvailabilitySummary,
    getAvailabilitySourceState,
    getAllOrders,
    getCommercialStore,
    getEligibleOrders,
    getInvoices,
    getInvoice,
    getScheduledOrders,
    getSettlements,
    isBlessOrder,
    isImperioOrder,
    normalizeOrderCompanies,
    orderSnapshot,
    sellingCompanyId,
    setOrderSellingCompany,
    setSettlementLineTransferPrice,
    refreshSriDraft,
    syncOrderLifecycle,
    synchronizeOrders,
    syncSriInvoice
  };
})();
