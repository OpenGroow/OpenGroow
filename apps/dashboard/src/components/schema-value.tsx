import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

// Generic, schema-driven rendering of any JSON value (ADR-051: no per-origin
// code). A declared JSON Schema only contributes labels (`title`) and the
// key order (`properties`); the value itself drives the layout, so an
// undocumented value (no schema) still renders readably.

export type JsonSchema = {
  title?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
};

/** `search_volume` / `searchVolume` -> `Search volume`. */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-\s]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function isUrl(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value);
}

/** Resolves a local `#/$defs/x` reference against the root schema. Anything
 * else (unknown target, cycle guard) yields `undefined`: labels degrade to
 * humanized keys rather than failing. */
function resolve(schema: JsonSchema | undefined, root: JsonSchema | undefined): JsonSchema | undefined {
  let current = schema;
  for (let hops = 0; current?.$ref && hops < 8; hops++) {
    const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(current.$ref);
    current = match ? root?.[match[1] as "$defs" | "definitions"]?.[match[2]] : undefined;
  }
  return current?.$ref ? undefined : current;
}

function labelFor(key: string, schema: JsonSchema | undefined): string {
  return typeof schema?.title === "string" && schema.title ? schema.title : humanizeKey(key);
}

/**
 * Keys in schema order first, then any undeclared key present in at least one
 * of the objects, in first-encounter order. One object gives a field list's
 * rows; several give a table's columns.
 */
function orderedKeys(objects: ReadonlyArray<Record<string, unknown>>, schema: JsonSchema | undefined): string[] {
  const present = [...new Set(objects.flatMap((object) => Object.keys(object)))];
  const declared = Object.keys(schema?.properties ?? {}).filter((key) => present.includes(key));
  return [...declared, ...present.filter((key) => !declared.includes(key))];
}

function Scalar({ value }: { value: string | number | boolean | null }): ReactNode {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (typeof value === "string" && isUrl(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer noopener"
        className="break-all font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {value}
      </a>
    );
  }
  return <span className="break-words">{String(value)}</span>;
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <Badge
      data-chip>
      {children}
    </Badge>
  );
}

function ArrayValue({
  items,
  schema,
  root,
}: {
  items: unknown[];
  schema: JsonSchema | undefined;
  root: JsonSchema | undefined;
}) {
  if (items.length === 0) return <span className="text-muted-foreground">None</span>;

  if (items.every(isScalar)) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <Chip key={index}>
            <Scalar value={item} />
          </Chip>
        ))}
      </div>
    );
  }

  const itemSchema = resolve(schema?.items, root);
  if (items.every(isRecord)) {
    const columns = orderedKeys(items, itemSchema);
    return (
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="bg-muted">
              {columns.map((column) => (
                <th key={column} className="px-3 py-2 font-semibold text-muted-foreground">
                  {labelFor(column, resolve(itemSchema?.properties?.[column], root))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, rowIndex) => (
              <tr key={rowIndex} className="border-t border-border align-top">
                {columns.map((column) => (
                  <td key={column} className="px-3 py-2">
                    {column in item ? (
                      <SchemaValue value={item[column]} schema={itemSchema?.properties?.[column]} root={root} />
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Mixed / nested arrays: one collapsible entry per item.
  return (
    <div className="grid gap-2">
      {items.map((item, index) => (
        <Collapsible key={index} title={`Item ${index + 1}`}>
          <SchemaValue value={item} schema={itemSchema} root={root} />
        </Collapsible>
      ))}
    </div>
  );
}

function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-xl border border-border bg-card/60 px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {title}
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}

/** Renders one JSON value: scalars inline, links clickable, lists of scalars
 * as chips, lists of objects as tables, nested objects collapsible. */
export function SchemaValue({
  value,
  schema,
  root,
}: {
  value: unknown;
  schema?: JsonSchema;
  root?: JsonSchema;
}) {
  const rootSchema = root ?? schema;
  const resolved = resolve(schema, rootSchema);
  if (Array.isArray(value)) return <ArrayValue items={value} schema={resolved} root={rootSchema} />;
  if (isRecord(value)) return <ObjectFields value={value} schema={resolved} root={rootSchema} nested />;
  return isScalar(value) ? <Scalar value={value} /> : <span>{String(value)}</span>;
}

function ObjectFields({
  value,
  schema,
  root,
  nested = false,
}: {
  value: Record<string, unknown>;
  schema: JsonSchema | undefined;
  root: JsonSchema | undefined;
  nested?: boolean;
}) {
  const keys = orderedKeys([value], schema);
  if (keys.length === 0) return <span className="text-muted-foreground">Empty</span>;
  return (
    <dl className={nested ? "m-0 grid gap-3" : "m-0 grid gap-4"}>
      {keys.map((key) => {
        const childSchema = resolve(schema?.properties?.[key], root);
        const child = value[key];
        const label = labelFor(key, childSchema);
        return (
          <div key={key} className="grid gap-1">
            {isRecord(child) ? (
              <Collapsible title={label}>
                <ObjectFields value={child} schema={childSchema} root={root} nested />
              </Collapsible>
            ) : (
              <>
                <dt className="text-xs font-semibold text-muted-foreground">
                  {label}
                </dt>
                <dd className="m-0 text-sm leading-relaxed text-foreground">
                  <SchemaValue value={child} schema={childSchema} root={root} />
                </dd>
              </>
            )}
          </div>
        );
      })}
    </dl>
  );
}

/** A whole object as a labelled field list; `schema` supplies titles and order. */
export function SchemaFields({ value, schema }: { value: Record<string, unknown>; schema?: JsonSchema | null }) {
  const root = schema ?? undefined;
  return <ObjectFields value={value} schema={resolve(root, root)} root={root} />;
}
