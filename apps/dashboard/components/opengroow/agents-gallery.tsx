"use client";

import * as React from "react";
import { Bot, CheckCircle2, Loader2, Plus } from "lucide-react";

import { AgentCard } from "@/components/opengroow/agent-card";
import { formatCategory } from "@/components/opengroow/agent-presentation";
import { FilterChips, SearchField } from "@/components/opengroow/filter-bar";
import { PageHeader } from "@/components/opengroow/page-header";
import { StatTile } from "@/components/opengroow/stat-tile";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AgentCardState } from "@/src/utils/merge-agent-states";

type AgentsGalleryProps = {
  cards: AgentCardState[];
  loading: boolean;
  instanceId: string;
  runtimeErrors: Record<string, string>;
  onAddAgent: () => void;
  onActivate: (card: AgentCardState) => void;
};

/** Presentation of the Agents page: header, aggregates, filters and the card grid. */
export function AgentsGallery({
  cards,
  loading,
  instanceId,
  runtimeErrors,
  onAddAgent,
  onActivate,
}: AgentsGalleryProps) {
  // UI-only filtering of the cards already on the page.
  const [filter, setFilter] = React.useState<string>("all");
  const [query, setQuery] = React.useState("");
  const activeCount = cards.filter((card) => card.status === "active").length;
  const categories = React.useMemo(
    () => [...new Set(cards.map((card) => card.manifest.category).filter(Boolean))].sort(),
    [cards],
  );
  const visibleCards = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (filter === "active" && card.status !== "active") return false;
      if (filter !== "all" && filter !== "active" && card.manifest.category !== filter) return false;
      if (!needle) return true;
      return (
        card.manifest.name.toLowerCase().includes(needle) ||
        card.manifest.description.toLowerCase().includes(needle)
      );
    });
  }, [cards, filter, query]);

  const filters = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    ...categories.map((category) => ({ id: category, label: formatCategory(category) })),
  ];

  return (
    <>
      <PageHeader
        title="Agents"
        description="Your AI growth team, organized by role and ready to work."
        action={
          <Button variant="glow" size="lg" type="button" onClick={onAddAgent}>
            <Plus />
            Add Agent
          </Button>
        }
      />

      {loading && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Loading agent states…</span>
        </div>
      )}

      {!loading && cards.length === 0 && (
        <Card>
          <CardContent className="grid gap-2">
            <h2 className="m-0 text-xl font-semibold text-foreground">No agents yet</h2>
            <p className="m-0 text-base text-muted-foreground">
              Use Add Agent to pick one from the catalogue.
            </p>
          </CardContent>
        </Card>
      )}

      {cards.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile icon={CheckCircle2} label="Active agents" value={activeCount} />
            <StatTile icon={Bot} label="Installed agents" value={cards.length} />
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <FilterChips options={filters} value={filter} onChange={setFilter} label="Filter agents" />
            <SearchField value={query} onChange={setQuery} label="Search agents" placeholder="Search agents…" />
          </div>

          {visibleCards.length === 0 ? (
            <p className="m-0 text-base text-muted-foreground">
              No agents match your filters.
            </p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
              {visibleCards.map((card) => (
                <AgentCard
                  key={card.templateId}
                  card={card}
                  instanceId={instanceId}
                  runtimeError={runtimeErrors[card.templateId]}
                  onActivate={() => onActivate(card)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
