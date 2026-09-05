(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const flow = BlessERP.commercialFlowV2;

  function esc(value) { return BlessERP.comercialUtils?.esc?.(value) || String(value ?? ""); }
  function upper(value) { return String(value ?? "").trim().toUpperCase(); }
  function ui(appState) { return flow.sessionFor(appState).exportShipment; }
  function customerName(appState, id) {
    const row = flow.customerFor(appState, id);
    return row?.legalName || row?.commercialName || id || "Sin cliente";
  }
  function dateTimeInput(value) { return String(value || "").slice(0, 16); }
  function money(value) { return Number(value || 0).toLocaleString("es-EC", { style: "currency", currency: "USD" }); }
  function badge(status) { return ["CLOSED","ARRIVED","DEPARTED","DELIVERED_TO_CARGO","DOCUMENTATION_COMPLETE"].includes(upper(status)) ? "authorized" : upper(status).includes("PENDING") || upper(status)==="DRAFT" ? "pending" : "partial"; }
  function setMessage(appState, message, tone = "info") { ui(appState).message = message; ui(appState).tone = tone; }
  function rerender() { BlessERP.layout?.renderPage?.(); }

  function orderOption(appState, order) {
    const dispatch = flow.getDispatchRecord(appState, order.id);
    return `<option value="${esc(order.id)}" data-transport="${esc(order.transportType || "aereo")}">${esc(order.number)} · ${esc(customerName(appState, order.customerId))} · ${esc(dispatch?.dispatchCode || "DSP")}</option>`;
  }

  function renderList(appState) {
    const state = ui(appState);
    const shipments = flow.exportShipments(appState).filter(row => state.status === "TODOS" || upper(row.status) === state.status);
    const eligible = flow.eligibleExportOrders(appState);
    return `<section class="page-header"><div><p class="section-kicker">COMERCIAL / EXPORTACIONES</p><h1>Expedientes de exportación</h1><p>Pedido → despacho → DAE → guías → vuelo → documentos, con Supabase como fuente canónica.</p></div></section>
      ${state.message ? `<div class="inline-feedback ${state.tone === "error" ? "danger" : state.tone === "success" ? "success" : "warning"}">${esc(state.message)}</div>` : ""}
      <section class="panel-card commercial-v2-section"><div class="panel-card-head"><div><p class="section-kicker">NUEVO EXPEDIENTE</p><h3>Pedido despachado</h3></div><span class="status-badge pending">CONFIRMACIÓN REMOTA</span></div>
        <div class="commercial-v2-filters"><label>Pedido<select data-export-create-order><option value="">Seleccione un pedido exportado y despachado</option>${eligible.map(order => orderOption(appState, order)).join("")}</select></label><button type="button" class="primary-button" data-export-create ${eligible.length ? "" : "disabled"}>Crear expediente</button></div>
        <div class="commercial-v2-box-editor-grid"><label><input type="checkbox" value="DAE" data-export-required checked> DAE</label><label><input type="checkbox" value="PACKING_LIST" data-export-required checked> Packing List</label><label><input type="checkbox" value="MAWB" data-export-required checked> MAWB</label><label><input type="checkbox" value="HAWB" data-export-required checked> HAWB</label><label><input type="checkbox" value="FACTURA" data-export-required> Factura</label><label><input type="checkbox" value="FITOSANITARIO" data-export-required> Fitosanitario</label></div>
      </section>
      <section class="panel-card commercial-v2-section"><div class="commercial-v2-filters"><label>Estado<select data-export-filter><option value="TODOS">Todos</option>${["DRAFT","DOCUMENTATION_PENDING","DOCUMENTATION_COMPLETE","READY_FOR_CARGO","DELIVERED_TO_CARGO","BOOKED","DEPARTED","ARRIVED","CLOSED","REOPENED"].map(status => `<option value="${status}" ${state.status===status?"selected":""}>${status}</option>`).join("")}</select></label></div>
        <div class="table-wrap"><table><thead><tr><th>Expediente</th><th>Pedido(s)</th><th>Cliente</th><th>Destino</th><th>Cajas</th><th>DAE</th><th>MAWB / HAWB</th><th>Vuelo</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${shipments.map(row => `<tr><td><strong>${esc(row.shipmentCode)}</strong></td><td>${esc((row.orderIds||[]).map(id => flow.findOrder(appState,id)?.number || id).join(", "))}</td><td>${esc(customerName(appState,row.customerId))}</td><td>${esc(row.destinationCountry || row.destination || "-")}</td><td>${esc((row.boxes||[]).length)}</td><td>${esc(row.dae?.number || "-")}</td><td>${esc([row.waybills?.mawb,row.waybills?.hawb].filter(Boolean).join(" / ") || "-")}</td><td>${esc(row.flight?.flightNumber || "-")}</td><td><span class="status-badge ${badge(row.status)}">${esc(row.status)}</span></td><td><button type="button" class="primary-button" data-export-open="${esc(row.shipmentId || row.id)}">Abrir</button></td></tr>`).join("") || `<tr><td colspan="10"><div class="empty-state compact">No existen expedientes canónicos con este filtro.</div></td></tr>`}</tbody></table></div>
      </section>`;
  }

  function catalogOption(rows, selected, label) {
    return `<option value="">${label}</option>${rows.map(row => `<option value="${esc(row.id)}" ${String(row.id)===String(selected)?"selected":""}>${esc(row.awbPrefix ? `${row.awbPrefix} · ${row.name}` : row.name)}</option>`).join("")}`;
  }

  function documentValue(shipment, type) { return (shipment.documents || []).find(row => upper(row.type) === type) || {}; }

  function financialRows(entity) {
    const finance = BlessERP.state?.state?.db?.financeV2 || {};
    const key = {
      financial_shipment_expenses: "shipmentExpenses",
      financial_cost_allocations: "costAllocations"
    }[entity];
    return Array.isArray(finance[key]) ? finance[key] : [];
  }

  function renderExpenseSection(appState, shipment) {
    if (!BlessERP.config?.financialV2CaptureEnabled) return "";
    const expenses = financialRows("financial_shipment_expenses")
      .filter(row => String(row.shipmentId || row.shipment_id || "") === String(shipment.shipmentId));
    const allocations = financialRows("financial_cost_allocations");
    const orderIds = shipment.orderIds || [];
    return `<section class="panel-card commercial-v2-section" data-export-expense-panel>
      <div class="panel-card-head"><div><p class="section-kicker">COSTOS DE EXPORTACIÓN</p><h3>Gastos confirmados y distribución</h3></div><span class="status-badge pending">SUPABASE V2</span></div>
      <p class="panel-note">El gasto y sus asignaciones se confirman juntos. La suma distribuida debe ser exactamente igual al valor total.</p>
      <div class="customer-editor-grid">
        <label><span>Categoría</span><select data-expense-field="category"><option value="AIR_FREIGHT">Flete aéreo</option><option value="CARGO_AGENCY">Agencia de carga</option><option value="TRANSPORT">Transporte</option><option value="DOCUMENTATION">Documentación</option><option value="PHYTOSANITARY">Fitosanitario</option><option value="HANDLING">Handling</option><option value="OTHER">Otro</option></select></label>
        <label><span>Referencia única</span><input data-expense-field="sourceId" placeholder="Factura, liquidación o referencia"></label>
        <label><span>Valor</span><input type="number" min="0.01" step="0.01" data-expense-field="amount"></label>
        <label><span>Método registrado</span><select data-expense-field="allocationMethod"><option value="MANUAL">Manual autorizado</option><option value="BOXES">Por cajas</option><option value="WEIGHT">Por peso</option><option value="STEMS">Por tallos</option><option value="BUNCHES">Por ramos</option><option value="FOB_VALUE">Por valor FOB</option></select></label>
        <label class="customer-span-2"><span>Descripción</span><input data-expense-field="description" placeholder="Detalle del gasto logístico"></label>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Valor asignado</th></tr></thead><tbody>${orderIds.map(orderId => `<tr><td><strong>${esc(flow.findOrder(appState,orderId)?.number || orderId)}</strong></td><td><input type="number" min="0" step="0.01" value="0" data-expense-allocation="${esc(orderId)}"></td></tr>`).join("") || `<tr><td colspan="2"><div class="empty-state compact">El embarque no tiene pedidos para distribuir.</div></td></tr>`}</tbody></table></div>
      <div class="table-actions-inline"><button type="button" class="primary-button" data-export-expense-save ${orderIds.length ? "" : "disabled"}>Registrar gasto confirmado</button></div>
      <div class="table-wrap"><table><thead><tr><th>Referencia</th><th>Categoría</th><th>Total</th><th>Distribución</th><th>Estado</th></tr></thead><tbody>${expenses.map(expense => {
        const expenseId=String(expense.expenseId||expense.expense_id||expense.id||"");
        const assigned=allocations.filter(row=>String(row.expenseId||row.expense_id||"")===expenseId).reduce((sum,row)=>sum+Number(row.amount||0),0);
        return `<tr><td>${esc(expense.sourceId||expense.source_id||"-")}</td><td>${esc(expense.category||"-")}</td><td><strong>${money(expense.amount)}</strong></td><td>${money(assigned)}</td><td><span class="status-badge authorized">${esc(expense.accountingStatus||expense.accounting_status||"UNPOSTED")}</span></td></tr>`;
      }).join("") || `<tr><td colspan="5"><div class="empty-state compact">Todavía no existen gastos confirmados para este embarque.</div></td></tr>`}</tbody></table></div>
    </section>`;
  }

  function renderDetail(appState, shipment) {
    const catalogs = flow.catalogs(appState);
    const closed = upper(shipment.status) === "CLOSED";
    const order = flow.findOrder(appState, shipment.orderIds?.[0]);
    const transportType = String(order?.transportType || "aereo").toLowerCase();
    const maritime = transportType === "maritimo";
    const documentTypes = ["DAE","PACKING_LIST","MAWB","HAWB","FACTURA","FITOSANITARIO"];
    return `<section class="page-header"><div><p class="section-kicker">EXPEDIENTE DE EXPORTACIÓN</p><h1>${esc(shipment.shipmentCode)}</h1><p>${esc((shipment.orderIds||[]).map(id => flow.findOrder(appState,id)?.number || id).join(", "))} · ${esc(customerName(appState,shipment.customerId))}</p></div><div class="page-header-side"><button type="button" class="secondary-button" data-export-back>Regresar</button><span class="status-badge ${badge(shipment.status)}">${esc(shipment.status)}</span></div></section>
      ${ui(appState).message ? `<div class="inline-feedback ${ui(appState).tone === "error" ? "danger" : ui(appState).tone === "success" ? "success" : "warning"}">${esc(ui(appState).message)}</div>` : ""}
      <section class="panel-card commercial-v2-section"><div class="panel-card-head"><div><p class="section-kicker">TRAZABILIDAD</p><h3>Pedido, despacho y cajas</h3></div><span>${esc((shipment.boxes||[]).length)} caja(s)</span></div><div class="commercial-v2-cold-compact-summary"><div><span>Pedido(s)</span><strong>${esc((shipment.orderIds||[]).length)}</strong></div><div><span>Despacho(s)</span><strong>${esc((shipment.dispatchIds||[]).length)}</strong></div><div><span>Cajas</span><strong>${esc((shipment.boxes||[]).length)}</strong></div><div><span>Cliente</span><strong>${esc(customerName(appState,shipment.customerId))}</strong></div></div></section>
      <section class="panel-card commercial-v2-section"><div class="panel-card-head"><div><p class="section-kicker">LOGÍSTICA</p><h3>DAE, agencia, guías y vuelo</h3></div></div>
        <div class="customer-editor-grid" data-export-form>
          <label><span>Agencia de carga</span><select data-export-field="cargoAgencyId" ${closed?"disabled":""}>${catalogOption(catalogs.agencies,shipment.cargoAgencyId,"Seleccione agencia")}</select></label>
          <label><span>${maritime?"Transportista marítimo (no aplica aerolínea)":"Aerolínea"}</span><select data-export-field="airlineId" ${closed||maritime?"disabled":""}>${catalogOption(catalogs.airlines,shipment.airlineId,"Seleccione aerolínea")}</select></label>
          <label><span>DAE del catálogo</span><select data-export-field="daeCatalogId" ${closed?"disabled":""}><option value="">Sin ficha vinculada</option>${catalogs.daes.map(row=>`<option value="${esc(row.id)}" ${String(row.id)===String(shipment.dae?.catalogId)?"selected":""}>${esc(row.number)} · ${esc(row.country||row.destination)}</option>`).join("")}</select></label>
          <label><span>DAE</span><input value="${esc(shipment.dae?.number||"")}" placeholder="${maritime?"Pendiente hasta recibir DAE fiscal":"DAE real"}" data-export-field="daeNumber" ${closed?"disabled":""}><small>${maritime?"La coordinación marítima puede continuar sin DAE; SRI seguirá bloqueado hasta registrarla.":"Documento fiscal de exportación."}</small></label>
          <label><span>Fecha DAE</span><input type="date" value="${esc(shipment.dae?.date||"")}" data-export-field="daeDate" ${closed?"disabled":""}></label>
          <label><span>Distrito</span><input value="${esc(shipment.dae?.district||"")}" data-export-field="daeDistrict" ${closed?"disabled":""}></label>
          <label><span>Régimen</span><input value="${esc(shipment.dae?.regime||"")}" data-export-field="daeRegime" ${closed?"disabled":""}></label>
          <label><span>Estado DAE</span><select data-export-field="daeStatus" ${closed?"disabled":""}><option>PENDING</option><option ${upper(shipment.dae?.status)==="AVAILABLE"?"selected":""}>AVAILABLE</option><option ${upper(shipment.dae?.status)==="VALIDATED"?"selected":""}>VALIDATED</option></select></label>
          <label><span>${maritime?"Guía madre marítima":"MAWB"}</span><input value="${esc(shipment.waybills?.mawb||"")}" placeholder="${maritime?"MAR-15654465":"014-12345678"}" data-export-field="mawb" ${closed?"disabled":""}></label>
          <label><span>${maritime?"Guía hija marítima":"HAWB"}</span><input value="${esc(shipment.waybills?.hawb||"")}" placeholder="${maritime?"BL-8899":"HAWB"}" data-export-field="hawb" ${closed?"disabled":""}></label>
          <label><span>Vuelo</span><input value="${esc(shipment.flight?.flightNumber||"")}" data-export-field="flightNumber" ${closed?"disabled":""}></label>
          <label><span>Salida prevista</span><input type="datetime-local" value="${esc(dateTimeInput(shipment.plannedDepartureAt||shipment.flight?.plannedDepartureAt))}" data-export-field="plannedDepartureAt" ${closed?"disabled":""}></label>
          <label><span>Aeropuerto origen</span><input value="${esc(shipment.originAirport||"UIO")}" maxlength="4" data-export-field="originAirport" ${closed?"disabled":""}></label>
          <label><span>Aeropuerto destino</span><input value="${esc(shipment.destinationAirport||"")}" maxlength="4" data-export-field="destinationAirport" ${closed?"disabled":""}></label>
          <label><span>Peso neto</span><input type="number" min="0" step="0.0001" value="${esc(shipment.weights?.net||0)}" data-export-field="net" ${closed?"disabled":""}></label>
          <label><span>Peso bruto</span><input type="number" min="0" step="0.0001" value="${esc(shipment.weights?.gross||0)}" data-export-field="gross" ${closed?"disabled":""}></label>
          <label><span>Peso volumétrico</span><input type="number" min="0" step="0.0001" value="${esc(shipment.weights?.volumetric||0)}" data-export-field="volumetric" ${closed?"disabled":""}></label>
          <label class="customer-span-2"><span>Observaciones</span><textarea data-export-field="observations" ${closed?"disabled":""}>${esc(shipment.observations||"")}</textarea></label>
        </div>${closed?"":`<div class="table-actions-inline"><button type="button" class="primary-button" data-export-save>Guardar logística</button></div>`}
      </section>
      <section class="panel-card commercial-v2-section"><div class="panel-card-head"><div><p class="section-kicker">DOCUMENTACIÓN</p><h3>Checklist configurable</h3></div><span>${esc((shipment.requiredDocumentTypes||[]).length)} obligatorio(s)</span></div>
        <div class="table-wrap"><table><thead><tr><th>Documento</th><th>Obligatorio</th><th>Estado</th><th>Referencia</th></tr></thead><tbody>${documentTypes.map(type=>{const doc=documentValue(shipment,type);const required=(shipment.requiredDocumentTypes||[]).includes(type);return `<tr><td><strong>${type}</strong></td><td>${required?"Sí":"No"}</td><td><select data-export-doc-status="${type}" ${closed?"disabled":""}><option>PENDING</option><option ${upper(doc.status)==="AVAILABLE"?"selected":""}>AVAILABLE</option><option ${upper(doc.status)==="VALIDATED"?"selected":""}>VALIDATED</option><option ${upper(doc.status)==="REJECTED"?"selected":""}>REJECTED</option></select></td><td><input value="${esc(doc.reference||"")}" data-export-doc-reference="${type}" ${closed?"disabled":""}></td></tr>`}).join("")}</tbody></table></div>
        <div class="table-actions-inline">${closed?"":`<button type="button" class="secondary-button" data-export-save>Guardar checklist</button>`}<button type="button" class="secondary-button" data-export-packing ${order?"":"disabled"}>Vista previa Packing List</button></div>
      </section>
      ${renderExpenseSection(appState,shipment)}
      <section class="panel-card commercial-v2-section"><div class="panel-card-head"><div><p class="section-kicker">CONTROL DEL EMBARQUE</p><h3>Entrega, vuelo y cierre</h3></div></div><div class="table-actions-inline">${closed?`<button type="button" class="secondary-button" data-export-reopen>Reabrir con motivo</button>`:`<button type="button" class="secondary-button" data-export-deliver>Entregar a agencia de carga</button>${!["BOOKED","DEPARTED","ARRIVED"].includes(upper(shipment.status))?`<button type="button" class="secondary-button" data-export-transition="BOOK">Marcar reservado en vuelo</button>`:""}${["BOOKED","DELIVERED_TO_CARGO"].includes(upper(shipment.status))?`<button type="button" class="secondary-button" data-export-transition="DEPART">Confirmar salida del vuelo</button>`:""}${upper(shipment.status)==="DEPARTED"?`<button type="button" class="secondary-button" data-export-transition="ARRIVE">Confirmar llegada</button>`:""}<button type="button" class="primary-button" data-export-close>Cerrar expediente</button>`}</div></section>`;
  }

  function formPayload(container, shipment, order = {}) {
    const value = name => container.querySelector(`[data-export-field="${name}"]`)?.value || "";
    const documents = [...container.querySelectorAll("[data-export-doc-status]")].map(field => ({
      type: field.dataset.exportDocStatus,
      status: field.value,
      reference: container.querySelector(`[data-export-doc-reference="${field.dataset.exportDocStatus}"]`)?.value || ""
    }));
    const transportType = String(order.transportType || "aereo").toLowerCase();
    const references = BlessERP.comercialUtils?.normalizeTransportReferences?.(transportType, {
      awb: value("mawb"), hawb: value("hawb")
    }) || { awb: value("mawb").trim(), hawb: value("hawb").trim() };
    return {
      transportType,
      cargoAgencyId: value("cargoAgencyId"), airlineId: transportType === "aereo" ? value("airlineId") : "",
      originAirport: upper(value("originAirport")), destinationAirport: upper(value("destinationAirport")),
      plannedDepartureAt: value("plannedDepartureAt") || null,
      dae: { catalogId: value("daeCatalogId"), number: value("daeNumber"), date: value("daeDate"),
        district: value("daeDistrict"), regime: value("daeRegime"), status: value("daeStatus") },
      waybills: { mawb: references.awb, hawb: references.hawb },
      flight: { flightNumber: value("flightNumber"), plannedDepartureAt: value("plannedDepartureAt") || null,
        originAirport: upper(value("originAirport")), destinationAirport: upper(value("destinationAirport")), connections: shipment.flight?.connections || [] },
      weights: { source: "MANUAL_SHIPMENT", net: Number(value("net")||0), gross: Number(value("gross")||0), volumetric: Number(value("volumetric")||0) },
      observations: value("observations"), documents
    };
  }

  async function act(appState, promise, success) {
    setMessage(appState,"Procesando y esperando confirmación de Supabase...","info"); rerender();
    const result = await promise;
    setMessage(appState,result.ok?success:(result.error||"No se pudo confirmar la operación."),result.ok?"success":"error");
    rerender();
  }

  function bind(container, appState) {
    const state = ui(appState);
    container.addEventListener("change", event => {
      if (event.target.matches("[data-export-filter]")) { state.status=event.target.value; rerender(); }
      if (event.target.matches('[data-export-field="daeCatalogId"]')) {
        const dae=flow.catalogs(appState).daes.find(row=>String(row.id)===String(event.target.value));
        const numberField=container.querySelector('[data-export-field="daeNumber"]');
        const airlineField=container.querySelector('[data-export-field="airlineId"]');
        if (dae&&numberField) numberField.value=dae.number||"";
        if (dae?.airlineId&&airlineField) airlineField.value=dae.airlineId;
      }
      if (event.target.matches("[data-export-create-order]")) {
        const maritime = String(event.target.selectedOptions?.[0]?.dataset?.transport || "").toLowerCase() === "maritimo";
        const daeRequired = container.querySelector('[data-export-required][value="DAE"]');
        if (daeRequired) daeRequired.checked = !maritime;
      }
    });
    container.addEventListener("click", async event => {
      const button = event.target.closest("button"); if (!button) return;
      if (button.hasAttribute("data-export-back")) { state.selectedId=""; state.message=""; rerender(); return; }
      if (button.dataset.exportOpen) { state.selectedId=button.dataset.exportOpen; state.message=""; rerender(); return; }
      if (button.hasAttribute("data-export-create")) {
        const orderId=container.querySelector("[data-export-create-order]")?.value;
        const required=[...container.querySelectorAll("[data-export-required]:checked")].map(field=>field.value);
        if (!orderId) { setMessage(appState,"Seleccione un pedido despachado.","error"); rerender(); return; }
        const result=await flow.createExportShipment(appState,orderId,required);
        if (result.ok) state.selectedId=result.result.shipmentId;
        setMessage(appState,result.ok?"Expediente creado y confirmado en Supabase.":result.error,result.ok?"success":"error"); rerender(); return;
      }
      const shipment=flow.findExportShipment(appState,state.selectedId); if (!shipment) return;
      if (button.hasAttribute("data-export-expense-save")) {
        const service=BlessERP.services?.financialV2;
        const field=name=>container.querySelector(`[data-expense-field="${name}"]`)?.value||"";
        const amount=Math.round(Number(field("amount")||0)*100)/100;
        const allocations=[...container.querySelectorAll("[data-expense-allocation]")].map(input=>({
          orderId:input.dataset.expenseAllocation,
          amount:Math.round(Number(input.value||0)*100)/100,
          basisValue:0,
          percentage:amount>0?Math.round((Number(input.value||0)/amount)*10000000000)/100000000:0
        })).filter(item=>item.amount>0);
        const assigned=Math.round(allocations.reduce((sum,item)=>sum+item.amount,0)*100)/100;
        if (!service?.recordShipmentExpense) { setMessage(appState,"Servicio financiero V2 no disponible.","error"); rerender(); return; }
        if (!field("sourceId").trim()||amount<=0) { setMessage(appState,"Ingrese referencia y valor válidos.","error"); rerender(); return; }
        if (Math.abs(assigned-amount)>0.000001) { setMessage(appState,`La distribución (${money(assigned)}) debe coincidir con el total (${money(amount)}).`,"error"); rerender(); return; }
        await act(appState,service.recordShipmentExpense({
          shipmentId:shipment.shipmentId,
          category:field("category"), sourceType:"MANUAL_LOGISTICS", sourceId:field("sourceId").trim(),
          amount, currencyCode:"USD", exchangeRate:1, allocationMethod:field("allocationMethod"),
          description:field("description").trim(), allocations
        }),"Gasto y distribución confirmados en Supabase.");
        return;
      }
      if (button.hasAttribute("data-export-save")) { const order=flow.findOrder(appState,shipment.orderIds?.[0])||{}; await act(appState,flow.updateExportLogistics(appState,state.selectedId,formPayload(container,shipment,order)),"Logística y documentos confirmados."); return; }
      if (button.hasAttribute("data-export-deliver")) {
        const order=flow.findOrder(appState,shipment.orderIds?.[0])||{}; const payload=formPayload(container,shipment,order); await act(appState,flow.deliverExportToCargo(appState,state.selectedId,{cargoAgencyId:payload.cargoAgencyId,observations:payload.observations}),"Entrega a agencia confirmada."); return;
      }
      if (button.hasAttribute("data-export-close")) { if (window.confirm&&!window.confirm("¿Cerrar este expediente de exportación?")) return; await act(appState,flow.closeExportShipment(appState,state.selectedId),"Expediente cerrado."); return; }
      if (button.hasAttribute("data-export-reopen")) { const reason=window.prompt?.("Motivo obligatorio de reapertura:","")||""; if(!reason.trim()) return; await act(appState,flow.reopenExportShipment(appState,state.selectedId,reason),"Expediente reabierto con auditoría."); return; }
      if (button.dataset.exportTransition) { await act(appState,flow.transitionExportShipment(appState,state.selectedId,button.dataset.exportTransition),"Estado del embarque confirmado."); return; }
      if (button.hasAttribute("data-export-packing")) {
        const order=flow.findOrder(appState,shipment.orderIds?.[0]);
        if (!order) { setMessage(appState,"No se encontró el pedido canónico para el Packing List.","error"); rerender(); return; }
        const printableOrder={...order,
          exportShipmentId:shipment.shipmentId,exportShipmentCode:shipment.shipmentCode,
          daeNumber:shipment.dae?.number||order.daeNumber,agencyId:shipment.cargoAgencyId||order.agencyId,
          airlineId:shipment.airlineId||order.airlineId,awb:shipment.waybills?.mawb||order.awb,
          hawb:shipment.waybills?.hawb||order.hawb,flightNumber:shipment.flight?.flightNumber||order.flightNumber,
          flightDate:String(shipment.plannedDepartureAt||order.flightDate||"").slice(0,10),
          destinationCountry:shipment.destinationCountry||order.destinationCountry,
          packingListNumber:order.packingListNumber||shipment.shipmentCode};
        BlessERP.comercialPrintSystem?.openPreview?.("PACKING_LIST",[printableOrder],appState,{});
      }
    });
  }

  function render(appState) {
    const state=ui(appState); const shipment=state.selectedId?flow.findExportShipment(appState,state.selectedId):null;
    if (state.selectedId&&!shipment) state.selectedId="";
    return shipment?renderDetail(appState,shipment):renderList(appState);
  }

  BlessERP.comercialExportShipments = { bind, render };
})();
