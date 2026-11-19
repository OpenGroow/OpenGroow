"use client";

import { Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PanelIcon } from "@/components/opengroow/settings-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Removing a provider (Publisher or Analytics Adapter) from the Project, as the Agent page's
 * Danger zone does: the last card of the settings, confirmed in a dialog that says what it does.
 */
export function ProviderDangerZone({
  name,
  summary,
  consequences,
  removing,
  disabled,
  error,
  confirming,
  onConfirming,
  onRemove,
}: {
  name: string;
  /** Under the title: what removing does, in one line. */
  summary: string;
  /** In the confirm dialog: what is removed and what is kept. */
  consequences: string;
  removing: boolean;
  disabled: boolean;
  error: string | null;
  confirming: boolean;
  onConfirming: (open: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <Card data-slot="settings-panel" aria-label="Danger zone">
      <CardContent className="grid gap-6">
        <div className="flex items-start gap-4">
          <PanelIcon icon={TriangleAlert} tone="danger" />
          <div className="grid gap-1">
            <h2 className="m-0 text-lg font-semibold text-foreground">Danger zone</h2>
            <p className="m-0 text-sm text-muted-foreground">{summary}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button className="w-32" variant="outline" size="lg" type="button" disabled={disabled} onClick={() => onConfirming(true)}>
            <Trash2 />
            Remove
          </Button>
        </div>
        <Dialog open={confirming} onOpenChange={(open) => !open && !removing && onConfirming(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove {name}?</DialogTitle>
              <DialogDescription>{consequences}</DialogDescription>
            </DialogHeader>
            {error ? (
              <p role="alert" className="m-0 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="outline" type="button" disabled={removing} onClick={() => onConfirming(false)}>
                Cancel
              </Button>
              <Button variant="destructive" type="button" loading={removing} onClick={onRemove}>
                {removing ? null : <Trash2 />}
                {removing ? "Removing…" : `Remove ${name}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
