const { createHash } = require("node:crypto");
const { SriConfigurationError } = require("./errors.cjs");

const FILE_META = Object.freeze({
  SOURCE_JSON: ["json", "application/json"],
  UNSIGNED_XML: ["xml", "application/xml"],
  XSD_REPORT: ["json", "application/json"],
  SIGNED_XML: ["xml", "application/xml"],
  RECEPTION_RESPONSE: ["xml", "application/xml"],
  AUTHORIZATION_RESPONSE: ["xml", "application/xml"],
  AUTHORIZED_XML: ["xml", "application/xml"],
  RIDE_PDF: ["pdf", "application/pdf"],
  CANCELLATION_RESPONSE: ["xml", "application/xml"]
});

function asBuffer(content) {
  return Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ""), "utf8");
}

function sha256(content) {
  return createHash("sha256").update(asBuffer(content)).digest("hex");
}

function duplicateStorageError(error) {
  return Number(error?.statusCode) === 409 || /already exists|duplicate/i.test(String(error?.message || ""));
}

async function storeArtifact(client, options) {
  const [extension, contentType] = FILE_META[options.fileType] || [];
  if (!extension) throw new SriConfigurationError(`Tipo de archivo SRI no soportado: ${options.fileType}`);
  const buffer = asBuffer(options.content);
  const hash = sha256(buffer);
  const bucket = options.bucket || "sri-private";
  const path = [
    "companies", options.companyId, "documents", options.documentId,
    `${options.fileType.toLowerCase()}-${hash}.${extension}`
  ].join("/");

  const { error: uploadError } = await client.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: false,
    cacheControl: "private, no-store"
  });
  if (uploadError && !duplicateStorageError(uploadError)) throw uploadError;

  const row = {
    company_id: options.companyId,
    document_id: options.documentId,
    file_type: options.fileType,
    storage_bucket: bucket,
    storage_object_path: path,
    content_type: contentType,
    content_sha256: hash,
    size_bytes: buffer.length,
    schema_version: options.schemaVersion || null,
    immutable: true,
    created_by: options.createdBy || null
  };
  const { data, error } = await client
    .from("electronic_document_files")
    .upsert(row, { onConflict: "document_id,file_type,content_sha256", ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data || row;
}

async function loadArtifact(client, documentId, fileType) {
  const { data: file, error } = await client
    .from("electronic_document_files")
    .select("*")
    .eq("document_id", documentId)
    .eq("file_type", fileType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!file) throw new SriConfigurationError(`No existe el archivo ${fileType} del comprobante.`);
  const { data: blob, error: downloadError } = await client.storage
    .from(file.storage_bucket)
    .download(file.storage_object_path);
  if (downloadError) throw downloadError;
  return { file, buffer: Buffer.from(await blob.arrayBuffer()) };
}

module.exports = {
  FILE_META,
  sha256,
  storeArtifact,
  loadArtifact
};
