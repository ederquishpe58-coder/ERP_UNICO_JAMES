import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = file => readFile(file, "utf8");
const [state, utils, repository, queue, authorization, backend, migration, atomicSaveMigration] = await Promise.all([
  read("scripts/modules/comercial/comercial-state.js"),
  read("scripts/modules/comercial/comercial-utils.js"),
  read("scripts/repositories/comercial/commercial-order-repository.js"),
  read("scripts/modules/comercial/sri-order-queue-core.js"),
  read("scripts/modules/comercial/sri-authorization.js"),
  read("api/sri/_lib/document-service.cjs"),
  read("supabase/migrations/202608150001_commercial_order_atomic_identifiers.sql"),
  read("supabase/migrations/202608150002_commercial_order_atomic_save.sql")
]);

assert.match(repository, /erp_reserve_commercial_order_identifiers/, "El navegador no reserva identificadores mediante Supabase.");
assert.match(repository, /repository\.reserveIdentifiers = reserveIdentifiers/, "El repositorio no expone la reserva atomica.");
assert.match(repository, /erp_save_commercial_order/, "El pedido no se guarda junto con su reserva en una sola RPC.");
assert.match(repository, /repository\.saveConfirmedOrder = saveConfirmedOrder/, "El repositorio no expone el guardado transaccional.");
assert.match(state, /await reserveCurrentOrderIdentifiers\(appState, draftOrder\)/, "Guardar pedido no espera la reserva del servidor.");
assert.match(state, /sriSequenceSource = "SUPABASE_ATOMICO"/, "El pedido no registra la fuente oficial del secuencial.");
assert.match(state, /if \(!reserved\.ok\) return reserved/, "El pedido podria guardarse aunque la reserva remota falle.");
assert.match(utils, /draft\._historyMetrics = \{ \.\.\.source\._historyMetrics \}/, "La normalizacion sigue descartando los totales del historial.");
assert.match(queue, /sourceOrderId: normalizeText\(order\.id/, "El snapshot SRI no enlaza el pedido textual.");
assert.match(authorization, /result\.payload\.erpEmission\.sourceOrderId = order\.id/, "La autorizacion no reafirma el enlace al pedido.");
assert.match(backend, /document\?\._reservation_reused === true/, "El backend no reconoce un borrador idempotente.");

assert.match(migration, /create table if not exists public\.commercial_order_number_reservations/, "Falta la reserva persistente del pedido.");
assert.match(migration, /create table if not exists public\.commercial_invoice_reservations/, "Falta la reserva persistente de la factura.");
assert.match(migration, /for update/, "Las secuencias no se bloquean durante la reserva.");
assert.match(migration, /commercial_order_reservation_sequence_unique/, "No existe protección contra pedidos duplicados.");
assert.match(migration, /commercial_invoice_reservation_sequence_unique/, "No existe protección contra facturas duplicadas.");
assert.match(migration, /v_reservation\.sequential/, "El borrador SRI no consume el secuencial reservado.");
assert.match(migration, /status = 'CONSUMED'/, "La reserva no queda trazada como consumida.");
assert.match(migration, /'COM-ORD-mgfasn-mstohm1t'/, "La reparación controlada no identifica el pedido diagnosticado.");
assert.match(migration, /not exists \([\s\S]*public\.electronic_documents/, "La reparación no protege comprobantes SRI ya creados.");
assert.match(atomicSaveMigration, /create or replace function public\.erp_save_commercial_order/, "Falta la transaccion integral del pedido.");
assert.match(atomicSaveMigration, /erp_reserve_commercial_order_identifiers[\s\S]*erp_apply_offline_operation/, "La reserva y persistencia no comparten transaccion.");
assert.match(atomicSaveMigration, /status = 'REPLACED'/, "Las reservas huerfanas anteriores no quedan cerradas como auditoria.");

console.log("VALIDACION_IDENTIFICADORES_ATOMICOS_PEDIDO_OK");
console.log("Pedido, factura e historial comparten la numeracion confirmada por Supabase.");
