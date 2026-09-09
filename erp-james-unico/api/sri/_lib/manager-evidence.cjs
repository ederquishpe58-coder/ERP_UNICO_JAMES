const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const {parseAuthorizationResponse}=require('./sri-soap.cjs');
const {SriValidationError}=require('./errors.cjs');
function parseOfficialEvidence(xml,accessKey){
 if(typeof xml!=='string'||Buffer.byteLength(xml)>2*1024*1024||/<!\s*(DOCTYPE|ENTITY)/i.test(xml))throw new SriValidationError('XML de evidencia inválido.');
 const errors=[];const doc=new DOMParser({onError:(_level,message)=>errors.push(message)}).parseFromString(xml,'application/xml');
 if(errors.length||!doc.documentElement)throw new SriValidationError('XML oficial mal formado.');
 if(doc.documentElement.localName==='autorizacion'){
  if(!/^\d{49}$/.test(accessKey)||doc.getElementsByTagName('autorizacion').length!==1)throw new SriValidationError('Autorización ambigua.');
  const body=new XMLSerializer().serializeToString(doc.documentElement);
  return parseAuthorizationResponse(`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><autorizacionComprobanteResponse><RespuestaAutorizacionComprobante><claveAccesoConsultada>${accessKey}</claveAccesoConsultada><numeroComprobantes>1</numeroComprobantes><autorizaciones>${body}</autorizaciones></RespuestaAutorizacionComprobante></autorizacionComprobanteResponse></soap:Body></soap:Envelope>`);
 }
 return parseAuthorizationResponse(xml);
}
module.exports={parseOfficialEvidence};
