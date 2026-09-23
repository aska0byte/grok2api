import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ErrorState } from "@/shared/components/data-state";
import { listAccounts, probeAccountsQualityBatch } from "@/features/accounts/accounts-api";

const FETCH_PAGE_SIZE = 2000;
const MAX_PAGES = 50;
const PREPARING_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 4;

type ProbeProgress = { done: number; total: number; missing: number; disabled: number; overturned: number; failed: number };

const emptyProgress = (): ProbeProgress => ({ done: 0, total: 0, missing: 0, disabled: 0, overturned: 0, failed: 0 });

function clampConcurrency(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.trunc(value)));
}

export type QualityProbeAccountFilters = {
  search?: string;
  type?: string;
  status?: string;
  egress?: string;
};

// QualityProbeDialog runs real reasoning requests against selected/all build
// accounts (bound long-lived nodes only) with a user-chosen concurrency, and
// reports missing-thinking verdicts live. The pinned operator probe bypasses
// cooldown/quota/auth scheduling gates, so disabled and cooling accounts can
// be re-verified; only deleted accounts are rejected by the backend.
export function QualityProbeDialog({ open, onOpenChange, mode, selectedIds, filters, onInvalidate }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "selected" | "all";
  selectedIds?: string[];
  filters?: QualityProbeAccountFilters;
  onInvalidate?: () => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<"preparing" | "ready" | "running" | "done">("ready");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  const [kind, setKind] = useState<"text" | "html">("text");
  const [progress, setProgress] = useState<ProbeProgress>(emptyProgress);
  const [firstError, setFirstError] = useState("");
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const filtersRef = useRef<QualityProbeAccountFilters | undefined>(filters);
  filtersRef.current = filters;

  useEffect(() => {
    if (!open) return;
    setFirstError("");
    setProgress(emptyProgress());
    setConcurrency(DEFAULT_CONCURRENCY);
    setKind("text");
    if (mode === "selected") {
      setTargetIds(selectedIds ?? []);
      setSkipped(0);
      setLoadError("");
      setPhase("ready");
      return;
    }
    let cancelled = false;
    const loadController = new AbortController();
    setLoadProgress(null);
    setPhase("preparing");
    void (async () => {
      try {
        const ids: string[] = [];
        let skippedCount = 0;
        let total = -1;
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const timeout = setTimeout(() => loadController.abort(), PREPARING_TIMEOUT_MS);
          const result = await listAccounts({ page, pageSize: FETCH_PAGE_SIZE, provider: "grok_build", ...filtersRef.current }, loadController.signal);
          clearTimeout(timeout);
          if (total < 0) {
            total = result.total;
            setLoadProgress({ loaded: 0, total });
          }
          for (const account of result.items) {
            if (!account.enabled || !account.egressNodeId) {
              skippedCount += 1;
              continue;
            }
            ids.push(account.id);
          }
          setLoadProgress({ loaded: ids.length, total });
          if (result.items.length < FETCH_PAGE_SIZE) break;
        }
        if (cancelled) return;
        setTargetIds(ids);
        setSkipped(skippedCount);
        setLoadError("");
        setPhase("ready");
      } catch (error) {
        if (cancelled) return;
        setLoadError(loadController.signal.aborted ? t("accounts.qualityProbePreparingTimeout") : error instanceof Error ? error.message : String(error));
        setPhase("ready");
      }
    })();
    return () => {
      cancelled = true;
      loadController.abort();
    };
  }, [open, mode, selectedIds, reloadKey, t]);

  const start = () => {
    const ids = targetIds;
    if (ids.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setFirstError("");
    setProgress({ ...emptyProgress(), total: ids.length });
    setPhase("running");
    const counters: ProbeProgress = { done: 0, total: ids.length, missing: 0, disabled: 0, overturned: 0, failed: 0 };
    let firstErrorMessage = "";
    probeAccountsQualityBatch({ ids, kind, concurrency }, {
      onProgress: (value) => {
        if (value.completed > counters.done) counters.done = value.completed;
        setProgress({ ...counters });
      },
      onItem: (item) => {
        if (item.outcome === "failed") {
          counters.failed += 1;
          if (!firstErrorMessage) {
            firstErrorMessage = item.reason ?? "";
            setFirstError(firstErrorMessage);
          }
        } else {
          if (item.missingThinking) counters.missing += 1;
          if (item.action === "disabled") counters.disabled += 1;
          if (item.overturned) counters.overturned += 1;
        }
        setProgress({ ...counters });
      },
    }, controller.signal).then(() => {
      setPhase("done");
      onInvalidate?.();
    }).catch((error) => {
      if (controller.signal.aborted) {
        setFirstError(t("accounts.qualityProbeCancelled", { done: counters.done, total: ids.length }));
        setPhase("ready");
        onInvalidate?.();
        return;
      }
      setFirstError(error instanceof Error ? error.message : String(error));
      setPhase("done");
      onInvalidate?.();
    });
  };

  const running = phase === "running";
  return (
    <Dialog open={open} onOpenChange={(next) => { if (running) return; onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("accounts.qualityProbeTitle")}</DialogTitle>
          <DialogDescription>{t("accounts.qualityProbeDescription")}</DialogDescription>
        </DialogHeader>
        {phase === "preparing" ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><Spinner className="size-4" />{loadProgress ? t("accounts.qualityProbePreparing", { loaded: loadProgress.loaded, total: loadProgress.total }) : t("common.loading")}</div>
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={() => setReloadKey((key) => key + 1)} />
        ) : (
          <>
            <div className="rounded-md border p-3 text-sm">
              <span>{t("accounts.qualityProbeTargetSummary", { count: targetIds.length, skipped })}</span>
              {mode === "selected" ? <p className="mt-1 text-xs text-muted-foreground">{t("accounts.qualityProbeSelectedNote")}</p> : null}
              {mode === "all" && (() => { const value = filtersRef.current ?? {}; return Boolean(value.search || value.type || value.status || value.egress); })() ? <p className="mt-1 text-xs text-muted-foreground">{t("accounts.qualityProbeFilteredNote")}</p> : null}
            </div>
            {phase === "ready" ? (
              <div className="grid gap-2">
                <div className="grid gap-2">
                  <Label htmlFor="quality-probe-kind">{t("accounts.qualityProbeKind")}</Label>
                  <Select value={kind} onValueChange={(value) => setKind(value === "html" ? "html" : "text")}>
                    <SelectTrigger id="quality-probe-kind"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">{t("accounts.qualityProbeKindText")}</SelectItem>
                      <SelectItem value="html">{t("accounts.qualityProbeKindHTML")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("accounts.qualityProbeKindHelp")}</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="quality-probe-concurrency">{t("accounts.qualityProbeConcurrency")}</Label>
                  <Input
                    id="quality-probe-concurrency"
                    type="number"
                    min={1}
                    max={MAX_CONCURRENCY}
                    value={concurrency}
                    onChange={(event) => setConcurrency(clampConcurrency(Number(event.target.value)))}
                  />
                  <p className="text-xs text-muted-foreground">{t("accounts.qualityProbeConcurrencyHelp")}</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 text-sm">
                <div className="flex items-center gap-2">
                  {running ? <Spinner className="size-4" /> : null}
                  <span>{t("accounts.qualityProbeProgress", { done: progress.done, total: progress.total })}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-md border p-2"><div className="font-medium text-destructive">{progress.missing}</div><div className="text-muted-foreground">{t("accounts.qualityProbeStatMissing")}</div></div>
                  <div className="rounded-md border p-2"><div className="font-medium">{progress.disabled}</div><div className="text-muted-foreground">{t("accounts.qualityProbeStatDisabled")}</div></div>
                  <div className="rounded-md border p-2"><div className="font-medium text-amber-600">{progress.overturned}</div><div className="text-muted-foreground">{t("accounts.qualityProbeStatOverturned")}</div></div>
                  <div className="rounded-md border p-2"><div className="font-medium text-destructive">{progress.failed}</div><div className="text-muted-foreground">{t("accounts.qualityProbeStatFailed")}</div></div>
                </div>
                {firstError ? <p className="text-xs text-destructive">{firstError}</p> : null}
              </div>
            )}
          </>
        )}
        <DialogFooter>
          {running ? (
            <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()}>{t("accounts.qualityProbeStop")}</Button>
          ) : phase === "done" ? (
            <Button type="button" onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
              <Button type="button" disabled={phase === "preparing" || targetIds.length === 0 || !!loadError} onClick={() => void start()}>{t("accounts.qualityProbeStart")}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
