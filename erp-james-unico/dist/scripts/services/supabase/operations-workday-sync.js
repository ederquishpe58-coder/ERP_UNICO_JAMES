(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};
  let membershipCache = null;

  function isEnabled() {
    return Boolean(BlessERP.canUseSupabaseModule?.("operations")?.enabled && BlessERP.getSupabaseClient?.());
  }

  async function companyContext(client) {
    if (membershipCache) return membershipCache;
    const { data: userResult, error: userError } = await client.auth.getUser();
    if (userError || !userResult?.user?.id) throw new Error("No existe una sesion Supabase autenticada para sincronizar la jornada.");
    const { data, error } = await client
      .from("sri_company_memberships")
      .select("company_id")
      .eq("auth_user_id", userResult.user.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data?.company_id) throw new Error("El usuario no tiene una empresa habilitada en Supabase.");
    membershipCache = { companyId: data.company_id, userId: userResult.user.id };
    return membershipCache;
  }

  function toIso(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return null;
    const date = new Date(normalized.includes("T") ? normalized : normalized.replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  async function sync(workday) {
    if (!isEnabled()) return { ok: true, skipped: true, mode: "LOCAL" };
    const client = BlessERP.getSupabaseClient();
    try {
      const context = await companyContext(client);
      const summary = workday.summary || {};
      const payload = {
        company_id: context.companyId,
        client_ref: workday.id,
        work_date: workday.date,
        status: workday.status,
        started_at: toIso(workday.startedAt),
        paused_at: toIso(workday.pausedAt),
        resumed_at: toIso(workday.resumedAt),
        ended_at: toIso(workday.endedAt),
        total_paused_seconds: Math.round((summary.pausedDurationMs || workday.totalPausedMs || 0) / 1000),
        active_seconds: Math.round((summary.activeDurationMs || 0) / 1000),
        summary,
        started_by: context.userId,
        closed_by: workday.status === "FINALIZADA" ? context.userId : null
      };
      const { data, error } = await client
        .from("operations_workdays")
        .upsert(payload, { onConflict: "company_id,client_ref" })
        .select("id")
        .single();
      if (error) throw error;

      if (Array.isArray(workday.pauses)) {
        const { error: deleteError } = await client
          .from("operations_workday_pauses")
          .delete()
          .eq("company_id", context.companyId)
          .eq("workday_id", data.id);
        if (deleteError) throw deleteError;
        if (workday.pauses.length) {
          const pauses = workday.pauses.map((pause, index) => ({
            company_id: context.companyId,
            workday_id: data.id,
            sequence_number: index + 1,
            paused_at: toIso(pause.pausedAt),
            resumed_at: toIso(pause.resumedAt),
            duration_seconds: Math.round((pause.durationMs || 0) / 1000),
            created_by: context.userId
          }));
          const { error: pauseError } = await client.from("operations_workday_pauses").insert(pauses);
          if (pauseError) throw pauseError;
        }
      }
      return { ok: true, skipped: false, cloudId: data.id };
    } catch (error) {
      return { ok: false, skipped: false, error: error?.message || String(error) };
    }
  }

  BlessERP.operationsWorkdayCloudSync = { isEnabled, sync };
})();
