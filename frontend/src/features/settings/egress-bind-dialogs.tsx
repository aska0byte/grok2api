import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { listAllEgressNodes, listEgressNodeAccounts, rebalanceEgressAccounts, type EgressNodeDTO, type EgressRebalanceNodeStatsDTO, type EgressRebalanceResultDTO } from "@/features/settings/settings-api";
import { ErrorState, TableLoadingRow } from "@/shared/components/data-state";

export function computeRebalanceNodeStats(nodes: EgressNodeDTO[]): EgressRebalanceNodeStatsDTO {
  const stats: EgressRebalanceNodeStatsDTO = { total: 0, healthy: 0, unprobed: 0, unhealthy: 0, cooldown: 0, disabled: 0 };
  const now = Date.now();
  for (const node of nodes) {
    if (node.usage !== "production") continue;
    stats.total += 1;
    if (!node.enabled) {
      stats.disabled += 1;
      continue;
    }
    if (node.probeStatus === "healthy") stats.healthy += 1;
    else if (node.probeStatus === "unhealthy") stats.unhealthy += 1;
    else stats.unprobed += 1;
    if (node.cooldownUntil && new Date(node.cooldownUntil).getTime() > now) stats.cooldown += 1;
  }
  return stats;
}

export function useRebalanceStats(enabled: boolean): { stats?: EgressRebalanceNodeStatsDTO; isLoading: boolean; isError: boolean; refetch: () => void } {
  const query = useQuery({
    queryKey: ["egress-rebalance-stats"],
    queryFn: () => listAllEgressNodes({ usage: "production" }),
    enabled,
    staleTime: 10_000,
  });
  return { stats: query.data ? computeRebalanceNodeStats(query.data.items) : undefined, isLoading: query.isLoading, isError: query.isError, refetch: () => void query.refetch() };
}

export function useAutoBind(onBound: (result: EgressRebalanceResultDTO) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rebalanceEgressAccounts,
    onSuccess: (value) => {
      void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
      void queryClient.invalidateQueries({ queryKey: ["quality-guard-egress-nodes"] });
      onBound(value);
    },
  });
}

export function RebalanceConfirmDialog({ open, onOpenChange, stats, isLoading, isError, onRetry, pending, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats?: EgressRebalanceNodeStatsDTO;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.egress.autoBindConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("settings.egress.autoBindConfirmDescription")}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground"><Spinner className="mr-2 size-4" />{t("common.loading")}</div>
        ) : isError || !stats ? (
          <ErrorState message={t("settings.egress.operationFailed")} onRetry={onRetry} />
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <StatBox label={t("settings.egress.autoBindStatTotal")} value={stats.total} />
            <StatBox label={t("settings.egress.healthy")} value={stats.healthy} tone="good" />
            <StatBox label={t("settings.egress.notTested")} value={stats.unprobed} tone="warn" />
            <StatBox label={t("settings.egress.unhealthy")} value={stats.unhealthy} tone="bad" />
            <StatBox label={t("settings.egress.autoBindStatCooldown")} value={stats.cooldown} tone="warn" />
            <StatBox label={t("common.disabled")} value={stats.disabled} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("settings.egress.autoBindConfirmNote")}</p>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button type="button" disabled={pending || isError} onClick={onConfirm}>{pending ? <Spinner className="mr-1.5 size-4" /> : null}{t("settings.egress.autoBind")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatBox({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="rounded-md border p-2">
      <p className={cnStatTone(tone)}>{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={label}>{label}</p>
    </div>
  );
}

function cnStatTone(tone?: "good" | "bad" | "warn") {
  if (tone === "good") return "text-lg font-medium tabular-nums text-emerald-600 dark:text-emerald-400";
  if (tone === "bad") return "text-lg font-medium tabular-nums text-destructive";
  if (tone === "warn") return "text-lg font-medium tabular-nums text-amber-600 dark:text-amber-400";
  return "text-lg font-medium tabular-nums";
}

export function RebalanceResultDialog({ result, onClose }: { result: EgressRebalanceResultDTO | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={result !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.egress.autoBindResultTitle")}</DialogTitle>
          <DialogDescription>{result ? t("settings.egress.autoBindResultSummary", { assigned: result.assigned, rebalanced: result.rebalanced, released: result.released, unplaced: result.unplaced }) : ""}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <StatBox label={t("settings.egress.autoBindStatAssigned")} value={result.assigned} tone="good" />
            <StatBox label={t("settings.egress.autoBindStatRebalanced")} value={result.rebalanced} />
            <StatBox label={t("settings.egress.autoBindStatReleased")} value={result.released} />
            <StatBox label={t("settings.egress.autoBindStatUnplaced")} value={result.unplaced} tone={result.unplaced > 0 ? "warn" : undefined} />
            <StatBox label={t("settings.egress.notTested")} value={result.nodes.unprobed} tone="warn" />
            <StatBox label={t("settings.egress.unhealthy")} value={result.nodes.unhealthy} tone="bad" />
          </div>
        ) : null}
        {result && result.unplaced > 0 ? <p className="text-xs text-muted-foreground">{t("settings.egress.autoBindUnplacedNote")}</p> : null}
        <DialogFooter>
          <Button type="button" onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NodeAccountsDialog({ node, onOpenChange }: { node: EgressNodeDTO | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["egress-node-accounts", node?.id],
    queryFn: () => listEgressNodeAccounts(node!.id),
    enabled: node !== null,
  });
  const accounts = query.data?.accounts ?? [];
  return (
    <Dialog open={node !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settings.egress.nodeAccountsTitle", { name: node?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("settings.egress.nodeAccountsDescription", { count: node?.assignedAccountCount ?? 0 })}</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("settings.egress.nodeAccountsAccount")}</TableHead>
                <TableHead>{t("qualityGuard.state")}</TableHead>
                <TableHead>{t("settings.egress.autoBindStatMode")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? <TableLoadingRow colSpan={3} /> : null}
              {query.isError ? <TableRow><TableCell colSpan={3}><ErrorState message={t("settings.egress.operationFailed")} onRetry={() => void query.refetch()} /></TableCell></TableRow> : null}
              {!query.isLoading && !query.isError && accounts.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">{t("settings.egress.nodeAccountsEmpty")}</TableCell></TableRow>
              ) : null}
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="max-w-64 truncate text-sm" title={account.email || account.name}>{account.name}{account.email ? <span className="ml-1.5 text-xs text-muted-foreground">{account.email}</span> : null}</TableCell>
                  <TableCell>
                    <Badge variant={account.enabled ? "secondary" : "outline"}>{account.enabled ? t("common.enabled") : t("common.disabled")}</Badge>
                    {account.authStatus !== "active" ? <Badge variant="outline" className="ml-1">{account.authStatus}</Badge> : null}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{account.assignmentMode === "manual" ? t("settings.egress.nodeAccountsManual") : t("settings.egress.nodeAccountsAuto")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
