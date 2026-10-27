"use client";

// „Produktregeln“ (Konfigurator → „Sortiment“): the read-only overview of the
// rule registry (product-rules.mjs) — per rule what it does and how many
// catalog products it applies to, plus the products whose `mo.*` metafields
// set or lift a rule. The rules apply wherever Mo proposes products (plan,
// options, cart, product cards), not only in the configurator
// (docs/CONFIGURATOR.md §4a). Changed in code (registry) or per product in
// Shopify (metafields) — nothing to edit here.

import { ListChecks } from "lucide-react";
import { num, plural } from "@/lib/admin-format.mjs";
import { MO_RULE_METAFIELDS } from "@/lib/product-rules.mjs";
import { Card, CardContent, CardHeader, CardTitle, DataTable, Disclosure, InfoTip, type DataTableColumn } from "../ui";
import type { ProductRulesOverview } from "./types";

type RuleRow = ProductRulesOverview["rules"][number];

const METAFIELD_HELP: Record<(typeof MO_RULE_METAFIELDS)[number], string> = {
  sold_in_pairs: "true: nur paarweise · false: ausdrücklich einzeln (hebt eine Paar-Regel auf)",
  quantity_step: "Schrittweite der Menge (z. B. 3)",
  min_quantity: "Mindestmenge",
  max_quantity: "Höchstmenge je Position",
  coverage_m2:
    "Fläche je Stück in m² — ein Wert über 0 macht das Produkt zum Bodenschutz für die ganze Raumfläche (die Tools rechnen die Stückzahl aus der Fläche); 0 schaltet Fläche und ganze Raumfläche ab",
};

const columns: DataTableColumn<RuleRow>[] = [
  {
    key: "rule",
    header: "Regel",
    cell: (r) => (
      <span>
        <span className="font-medium">{r.label}</span>{" "}
        <InfoTip className="align-middle" panelClassName="max-w-md">
          {r.description}
        </InfoTip>
      </span>
    ),
  },
  { key: "effect", header: "Wirkung", hideBelow: "md", cell: (r) => <span className="text-muted-foreground">{r.effect}</span> },
  { key: "count", header: "Produkte", align: "right", cell: (r) => num(r.count) },
];

export function ProductRulesCard({ overview }: { overview: ProductRulesOverview }) {
  const withProducts = overview.rules.filter((r) => r.products.length > 0);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <ListChecks className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle className="text-base">Produktregeln</CardTitle>
        <InfoTip panelClassName="max-w-md">
          Feste Regeln für Mengen und Bodenschutz. Sie gelten überall, wo Mo Produkte vorschlägt — im Plan, in den
          Optionen, beim Warenkorb und in den Produktkarten, nicht nur im Konfigurator. Mo kennt sie aus den
          Produktzeilen; die Tools prüfen jede Menge, korrigieren sie (z. B. eine Hantelscheibe zu einem Paar oder die
          Matten auf die Raumfläche) und melden die Korrektur an Mo. Die Zahlen beziehen sich auf den ganzen Katalog.
        </InfoTip>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DataTable columns={columns} rows={overview.rules} rowKey={(r) => r.id} dense />
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <span>
            {overview.metafields > 0
              ? `${plural(overview.metafields, "Produkt", "Produkte")} mit eigenen Regeln aus Shopify-Metafeldern`
              : "Keine Produkte mit eigenen Regeln aus Shopify-Metafeldern"}
          </span>
          <InfoTip panelClassName="max-w-md">
            <span className="flex flex-col gap-1">
              <span>
                Abweichungen je Produkt in Shopify unter Produkt → Metafelder, Namespace „mo“ — ein Metafeld geht der Regel
                vor und kommt mit dem nächsten Katalog-Abgleich an:
              </span>
              {MO_RULE_METAFIELDS.map((key) => (
                <span key={key}>
                  <span className="font-mono">mo.{key}</span> — {METAFIELD_HELP[key]}
                </span>
              ))}
            </span>
          </InfoTip>
        </div>
        {(withProducts.length > 0 || overview.metafieldProducts.length > 0) && (
          <Disclosure title="Betroffene Produkte" framed={false}>
            <div className="flex flex-col gap-3 text-sm">
              {withProducts.map((r) => (
                <ProductList key={r.id} title={r.label} total={r.count} products={r.products} />
              ))}
              {overview.metafieldProducts.length > 0 && (
                <ProductList title="Eigene Regeln (Metafelder mo.*)" total={overview.metafields} products={overview.metafieldProducts} />
              )}
            </div>
          </Disclosure>
        )}
      </CardContent>
    </Card>
  );
}

function ProductList({ title, total, products }: { title: string; total: number; products: Array<{ id: string; name: string }> }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">
        {title} · {num(total)}
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {products.map((p) => (
          <li key={p.id} className="truncate">
            {p.name}
          </li>
        ))}
        {total > products.length && <li className="text-muted-foreground">… und {num(total - products.length)} weitere</li>}
      </ul>
    </div>
  );
}
