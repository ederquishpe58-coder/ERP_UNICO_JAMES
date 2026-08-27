(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  function creatorUser() {
    return null;
  }

  BlessERP.initialAccess = Object.freeze({
    creatorUser,
    configured: false
  });
})();
