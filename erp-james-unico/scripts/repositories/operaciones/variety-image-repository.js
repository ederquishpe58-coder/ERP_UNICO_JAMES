(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  const BUCKET = "variety-images";
  const HEALTH_TTL_MS = 5 * 60 * 1000;
  const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
  const MAX_STORED_BYTES = 3 * 1024 * 1024;
  const MAX_EDGE_PX = 1024;
  const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const publicUrlCache = new Map();
  let health = { status: "UNKNOWN", companyId: "", checkedAt: 0, error: null, data: null };

  function activeCompanyUuid() {
    const access = BlessERP.authAccess?.activeAccess?.();
    return String(access?.activeCompany?.id || BlessERP.state?.state?.db?.authAccess?.activeCompanyUuid || "").trim();
  }

  function remoteRequired() {
    const config = BlessERP.getEnvConfig?.() || {};
    return Boolean(config.supabaseEnabled && config.operationsSupabaseEnabled && window.location?.protocol !== "file:");
  }

  function configured() {
    return Boolean(remoteRequired() && activeCompanyUuid() && BlessERP.getSupabaseClient?.()?.storage);
  }

  function canExecute() {
    const companyId = activeCompanyUuid();
    return Boolean(configured() && health.status === "VERIFIED" && health.companyId === companyId
      && Date.now() - health.checkedAt <= HEALTH_TTL_MS);
  }

  function healthFailure(error, companyId) {
    const code = String(error?.code || "").trim();
    const message = String(error?.message || "No se pudo validar el almacenamiento de imágenes.").trim();
    const status = ["PGRST202", "42883"].includes(code) || /schema cache|function .* does not exist/i.test(message)
      ? "BACKEND_MISSING" : code === "42501" ? "PERMISSION_DENIED" : "UNAVAILABLE";
    health = { status, companyId, checkedAt: Date.now(), error, data: null };
    return { ok: false, status, companyId, error, message };
  }

  async function probeBackend(options = {}) {
    const companyId = activeCompanyUuid();
    if (!configured() || !companyId) {
      health = { status: "NOT_CONFIGURED", companyId, checkedAt: Date.now(), error: null, data: null };
      return { ok: false, status: health.status, companyId, message: "Supabase Storage no está habilitado para este catálogo." };
    }
    if (!options.force && canExecute()) return { ok: true, status: "VERIFIED", companyId, data: health.data };
    health = { status: "CHECKING", companyId, checkedAt: Date.now(), error: null, data: null };
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_variety_images_health", { p_company_id: companyId });
    if (error) return healthFailure(error, companyId);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.ok || result.component !== "VARIETY_IMAGES" || result.migration !== "202608160004"
      || result.bucket !== true || result.recordTable !== true || result.commandTable !== true
      || result.setImageRpc !== true || result.storageGuard !== true || result.storagePolicies !== true) {
      return healthFailure({ code: "INCOMPLETE_BACKEND", message: "El backend de imágenes de variedades está incompleto." }, companyId);
    }
    health = { status: "VERIFIED", companyId, checkedAt: Date.now(), error: null, data: result };
    return { ok: true, status: health.status, companyId, data: result };
  }

  function uuid() {
    return BlessERP.offlineSync?.createOperationId?.() || globalThis.crypto?.randomUUID?.()
      || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        return (character === "x" ? random : (random & 0x3 | 0x8)).toString(16);
      });
  }

  function publicUrl(imagePath) {
    const path = String(imagePath || "").trim();
    if (!path || !BlessERP.getSupabaseClient?.()?.storage) return "";
    if (publicUrlCache.has(path)) return publicUrlCache.get(path);
    const result = BlessERP.getSupabaseClient().storage.from(BUCKET).getPublicUrl(path);
    const url = String(result?.data?.publicUrl || "").trim();
    if (url) publicUrlCache.set(path, url);
    return url;
  }

  function validateImageFile(file) {
    if (!(file instanceof File)) return { ok: false, message: "Seleccione una imagen válida." };
    if (!ACCEPTED_TYPES.has(String(file.type || "").toLowerCase())) {
      return { ok: false, message: "Formato no permitido. Use JPG, PNG o WEBP." };
    }
    if (!file.size || file.size > MAX_SOURCE_BYTES) {
      return { ok: false, message: "La imagen debe pesar como máximo 12 MB antes de optimizarse." };
    }
    return { ok: true };
  }

  function imageFromFile(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("No se pudo leer la fotografía seleccionada.")); };
      image.src = objectUrl;
    });
  }

  function canvasBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Este navegador no pudo generar la imagen WEBP.")), "image/webp", quality);
    });
  }

  async function optimizeImage(file) {
    const validation = validateImageFile(file);
    if (!validation.ok) throw new Error(validation.message);
    const source = typeof createImageBitmap === "function" ? await createImageBitmap(file) : await imageFromFile(file);
    try {
      const width = Number(source.width || source.naturalWidth || 0);
      const height = Number(source.height || source.naturalHeight || 0);
      if (!width || !height) throw new Error("La imagen no tiene dimensiones válidas.");
      const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height));
      const outputWidth = Math.max(1, Math.round(width * scale));
      const outputHeight = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("El navegador no pudo preparar la fotografía.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, outputWidth, outputHeight);
      let blob = await canvasBlob(canvas, 0.84);
      if (blob.size > MAX_STORED_BYTES) blob = await canvasBlob(canvas, 0.72);
      if (blob.size > MAX_STORED_BYTES) throw new Error("La imagen optimizada supera 3 MB. Seleccione una fotografía más liviana.");
      return { blob, width: outputWidth, height: outputHeight, sourceBytes: file.size, storedBytes: blob.size };
    } finally {
      source.close?.();
    }
  }

  async function applyCanonicalRecord(serverRecord) {
    const applied = await BlessERP.offlineSync?.applyRemoteRecord?.(serverRecord, {
      source: "VARIETY_IMAGE_CONFIRMED",
      force: true,
      forceServer: true,
      ignoreRecordHold: true,
      ignoreEditGuard: true
    });
    if (applied && applied.ok === false) throw new Error("Supabase confirmó la imagen, pero no se actualizó la caché canónica.");
  }

  async function setImagePath(variety, imagePath, operationId) {
    const companyId = activeCompanyUuid();
    const varietyId = String(variety?.id || "").trim();
    const expectedVersion = Number(variety?.__syncVersion || 0);
    if (!companyId || !varietyId || /[/\\]/.test(varietyId) || expectedVersion < 1) {
      return { ok: false, mode: "INVALID_VARIETY", message: "La variedad aún no tiene una versión canónica confirmada en Supabase." };
    }
    const backend = await probeBackend();
    if (!backend.ok || !canExecute()) return { ok: false, mode: backend.status, error: backend.error, message: backend.message };
    const deviceId = String(await BlessERP.offlineSync?.getDeviceId?.() || `WEB-${operationId.slice(0, 12)}`);
    console.info("[jaeder-catalog-command]", { flow: "VARIETY_IMAGES", rpc: "erp_set_variety_image", operationId, companyId, varietyId });
    const { data, error } = await BlessERP.getSupabaseClient().rpc("erp_set_variety_image", {
      p_company_id: companyId,
      p_variety_id: varietyId,
      p_image_path: imagePath || null,
      p_operation_id: operationId,
      p_device_id: deviceId,
      p_expected_version: expectedVersion,
      p_local_created_at: new Date().toISOString()
    });
    if (error) return { ok: false, mode: "SUPABASE_ERROR", error, message: error.message || "Supabase rechazó la imagen." };
    const serverRecord = Array.isArray(data) ? data[0] : data;
    if (!serverRecord?.record_id || serverRecord.entity !== "operations_varieties") {
      return { ok: false, mode: "INVALID_RESPONSE", message: "Supabase no devolvió la variedad canónica." };
    }
    await applyCanonicalRecord(serverRecord);
    return { ok: true, confirmed: true, serverRecord };
  }

  async function upload(variety, file, options = {}) {
    const operationId = String(options.operationId || uuid());
    const oldPath = String(variety?.imagePath || "").trim();
    const companyId = activeCompanyUuid();
    const varietyId = String(variety?.id || "").trim();
    try {
      const backend = await probeBackend();
      if (!backend.ok || !canExecute()) return { ok: false, mode: backend.status, operationId, message: backend.message };
      if (!companyId || !varietyId || /[/\\]/.test(varietyId)) throw new Error("La variedad no tiene un identificador canónico válido.");
      const optimized = await optimizeImage(file);
      const imagePath = `${companyId}/${varietyId}/main-${operationId}.webp`;
      const bucket = BlessERP.getSupabaseClient().storage.from(BUCKET);
      const { error: uploadError } = await bucket.upload(imagePath, optimized.blob, {
        cacheControl: "31536000",
        contentType: "image/webp",
        upsert: true
      });
      if (uploadError) return { ok: false, mode: "STORAGE_ERROR", operationId, error: uploadError, message: uploadError.message || "Storage rechazó la imagen." };
      const confirmed = await setImagePath(variety, imagePath, operationId);
      if (!confirmed.ok) {
        await bucket.remove([imagePath]);
        return { ...confirmed, operationId };
      }
      let cleanupWarning = "";
      if (oldPath && oldPath !== imagePath) {
        const { error: removeError } = await bucket.remove([oldPath]);
        if (removeError) cleanupWarning = "La imagen nueva quedó activa, pero el archivo anterior requiere limpieza posterior.";
        else publicUrlCache.delete(oldPath);
      }
      return { ok: true, confirmed: true, mode: "SUPABASE_CONFIRMED", operationId, imagePath,
        imageUrl: publicUrl(imagePath), optimized, cleanupWarning, serverRecord: confirmed.serverRecord };
    } catch (error) {
      return { ok: false, mode: "IMAGE_ERROR", operationId, error, message: error?.message || "No se pudo procesar la imagen." };
    }
  }

  async function remove(variety, options = {}) {
    const operationId = String(options.operationId || uuid());
    const oldPath = String(variety?.imagePath || "").trim();
    if (!oldPath) return { ok: true, confirmed: true, mode: "NO_IMAGE", operationId };
    const confirmed = await setImagePath(variety, "", operationId);
    if (!confirmed.ok) return { ...confirmed, operationId };
    const { error } = await BlessERP.getSupabaseClient().storage.from(BUCKET).remove([oldPath]);
    publicUrlCache.delete(oldPath);
    return { ok: true, confirmed: true, mode: "SUPABASE_CONFIRMED", operationId,
      cleanupWarning: error ? "La variedad quedó sin imagen, pero el archivo anterior requiere limpieza posterior." : "",
      serverRecord: confirmed.serverRecord };
  }

  const repository = Object.freeze({
    BUCKET,
    MAX_SOURCE_BYTES,
    MAX_STORED_BYTES,
    activeCompanyUuid,
    canExecute,
    configured,
    healthStatus: () => ({ ...health, available: canExecute() }),
    optimizeImage,
    probeBackend,
    publicUrl,
    remove,
    upload,
    validateImageFile
  });

  BlessERP.getVarietyImageRepository = () => repository;
})();
