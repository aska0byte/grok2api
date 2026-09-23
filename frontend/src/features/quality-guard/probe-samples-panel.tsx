import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, PowerOff, RotateCcw, RefreshCw, ShieldOff, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { updateAccountsEnabled } from "@/features/accounts/accounts-api";
import {
  deleteProbeSample,
  deleteProbeSamples,
  getProbeSample,
  listProbeSamples,
  markProbeSample,
  markProbeSamples,
  type ProbeSampleDTO,
  quarantineProbeSampleAccount,
  quarantineProbeSampleAccounts,
  restoreProbeSampleAccount,
} from "@/features/settings/settings-api";
import { ErrorState } from "@/shared/components/data-state";
import { CopyButton } from "@/shared/components/copy-button";
import { Pagination } from "@/shared/components/pagination";
import { cn } from "@/shared/lib/cn";

const CLASSIFICATIONS = ["passed", "missing", "confirmed", "overturned"] as const;
const MANUAL_FLAGS = ["none", "suspected", "normal"] as const;
const QUARANTINE_HOURS = [2, 6, 12, 24, 48, 72] as const;

// Probe output often arrives as a fenced ```svg/```html block; strip the
// fence and wrap the fragment so the drawing scales inside the iframe
// instead of overflowing or rendering the fence as literal text.
function probeSampleHTMLDoc(raw: string): string {
  let body = raw.trim();
  const opener = body.match(/^```[a-zA-Z]*[ \t]*\r?\n?/);
  if (opener) body = body.slice(opener[0].length);
  body = body.replace(/```[\s]*$/, "").trim();
  if (/<html[\s>]/i.test(body)) return body;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}svg,img,canvas,video{max-width:100%;height:auto}</style></head><body>${body}</body></html>`;
}

function classificationTone(value: string): "good" | "bad" | "warn" | "muted" {
  switch (value) {
    case "passed":
      return "good";
    case "overturned":
      return "warn";
    case "missing":
    case "confirmed":
      return "bad";
    default:
      return "muted";
  }
}

function classificationBadgeVariant(value: string): "secondary" | "destructive" | "outline" {
  const tone = classificationTone(value);
  if (tone === "good") return "secondary";
  if (tone === "bad") return "destructive";
  return "outline";
}

function formatTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, { hour12: false });
}

function formatTPS(value: number): string {
  return value > 0 ? `${value.toFixed(1)} tok/s` : "-";
}

function AccountActionsMenu({ accountId, busy, onQuarantine, onDisable, onRestore }: {
  accountId: string;
  busy: boolean;
  onQuarantine: (accountId: string, hours: number) => void;
  onDisable: (accountId: string) => void;
  onRestore: (accountId: string) => void;
}) {
  const { t } = useTranslation();
  const enabled = accountId !== "" && accountId !== "0";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={!enabled || busy}>
          <MoreHorizontal className="size-3.5" />
          {t("qualityGuard.samples.accountAction")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ShieldOff className="mr-2 size-3.5" />
            {t("qualityGuard.samples.quarantine")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {QUARANTINE_HOURS.map((hours) => (
              <DropdownMenuItem key={hours} onClick={() => onQuarantine(accountId, hours)}>
                {t("qualityGuard.samples.quarantineHours", { hours })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={() => onDisable(accountId)}>
          <PowerOff className="mr-2 size-3.5" />
          {t("common.disable")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onRestore(accountId)}>
          <RotateCcw className="mr-2 size-3.5" />
          {t("qualityGuard.samples.restore")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProbeSamplesPanel() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [classification, setClassification] = useState("all");
  const [kind, setKind] = useState("all");
  const [manualFlag, setManualFlag] = useState("all");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [selected, setSelected] = useState<ProbeSampleDTO | null>(null);
  const [detailView, setDetailView] = useState<"preview" | "source">("preview");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [sampleAccounts, setSampleAccounts] = useState<Record<string, string>>({});

  const listQuery = useQuery({
    queryKey: ["quality-guard-probe-samples", page, pageSize, classification, kind, manualFlag, search],
    queryFn: () => listProbeSamples({
      page, pageSize,
      classification: classification === "all" ? undefined : classification,
      kind: kind === "all" ? undefined : kind,
      manualFlag: manualFlag === "all" ? undefined : manualFlag,
      search: search || undefined,
    }),
    refetchInterval: 30_000,
  });
  const detailQuery = useQuery({
    queryKey: ["quality-guard-probe-sample", selected?.id],
    queryFn: () => getProbeSample(selected!.id),
    enabled: selected !== null,
  });

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;

  useEffect(() => {
    const data = listQuery.data;
    if (!data || data.items.length === 0) return;
    setSampleAccounts((previous) => {
      let changed = false;
      const updated = { ...previous };
      data.items.forEach((sample) => {
        const value = sample.accountId ?? "";
        if (updated[sample.id] !== value) {
          updated[sample.id] = value;
          changed = true;
        }
      });
      return changed ? updated : previous;
    });
  }, [listQuery.data]);

  const toggleChecked = (id: string, next: boolean) => {
    setChecked((previous) => {
      const updated = new Set(previous);
      if (next) updated.add(id); else updated.delete(id);
      return updated;
    });
  };

  const mark = async (id: string, flag: "" | "suspected" | "normal") => {
    setBusy(true);
    try {
      await markProbeSample(id, flag);
      await listQuery.refetch();
      if (selected?.id === id) await detailQuery.refetch();
    } finally {
      setBusy(false);
    }
  };

  const markChecked = async (flag: "suspected" | "normal") => {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await markProbeSamples(ids, flag);
      setChecked(new Set());
      await listQuery.refetch();
    } finally {
      setBusy(false);
    }
  };

  const afterAccountAction = async () => {
    await listQuery.refetch();
    if (selected) await detailQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
  };

  const checkedAccountIds = (() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    checked.forEach((sampleId) => {
      const id = (sampleAccounts[sampleId] ?? "").trim();
      if (id === "" || id === "0" || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });
    return ids;
  })();

  const quarantineAccounts = async (hours: number) => {
    const ids = checkedAccountIds;
    if (ids.length === 0) return;
    if (!window.confirm(t("qualityGuard.samples.batchQuarantineConfirm", { count: ids.length, hours }))) return;
    setBusy(true);
    try {
      const result = await quarantineProbeSampleAccounts(ids, hours);
      toast.success(t("qualityGuard.samples.batchQuarantined", { count: result.quarantined.length, missing: result.missing.length }));
      await afterAccountAction();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("qualityGuard.samples.accountActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const disableAccounts = async () => {
    const ids = checkedAccountIds;
    if (ids.length === 0) return;
    if (!window.confirm(t("qualityGuard.samples.batchDisableConfirm", { count: ids.length }))) return;
    setBusy(true);
    try {
      await updateAccountsEnabled(ids, false, "grok_build");
      toast.success(t("qualityGuard.samples.batchDisabled", { count: ids.length }));
      await afterAccountAction();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("qualityGuard.samples.accountActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const quarantineAccount = async (accountId: string, hours: number) => {
    if (!window.confirm(t("qualityGuard.samples.quarantineConfirm", { hours }))) return;
    setBusy(true);
    try {
      await quarantineProbeSampleAccount(accountId, hours);
      toast.success(t("qualityGuard.samples.quarantined", { hours }));
      await afterAccountAction();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("qualityGuard.samples.accountActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const disableAccount = async (accountId: string) => {
    if (!window.confirm(t("qualityGuard.samples.disableConfirm"))) return;
    setBusy(true);
    try {
      await updateAccountsEnabled([accountId], false, "grok_build");
      toast.success(t("qualityGuard.samples.disabled"));
      await afterAccountAction();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("qualityGuard.samples.accountActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const restoreAccount = async (accountId: string) => {
    if (!window.confirm(t("qualityGuard.samples.restoreConfirm"))) return;
    setBusy(true);
    try {
      await restoreProbeSampleAccount(accountId);
      toast.success(t("qualityGuard.samples.restored"));
      await afterAccountAction();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("qualityGuard.samples.accountActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const removeOne = async (id: string) => {
    if (!window.confirm(t("qualityGuard.samples.deleteSampleConfirm"))) return;
    setBusy(true);
    try {
      await deleteProbeSample(id);
      setChecked((previous) => {
        const updated = new Set(previous);
        updated.delete(id);
        return updated;
      });
      setSelected(null);
      await listQuery.refetch();
    } finally {
      setBusy(false);
    }
  };

  const removeChecked = async () => {
    const ids = [...checked];
    if (ids.length === 0) return;
    if (!window.confirm(t("qualityGuard.samples.deleteSelectedConfirm", { count: ids.length }))) return;
    setBusy(true);
    try {
      await deleteProbeSamples(ids);
      setChecked(new Set());
      if (selected !== null && ids.includes(selected.id)) setSelected(null);
      await listQuery.refetch();
    } finally {
      setBusy(false);
    }
  };

  const selectAllPages = async () => {
    setBusy(true);
    try {
      const ids = new Set(checked);
      const accounts: Record<string, string> = {};
      for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
        const result = await listProbeSamples({
          page: pageNumber, pageSize: 200,
          classification: classification === "all" ? undefined : classification,
          kind: kind === "all" ? undefined : kind,
          manualFlag: manualFlag === "all" ? undefined : manualFlag,
          search: search || undefined,
        });
        result.items.forEach((sample) => {
          ids.add(sample.id);
          accounts[sample.id] = sample.accountId ?? "";
        });
        if (result.items.length < 200) break;
      }
      setChecked(ids);
      setSampleAccounts((previous) => ({ ...previous, ...accounts }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg bg-card" aria-labelledby="probe-samples-title">
        <div className="flex flex-col gap-2 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 id="probe-samples-title" className="text-sm font-medium">{t("qualityGuard.samples.title")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("qualityGuard.samples.help")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
            <Checkbox
              checked={items.length > 0 && items.every((sample) => checked.has(sample.id)) ? true : items.some((sample) => checked.has(sample.id)) ? "indeterminate" : false}
              disabled={items.length === 0}
              onCheckedChange={(next) => {
                setChecked((previous) => {
                  const updated = new Set(previous);
                  items.forEach((sample) => {
                    if (next === true) updated.add(sample.id); else updated.delete(sample.id);
                  });
                  return updated;
                });
              }}
              aria-label={t("qualityGuard.samples.selectAll")}
            />
            <Input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setSearch(searchDraft.trim());
                  setPage(1);
                }
              }}
              placeholder={t("qualityGuard.samples.searchPlaceholder")}
              className="h-8 w-44 text-xs"
            />
            <Select value={classification} onValueChange={(value) => { setClassification(value); setPage(1); }}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("qualityGuard.samples.classificationAll")}</SelectItem>
                {CLASSIFICATIONS.map((value) => (
                  <SelectItem key={value} value={value}>{t(`qualityGuard.samples.classification.${value}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kind} onValueChange={(value) => { setKind(value); setPage(1); }}>
              <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("qualityGuard.samples.kind")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("qualityGuard.samples.kindAll")}</SelectItem>
                <SelectItem value="text">{t("qualityGuard.samples.kindText")}</SelectItem>
                <SelectItem value="html">{t("qualityGuard.samples.kindHTML")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={manualFlag} onValueChange={(value) => { setManualFlag(value); setPage(1); }}>
              <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("qualityGuard.samples.manualFilter")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("qualityGuard.samples.manualAll")}</SelectItem>
                {MANUAL_FLAGS.map((value) => (
                  <SelectItem key={value} value={value}>{t(`qualityGuard.samples.manual.${value}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => void listQuery.refetch()}
              disabled={listQuery.isFetching}
              aria-label={t("common.refresh")}
              title={t("common.refresh")}
            >
              <RefreshCw className={cn("size-4", listQuery.isFetching && "animate-spin")} />
            </Button>
            {checked.size > 0 ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
                  onClick={() => void markChecked("suspected")}
                  disabled={busy}
                >
                  {t("qualityGuard.samples.manual.suspected")} ({checked.size})
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8"
                  onClick={() => void markChecked("normal")}
                  disabled={busy}
                >
                  {t("qualityGuard.samples.manual.normal")} ({checked.size})
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
                  onClick={() => void removeChecked()}
                  disabled={busy}
                >
                  <Trash2 className="size-3.5" />
                  {t("qualityGuard.samples.batchDelete")} ({checked.size})
                </Button>
              </>
            ) : null}
            {checked.size > 0 && checked.size < total ? (
              <Button type="button" variant="secondary" size="sm" className="h-8" onClick={() => void selectAllPages()} disabled={busy}>
                {t("qualityGuard.samples.selectAllPages")} ({total})
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" size="sm" className="h-8" disabled={busy || checkedAccountIds.length === 0}>
                  {t("qualityGuard.samples.batchQuarantine")} ({checkedAccountIds.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {QUARANTINE_HOURS.map((hours) => (
                  <DropdownMenuItem key={hours} onClick={() => void quarantineAccounts(hours)}>
                    {t("qualityGuard.samples.quarantineHours", { hours })}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
              onClick={() => void disableAccounts()}
              disabled={busy || checkedAccountIds.length === 0}
            >
              <ShieldOff className="size-3.5" />
              {t("qualityGuard.samples.batchDisable")} ({checkedAccountIds.length})
            </Button>
          </div>
        </div>

        {listQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground">
            <Spinner className="size-4" />{t("common.loading")}
          </div>
        ) : listQuery.isError ? (
          <div className="px-4 py-8"><ErrorState message={t("qualityGuard.samples.loadFailed")} onRetry={() => void listQuery.refetch()} /></div>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">{t("qualityGuard.samples.empty")}</div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3 sm:px-5">
            {items.map((sample) => {
              const isHTML = sample.kind === "html";
              return (
                <div
                  key={sample.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => { setSelected(sample); setDetailView("preview"); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(sample);
                      setDetailView("preview");
                    }
                  }}
                  className={cn(
                    "relative flex h-full cursor-pointer flex-col gap-2 rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40",
                    checked.has(sample.id) && "border-primary/60 bg-accent/30",
                  )}
                >
                  <div
                    className="absolute right-2.5 top-2.5"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      checked={checked.has(sample.id)}
                      onCheckedChange={(next) => toggleChecked(sample.id, next === true)}
                      aria-label={t("qualityGuard.samples.selectSample", { id: sample.id })}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pr-6">
                    <Badge variant={classificationBadgeVariant(sample.classification)}>
                      {t(`qualityGuard.samples.classification.${sample.classification}`)}
                    </Badge>
                    {sample.manualFlag === "suspected" ? (
                      <Badge variant="destructive">{t("qualityGuard.samples.manual.suspected")}</Badge>
                    ) : sample.manualFlag === "normal" ? (
                      <Badge variant="secondary">{t("qualityGuard.samples.manual.normal")}</Badge>
                    ) : null}
                    {sample.action ? (
                      <Badge variant="outline" className="text-destructive">{t(`qualityGuard.samples.action.${sample.action}`)}</Badge>
                    ) : null}
                    <Badge variant="outline" className="text-muted-foreground">
                      {sample.round === 2 ? t("qualityGuard.samples.roundConfirm") : t("qualityGuard.samples.roundInitial")}
                    </Badge>
                    <Badge variant="outline" className="text-muted-foreground">
                      {sample.source === "scheduled" ? t("qualityGuard.samples.sourceScheduled") : t("qualityGuard.samples.sourceManual")}
                    </Badge>
                    {isHTML ? (
                      <Badge variant="outline" className="text-muted-foreground">{t("qualityGuard.samples.kindHTML")}</Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                    <span className="font-medium">{sample.accountName || sample.accountId}</span>
                    <span className="text-muted-foreground">{sample.egressNodeName || sample.egressNodeId}</span>
                    <span className="text-muted-foreground">{formatTPS(sample.outputTokensPerSecond)}</span>
                    <span className="ml-auto text-muted-foreground">{formatTime(sample.createdAt, i18n.language)}</span>
                  </div>
                  <div className="flex items-center gap-1.5" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    <Button
                      type="button"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      variant={sample.manualFlag === "suspected" ? "destructive" : "outline"}
                      disabled={busy}
                      onClick={() => void mark(sample.id, sample.manualFlag === "suspected" ? "" : "suspected")}
                    >
                      {t("qualityGuard.samples.manual.suspected")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      variant={sample.manualFlag === "normal" ? "secondary" : "outline"}
                      disabled={busy}
                      onClick={() => void mark(sample.id, sample.manualFlag === "normal" ? "" : "normal")}
                    >
                      {t("qualityGuard.samples.manual.normal")}
                    </Button>
                    <AccountActionsMenu
                      accountId={sample.accountId}
                      busy={busy}
                      onQuarantine={(accountId, hours) => void quarantineAccount(accountId, hours)}
                      onDisable={(accountId) => void disableAccount(accountId)}
                      onRestore={(accountId) => void restoreAccount(accountId)}
                    />
                  </div>
                  {isHTML ? (
                    <iframe
                      title={`probe-sample-${sample.id}`}
                      sandbox=""
                      srcDoc={probeSampleHTMLDoc(sample.visiblePreview)}
                      className="pointer-events-none h-48 w-full rounded-md border bg-white"
                      loading="lazy"
                    />
                  ) : (
                    <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                      {sample.visiblePreview || t("qualityGuard.samples.noOutput")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {total > 0 ? (
          <div className="border-t px-4 py-2 sm:px-5">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
              pageSizeOptions={[20, 50, 100]}
            />
          </div>
        ) : null}
      </section>

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("qualityGuard.samples.detailTitle")}</DialogTitle>
            <DialogDescription>
              {selected ? `${selected.accountName || selected.accountId} · ${selected.egressNodeName || selected.egressNodeId} · ${formatTime(selected.createdAt, i18n.language)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {detailQuery.data ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={classificationBadgeVariant(detailQuery.data.classification)}>
                  {t(`qualityGuard.samples.classification.${detailQuery.data.classification}`)}
                </Badge>
                {detailQuery.data.action ? (
                  <Badge variant="outline" className="text-destructive">{t(`qualityGuard.samples.action.${detailQuery.data.action}`)}</Badge>
                ) : null}
                <Badge variant="outline">{detailQuery.data.model}</Badge>
                <span className="text-xs text-muted-foreground">{formatTPS(detailQuery.data.outputTokensPerSecond)} · {t("qualityGuard.samples.firstToken", { ms: detailQuery.data.firstTokenMs })} · {t("qualityGuard.samples.duration", { ms: detailQuery.data.durationMs })}</span>
              </div>
              <section className="space-y-1.5 rounded-md border p-3">
                <h3 className="text-xs font-medium text-muted-foreground">{t("qualityGuard.samples.manualTitle")}</h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={detailQuery.data.manualFlag === "suspected" ? "destructive" : "secondary"}
                    disabled={busy}
                    onClick={() => void mark(detailQuery.data.id, detailQuery.data.manualFlag === "suspected" ? "" : "suspected")}
                  >
                    {t("qualityGuard.samples.manual.suspected")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void mark(detailQuery.data.id, detailQuery.data.manualFlag === "normal" ? "" : "normal")}
                  >
                    {t("qualityGuard.samples.manual.normal")}
                  </Button>
                  {detailQuery.data.manualFlag ? (
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void mark(detailQuery.data.id, "")}>
                      {t("qualityGuard.samples.manual.clear")}
                    </Button>
                  ) : null}
                  <AccountActionsMenu
                    accountId={detailQuery.data.accountId}
                    busy={busy}
                    onQuarantine={(accountId, hours) => void quarantineAccount(accountId, hours)}
                    onDisable={(accountId) => void disableAccount(accountId)}
                    onRestore={(accountId) => void restoreAccount(accountId)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    onClick={() => void removeOne(detailQuery.data.id)}
                  >
                    <Trash2 className="size-3.5" />
                    {t("qualityGuard.samples.deleteSample")}
                  </Button>
                </div>
              </section>
              <section className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {detailQuery.data.kind === "html"
                      ? t("qualityGuard.samples.htmlCard")
                      : t("qualityGuard.samples.response")}
                    {detailQuery.data.visibleTruncated ? ` (${t("qualityGuard.samples.truncated")})` : ""}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    {detailQuery.data.kind === "html" ? (
                      <div className="flex rounded-md border text-xs">
                        <button
                          type="button"
                          className={cn("rounded-l-md px-2 py-1", detailView === "preview" ? "bg-accent font-medium" : "text-muted-foreground")}
                          onClick={() => setDetailView("preview")}
                        >
                          {t("qualityGuard.samples.preview")}
                        </button>
                        <button
                          type="button"
                          className={cn("rounded-r-md px-2 py-1", detailView === "source" ? "bg-accent font-medium" : "text-muted-foreground")}
                          onClick={() => setDetailView("source")}
                        >
                          {t("qualityGuard.samples.sourceCode")}
                        </button>
                      </div>
                    ) : null}
                    <CopyButton value={detailQuery.data.visibleText} />
                  </div>
                </div>
                {detailQuery.data.kind === "html" && detailView === "preview" ? (
                  <iframe
                    title="probe-sample-detail"
                    sandbox=""
                    srcDoc={probeSampleHTMLDoc(detailQuery.data.visibleText)}
                    className="h-[32rem] w-full rounded-md border bg-white"
                  />
                ) : (
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-relaxed">{detailQuery.data.visibleText || t("qualityGuard.samples.noOutput")}</pre>
                )}
              </section>
              {detailQuery.data.reasoningText ? (
                <section className="space-y-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-medium text-muted-foreground">{t("qualityGuard.samples.reasoning")}{detailQuery.data.reasoningTruncated ? ` (${t("qualityGuard.samples.truncated")})` : ""}</h3>
                    <CopyButton value={detailQuery.data.reasoningText} />
                  </div>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-relaxed">{detailQuery.data.reasoningText}</pre>
                </section>
              ) : null}
              <p className="break-all font-mono text-[10px] text-muted-foreground">{detailQuery.data.requestId}</p>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner className="size-4" />{t("common.loading")}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
